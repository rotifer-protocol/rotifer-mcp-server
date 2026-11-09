import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../scripts/ci/wait-for-npm-version.mjs");
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A stand-in registry answering each request with the next status in `plan`; the last one repeats. */
async function registry(plan: Array<number | { status: number; version: string }>) {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    const step = plan[Math.min(paths.length - 1, plan.length - 1)];
    const { status, version } = typeof step === "number" ? { status: step, version: "1.2.3" } : step;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version }));
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, paths };
}

function run(args: string[], settings: Record<string, string> = {}) {
  const started = Date.now();
  return new Promise<{ code: number | null; output: string; elapsed: number }>((done) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, NPM_WAIT_INTERVAL_SECONDS: "0.05", NPM_WAIT_TIMEOUT_SECONDS: "5", ...settings },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => done({ code, output, elapsed: Date.now() - started }));
  });
}

const PACKAGE = ["@rotifer/mcp-server", "1.2.3"];

describe("wait-for-npm-version", () => {
  it("succeeds at once when the version is already visible", async () => {
    const npm = await registry([200]);
    const result = await run(PACKAGE, { NPM_REGISTRY_URL: npm.url });
    expect(result.code).toBe(0);
    expect(npm.paths).toEqual(["/@rotifer%2Fmcp-server/1.2.3"]);
  });

  it("keeps checking through 404s until the version appears", async () => {
    const npm = await registry([404, 404, 200]);
    const result = await run(PACKAGE, { NPM_REGISTRY_URL: npm.url });
    expect(result.code).toBe(0);
    expect(npm.paths).toHaveLength(3);
  });

  it("keeps checking through a server error", async () => {
    const npm = await registry([503, 200]);
    expect((await run(PACKAGE, { NPM_REGISTRY_URL: npm.url })).code).toBe(0);
  });

  it("does not accept a response for another version", async () => {
    const npm = await registry([{ status: 200, version: "9.9.9" }, 200]);
    const result = await run(PACKAGE, { NPM_REGISTRY_URL: npm.url });
    expect(result.code).toBe(0);
    expect(npm.paths).toHaveLength(2);
  });

  it("fails at the limit and says what happened", async () => {
    const npm = await registry([404]);
    const result = await run(PACKAGE, { NPM_REGISTRY_URL: npm.url, NPM_WAIT_TIMEOUT_SECONDS: "0.4" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("@rotifer/mcp-server@1.2.3");
    expect(result.output).toContain("0.4 seconds");
    expect(result.output).toContain("HTTP 404");
    expect(result.elapsed).toBeLessThan(4_000);
    expect(npm.paths.length).toBeGreaterThan(1);
  });

  it("fails at the limit when the registry never answers", async () => {
    const server = createServer(() => {});
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await run(PACKAGE, { NPM_REGISTRY_URL: url, NPM_WAIT_TIMEOUT_SECONDS: "0.4" });
    server.closeAllConnections();
    expect(result.code).toBe(1);
    expect(result.elapsed).toBeLessThan(4_000);
  });

  it("reports npm's last answer when the limit cuts off the final check", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      if (++requests === 1) res.writeHead(404).end("{}");
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await run(PACKAGE, { NPM_REGISTRY_URL: url, NPM_WAIT_TIMEOUT_SECONDS: "0.4" });
    server.closeAllConnections();
    expect(result.code).toBe(1);
    expect(result.output).toContain("last result: HTTP 404");
    expect(requests).toBeGreaterThan(1);
  });

  it.each([
    [["@rotifer/mcp-server"], {}],
    [PACKAGE, { NPM_WAIT_TIMEOUT_SECONDS: "soon" }],
    [PACKAGE, { NPM_WAIT_INTERVAL_SECONDS: "0" }],
  ] as Array<[string[], Record<string, string>]>)("exits 2 on bad usage: %j %j", async (args, settings) => {
    expect((await run(args, settings)).code).toBe(2);
  });
});
