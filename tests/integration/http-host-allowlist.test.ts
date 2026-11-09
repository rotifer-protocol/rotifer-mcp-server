import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `serve` over a real socket. fetch() cannot set a Host header, and a mocked
 * node:http cannot show what a client on the network actually gets, so these
 * use node:http's client against the real server.
 *
 * The sign-in tools are replaced so a regression fails an assertion here
 * instead of opening a browser or clearing the developer's credentials.
 */
const signIn = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue({ success: true }),
  logout: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock("../../src/tools.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/tools.js")>()),
  login: signIn.login,
  logout: signIn.logout,
}));

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** The JSON-RPC message, whether sent as JSON or as one SSE event. */
  message: any;
}

function parseMessage(body: string): any {
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  try {
    return JSON.parse(line ? line.slice(6) : body);
  } catch {
    return undefined;
  }
}

function send(
  port: number,
  headers: Record<string, string>,
  rpc: Record<string, unknown>,
  options: { method?: string; path?: string; setHost?: boolean } = {},
): Promise<Reply> {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, ...rpc });
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "POST",
        path: options.path ?? "/mcp",
        setHost: options.setHost ?? true,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          done({ status: res.statusCode ?? 0, headers: res.headers, body, message: parseMessage(body) }),
        );
      },
    );
    req.on("error", fail);
    if ((options.method ?? "POST") === "POST") req.write(payload);
    req.end();
  });
}

const listTools = { method: "tools/list", params: {} };
const callTool = (name: string) => ({ method: "tools/call", params: { name, arguments: {} } });

async function start(allowedHosts?: string[]) {
  const { startHttpServer } = await import("../../src/http.js");
  const server = await startHttpServer({ port: 0, allowedHosts });
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  return { server, port: (server.address() as AddressInfo).port };
}

const close = (server: http.Server) => new Promise<void>((r) => server.close(() => r()));

beforeAll(() => {
  // startHttpServer installs SIGINT/SIGTERM handlers that exit the process.
  vi.spyOn(process, "on").mockImplementation((() => process) as any);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("serve on loopback", () => {
  let server: http.Server;
  let port = 0;
  const local = () => ({ Host: `127.0.0.1:${port}` });

  beforeAll(async () => {
    ({ server, port } = await start());
  });
  afterAll(() => close(server));

  it.each(["rebind.example", "rebind.example:3000", "127.1", "2130706433", "localhost.", "localhost/x", "127.0.0.1@rebind.example"])(
    "refuses tools/list addressed to Host %s",
    async (host) => {
      const reply = await send(port, { Host: host }, listTools);
      expect(reply.status).toBe(403);
      expect(reply.message.error.message).toMatch(/--allowed-hosts/);
      expect(reply.body).not.toContain("search_genes");
    },
  );

  it("refuses tools/call addressed to a forged Host, without calling the tool", async () => {
    const reply = await send(port, { Host: "rebind.example" }, callTool("auth_status"));
    expect(reply.status).toBe(403);
    expect(reply.message.error.message).toMatch(/Host/);
    expect(reply.message.result).toBeUndefined();
  });

  it("refuses a request with no Host header", async () => {
    const reply = await send(port, {}, listTools, { setHost: false });
    // HTTP/1.1 itself requires Host, so Node may answer before this server does.
    expect([400, 403]).toContain(reply.status);
  });

  it.each(["http://rebind.example", "http://rebind.example:3000", "null", "file://", "ftp://localhost", ""])(
    "refuses Origin %j even when Host is loopback",
    async (origin) => {
      const reply = await send(port, { ...local(), Origin: origin }, listTools);
      expect(reply.status).toBe(403);
      expect(reply.body).not.toContain("search_genes");
    },
  );

  it("does not grant CORS to a forged Origin", async () => {
    const reply = await send(port, { ...local(), Origin: "http://rebind.example" }, listTools, { method: "OPTIONS" });
    expect(reply.headers["access-control-allow-origin"]).toBe("");
  });

  it.each([
    ["localhost", (p: number) => `localhost:${p}`],
    ["127.0.0.1", (p: number) => `127.0.0.1:${p}`],
    ["[::1]", (p: number) => `[::1]:${p}`],
    ["upper case", (p: number) => `LOCALHOST:${p}`],
  ])("serves a client that used %s", async (_label, host) => {
    const reply = await send(port, { Host: host(port) }, listTools);
    expect(reply.status).toBe(200);
    expect(reply.message.result.tools.length).toBeGreaterThan(0);
  });

  it("serves a loopback browser Origin and grants it CORS", async () => {
    const reply = await send(port, { ...local(), Origin: `http://localhost:${port}` }, listTools);
    expect(reply.status).toBe(200);
    expect(reply.headers["access-control-allow-origin"]).toBe(`http://localhost:${port}`);
  });

  it("leaves /health open, whatever the Host", async () => {
    const reply = await send(port, { Host: "10.0.0.5:3000" }, {}, { method: "GET", path: "/health" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).status).toBe("ok");
  });

  it("does not list login or logout", async () => {
    const reply = await send(port, local(), listTools);
    const names = reply.message.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain("login");
    expect(names).not.toContain("logout");
    expect(names).toContain("auth_status");
  });

  it.each([
    ["login", /browser/],
    ["logout", /credentials/],
  ] as const)("refuses %s and says what to run instead", async (name, why) => {
    const reply = await send(port, local(), callTool(name));
    expect(reply.message.error.message).toMatch(why);
    expect(reply.message.error.message).toContain(`rotifer-mcp-server ${name}`);
    expect(reply.message.result).toBeUndefined();
    expect(signIn[name]).not.toHaveBeenCalled();
  });
});

describe("serve with --allowed-hosts", () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    ({ server, port } = await start(["mcp.example.com", "[fd00::1]"]));
  });
  afterAll(() => close(server));

  it.each(["mcp.example.com", "mcp.example.com:8443", "MCP.example.com", "[fd00::1]:3000", "localhost:3000"])(
    "serves Host %s",
    async (host) => {
      expect((await send(port, { Host: host }, listTools)).status).toBe(200);
    },
  );

  it.each(["sub.mcp.example.com", "example.com", "mcp.example.com.rebind.example"])(
    "still refuses Host %s: names match exactly",
    async (host) => {
      expect((await send(port, { Host: host }, listTools)).status).toBe(403);
    },
  );

  it("uses the same list for Origin", async () => {
    const good = await send(port, { Host: "mcp.example.com", Origin: "https://mcp.example.com" }, listTools);
    expect(good.status).toBe(200);
    expect(good.headers["access-control-allow-origin"]).toBe("https://mcp.example.com");
    const bad = await send(port, { Host: "mcp.example.com", Origin: "https://other.example" }, listTools);
    expect(bad.status).toBe(403);
  });
});

describe("resolveAllowedHosts", () => {
  const load = () => import("../../src/http.js");

  it.each([undefined, "127.0.0.1", "::1", "localhost"])("needs nothing for --host %s", async (host) => {
    const { resolveAllowedHosts } = await load();
    expect(resolveAllowedHosts(host, undefined)).toEqual([]);
  });

  it.each(["0.0.0.0", "::", "192.168.1.20", "mcp.example.com"])("refuses --host %s with no list", async (host) => {
    const { resolveAllowedHosts } = await load();
    expect(() => resolveAllowedHosts(host, undefined)).toThrow(/--allowed-hosts/);
  });

  it("normalizes names and addresses", async () => {
    const { resolveAllowedHosts } = await load();
    expect(resolveAllowedHosts("0.0.0.0", " MCP.Example.com,192.168.1.20,fd00::1,[fd00::2]")).toEqual([
      "mcp.example.com",
      "192.168.1.20",
      "[fd00::1]",
      "[fd00::2]",
    ]);
  });

  it.each(["*", "*.example.com", "https://mcp.example.com", "mcp.example.com:8443", "mcp.example.com/x", "a,,b", ""])(
    "refuses the entry %j",
    async (value) => {
      const { resolveAllowedHosts } = await load();
      expect(() => resolveAllowedHosts("0.0.0.0", value)).toThrow(/no scheme, port, path or wildcard/);
    },
  );
});

/** The launch line itself, which only the built program can show. */
describe.skipIf(!existsSync(resolve(__dirname, "../../dist/index.js")))("the serve command", () => {
  const entry = resolve(__dirname, "../../dist/index.js");
  const home = mkdtempSync(join(tmpdir(), "rotifer-serve-"));
  const childEnv = { ...process.env, HOME: home, USERPROFILE: home, DO_NOT_TRACK: "1" };
  const children: ChildProcess[] = [];

  afterAll(() => {
    for (const child of children) child.kill();
    rmSync(home, { recursive: true, force: true });
  });

  function freePort(): Promise<number> {
    return new Promise((done) => {
      const probe = createNetServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => done(port));
      });
    });
  }

  function launch(args: string[]): Promise<void> {
    const child = spawn(process.execPath, [entry, "serve", ...args], { env: childEnv, stdio: ["ignore", "ignore", "pipe"] });
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

  it("exits 2 and says what to add when --host is not loopback and no list is given", () => {
    const run = spawnSync(process.execPath, [entry, "serve", "--host", "0.0.0.0"], { env: childEnv, encoding: "utf8", timeout: 20_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--allowed-hosts");
  });

  it("exits 2 when --allowed-hosts has no value", () => {
    const run = spawnSync(process.execPath, [entry, "serve", "--allowed-hosts"], { env: childEnv, encoding: "utf8", timeout: 20_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--allowed-hosts");
  });

  it("exits 2 on a wildcard", () => {
    const run = spawnSync(process.execPath, [entry, "serve", "--host", "0.0.0.0", "--allowed-hosts", "*"], { env: childEnv, encoding: "utf8", timeout: 20_000 });
    expect(run.status).toBe(2);
  });

  it("passes the list through to the running server", async () => {
    const port = await freePort();
    await launch(["--port", String(port), "--allowed-hosts", "mcp.example.com"]);
    expect((await send(port, { Host: "mcp.example.com" }, listTools)).status).toBe(200);
    expect((await send(port, { Host: "rebind.example" }, listTools)).status).toBe(403);
  }, 30_000);
});
