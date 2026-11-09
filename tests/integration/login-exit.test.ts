import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startOAuthCallbackServer } from "../../src/auth.js";

const CALLBACK_PORT = 9876;

/** Asks the port the way a browser does, with a connection it keeps open afterwards. */
function get(port: number, path: string, agent?: http.Agent): Promise<number> {
  return new Promise((done, fail) => {
    const req = http.get({ host: "127.0.0.1", port, path, agent }, (res) => {
      res.resume();
      res.on("end", () => done(res.statusCode ?? 0));
    });
    req.on("error", fail);
  });
}

/** Repeats until the process under test has opened its callback port. */
async function deliverCode(agent: http.Agent): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      expect(await get(CALLBACK_PORT, "/callback?code=stand-in-code", agent)).toBe(200);
      return;
    } catch (err) {
      if (Date.now() > deadline || (err as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

// `open` and `xdg-open` are replaced below; on Windows the opener is an absolute
// path, so these would start a real browser there.
describe.skipIf(process.platform === "win32")("after a successful sign-in", () => {
  const root = resolve(__dirname, "../..");
  const entry = join(root, "src/index.ts");
  const work = mkdtempSync(join(tmpdir(), "rotifer-login-exit-"));
  const bin = join(work, "bin");
  let authServer: http.Server;
  let env: Record<string, string>;
  let home = "";
  let homes = 0;
  let browser: http.Agent;

  beforeAll(async () => {
    mkdirSync(bin);
    for (const name of ["open", "xdg-open"]) {
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
      chmodSync(join(bin, name), 0o755);
    }
    authServer = http.createServer((req, res) => {
      const body = req.url?.startsWith("/auth/v1/token")
        ? { access_token: "stand-in-access", refresh_token: "stand-in-refresh", expires_in: 3600 }
        : { id: "login-exit", user_metadata: { user_name: "login-exit" } };
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((ready) => authServer.listen(0, "127.0.0.1", ready));
  });

  beforeEach(() => {
    home = join(work, `home-${++homes}`);
    mkdirSync(join(home, ".rotifer"), { recursive: true });
    const endpoint = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;
    writeFileSync(join(home, ".rotifer", "cloud.json"), JSON.stringify({ endpoint, anonKey: "stand-in-anon-key" }));
    const { ROTIFER_CLOUD_ENDPOINT: _endpoint, ROTIFER_CLOUD_ANON_KEY: _anonKey, ...inherited } = process.env;
    env = {
      ...(inherited as Record<string, string>),
      HOME: home,
      USERPROFILE: home,
      DO_NOT_TRACK: "1",
      ROTIFER_NO_UPDATE_CHECK: "1",
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    };
    browser = new http.Agent({ keepAlive: true });
  });

  afterEach(() => browser.destroy());

  afterAll(async () => {
    authServer.closeAllConnections();
    await new Promise<void>((r) => authServer.close(() => r()));
    rmSync(work, { recursive: true, force: true });
  });

  const saved = () => JSON.parse(readFileSync(join(home, ".rotifer", "credentials.json"), "utf8"));

  it("the login command exits soon after the code arrives", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", entry, "login"], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));

    await deliverCode(browser);
    const delivered = Date.now();
    const limit = setTimeout(() => child.kill(), 25_000);
    const code = await exited;
    clearTimeout(limit);

    expect(code, output).toBe(0);
    expect(Date.now() - delivered, output).toBeLessThan(15_000);
    expect(output).toContain("Logged in as login-exit");
    expect(saved().access_token).toBe("stand-in-access");
  }, 60_000);

  it("the MCP login tool succeeds and the server keeps answering", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", entry],
      env,
      cwd: root,
      stderr: "ignore",
    });
    const client = new Client({ name: "login-exit-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const login = client.callTool({ name: "login", arguments: {} }, undefined, { timeout: 40_000 });
      await deliverCode(browser);
      const reply = (await login) as { content: Array<{ text: string }> };
      expect(JSON.parse(reply.content[0].text).success).toBe(true);
      expect(saved().access_token).toBe("stand-in-access");

      const status = (await client.callTool({ name: "auth_status", arguments: {} })) as { content: Array<{ text: string }> };
      expect(JSON.parse(status.content[0].text).is_logged_in).toBe(true);
    } finally {
      await transport.close();
    }
  }, 60_000);
});

describe("the sign-in time limit", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps running after a request that carries no code", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { port, waitForCallback } = await startOAuthCallbackServer(0);
    const outcome = expect(waitForCallback).rejects.toThrow(/timed out after 120 seconds/);
    expect(await get(port, "/callback")).toBe(200);
    vi.advanceTimersByTime(120_000);
    await outcome;
  });
});
