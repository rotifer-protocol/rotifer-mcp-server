import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `/` entry point, and the `serve` launch line run from source so that a
 * change to src/index.ts fails here without a rebuild.
 */
const tools = vi.hoisted(() => ({
  authStatus: vi.fn().mockReturnValue({ isLoggedIn: false }),
}));

vi.mock("../../src/tools.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/tools.js")>()),
  authStatus: tools.authStatus,
}));

function send(port: number, headers: Record<string, string>, rpc: Record<string, unknown>, path = "/mcp") {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, ...rpc });
  return new Promise<{ status: number; body: string }>((done, fail) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path,
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => done({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", fail);
    req.write(payload);
    req.end();
  });
}

const listTools = { method: "tools/list", params: {} };
const callAuthStatus = { method: "tools/call", params: { name: "auth_status", arguments: {} } };

describe("the / entry point", () => {
  let server: http.Server;
  let port = 0;
  const local = () => ({ Host: `127.0.0.1:${port}` });

  beforeAll(async () => {
    // startHttpServer installs SIGINT/SIGTERM handlers that exit the process.
    vi.spyOn(process, "on").mockImplementation((() => process) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { startHttpServer } = await import("../../src/http.js");
    server = await startHttpServer({ port: 0 });
    if (!server.listening) await new Promise((r) => server.once("listening", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    vi.restoreAllMocks();
  });

  beforeEach(() => tools.authStatus.mockClear());

  it("refuses tools/list addressed to a forged Host", async () => {
    const reply = await send(port, { Host: "rebind.example" }, listTools, "/");
    expect(reply.status).toBe(403);
    expect(reply.body).toMatch(/Host/);
    expect(reply.body).not.toContain("search_genes");
  });

  it("refuses tools/call addressed to a forged Host, without running the tool", async () => {
    const reply = await send(port, { Host: "rebind.example" }, callAuthStatus, "/");
    expect(reply.status).toBe(403);
    expect(tools.authStatus).not.toHaveBeenCalled();
  });

  it("refuses tools/list from a forged Origin", async () => {
    const reply = await send(port, { ...local(), Origin: "http://rebind.example" }, listTools, "/");
    expect(reply.status).toBe(403);
    expect(reply.body).toMatch(/Origin/);
    expect(reply.body).not.toContain("search_genes");
  });

  it("refuses tools/call from a forged Origin, without running the tool", async () => {
    const reply = await send(port, { ...local(), Origin: "http://rebind.example" }, callAuthStatus, "/");
    expect(reply.status).toBe(403);
    expect(tools.authStatus).not.toHaveBeenCalled();
  });

  it("runs the tool for a loopback client", async () => {
    const reply = await send(port, local(), callAuthStatus, "/");
    expect(reply.status).toBe(200);
    expect(tools.authStatus).toHaveBeenCalledOnce();
  });
});

describe("the serve launch line", () => {
  const root = resolve(__dirname, "../..");
  const entry = join(root, "src/index.ts");
  const home = mkdtempSync(join(tmpdir(), "rotifer-serve-source-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home, DO_NOT_TRACK: "1", ROTIFER_NO_UPDATE_CHECK: "1" };
  const command = (args: string[]) => ["--import", "tsx", entry, "serve", ...args];
  const children: ChildProcess[] = [];

  afterAll(() => {
    for (const child of children) child.kill();
    rmSync(home, { recursive: true, force: true });
  });

  const run = (args: string[]) =>
    spawnSync(process.execPath, command(args), { cwd: root, env, encoding: "utf8", timeout: 20_000 });

  function freePort(): Promise<number> {
    return new Promise((done) => {
      const probe = createNetServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => done(port));
      });
    });
  }

  function launch(args: string[]): Promise<void> {
    const child = spawn(process.execPath, command(args), { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    children.push(child);
    return new Promise((ready, fail) => {
      let seen = "";
      child.stderr!.on("data", (chunk) => {
        seen += chunk;
        if (seen.includes("listening on")) ready();
      });
      child.on("exit", (code) => fail(new Error(`serve exited ${code}: ${seen}`)));
    });
  }

  it("exits 2 on a non-loopback --host with no list", () => {
    const result = run(["--host", "0.0.0.0"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("also needs --allowed-hosts");
  }, 30_000);

  it("exits 2 on an unusable list entry", () => {
    const result = run(["--host", "0.0.0.0", "--allowed-hosts", "*"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no scheme, port, path or wildcard");
  }, 30_000);

  it.each([
    ["at the end of the line", ["--allowed-hosts"]],
    ["before another flag", ["--allowed-hosts", "--port", "0"]],
  ])("exits 2 when --allowed-hosts has no value %s", (_label, args) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--allowed-hosts needs a value");
  }, 30_000);

  it("hands the list to the running server", async () => {
    const port = await freePort();
    await launch(["--port", String(port), "--allowed-hosts", "mcp.example.com"]);
    expect((await send(port, { Host: "mcp.example.com" }, listTools)).status).toBe(200);
    expect((await send(port, { Host: "rebind.example" }, listTools)).status).toBe(403);
  }, 30_000);
});
