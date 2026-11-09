import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The real `serve` process from source, reached over a real socket. */
const root = resolve(__dirname, "../..");
const entry = join(root, "src/index.ts");
const work = mkdtempSync(join(tmpdir(), "rotifer-http-token-"));
const home = join(work, "home");
mkdirSync(home);

const TOKEN_VAR = "ROTIFER_MCP_HTTP_TOKEN";
const token = "stand-in-http-access-token";
const wrongTokens = ["x", `${token}-but-longer`, token.toUpperCase()];

const { [TOKEN_VAR]: _inherited, ...inherited } = process.env;
const baseEnv: Record<string, string> = {
  ...(inherited as Record<string, string>),
  HOME: home,
  USERPROFILE: home,
  DO_NOT_TRACK: "1",
  ROTIFER_NO_UPDATE_CHECK: "1",
};

const tokenFile = join(work, "token-with-newline");
writeFileSync(tokenFile, `${token}\n`);

const children: ChildProcess[] = [];
const output: string[] = [];

afterAll(() => {
  for (const child of children) child.kill();
  rmSync(work, { recursive: true, force: true });
});

const command = (args: string[]) => ["--import", "tsx", entry, "serve", ...args];

function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

/** Starts `serve` and resolves once it is listening. Everything it prints goes in `output`. */
function launch(args: string[], env = baseEnv): Promise<number> {
  return freePort().then(
    (port) =>
      new Promise((ready, fail) => {
        const child = spawn(process.execPath, command(["--port", String(port), ...args]), {
          cwd: root,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.push(child);
        let seen = "";
        const collect = (chunk: Buffer) => {
          seen += chunk;
          output.push(String(chunk));
          if (seen.includes("listening on")) ready(port);
        };
        child.stdout!.on("data", collect);
        child.stderr!.on("data", collect);
        child.on("exit", (code) => fail(new Error(`serve exited ${code}: ${seen}`)));
      }),
  );
}

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

function send(
  port: number,
  headers: Record<string, string>,
  rpc: Record<string, unknown> | null,
  options: { method?: string; path?: string } = {},
): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "POST",
        path: options.path ?? "/mcp",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", fail);
    if (rpc) req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, ...rpc }));
    req.end();
  });
}

const listTools = { method: "tools/list", params: {} };
const callAuthStatus = { method: "tools/call", params: { name: "auth_status", arguments: {} } };
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

function expectUnauthorized(reply: Reply) {
  expect(reply.status).toBe(401);
  expect(reply.headers["www-authenticate"]).toBe("Bearer");
  expect(reply.body).toContain("Authorization: Bearer");
  expect(reply.body).not.toContain("search_genes");
  expect(reply.body).not.toContain("is_logged_in");
}

describe("serve refuses to start", () => {
  const run = (args: string[], env = baseEnv) =>
    spawnSync(process.execPath, command(args), { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  const beyondLoopback = ["--host", "0.0.0.0", "--allowed-hosts", "mcp.example.com"];

  it("on a non-loopback --host with no token, saying what to add", () => {
    const result = run(beyondLoopback);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--token-file");
    expect(result.stderr).toContain(TOKEN_VAR);
  }, 30_000);

  it("when both token sources are given", () => {
    const result = run(["--token-file", tokenFile], { ...baseEnv, [TOKEN_VAR]: token });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Use only one");
    expect(result.stderr).not.toContain(token);
  }, 30_000);

  it.each([
    ["empty", ""],
    ["only newlines", "\n\r\n"],
  ])("when the token file is %s", (label, content) => {
    const file = join(work, `token-${label.replace(" ", "-")}`);
    writeFileSync(file, content);
    const result = run(["--token-file", file]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("is empty");
  }, 30_000);

  it("when the environment variable is set but empty, even on loopback", () => {
    const result = run([], { ...baseEnv, [TOKEN_VAR]: "" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("set but empty");
  }, 30_000);

  it("when the token file cannot be read", () => {
    const result = run(["--token-file", join(work, "no-such-file")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot be read");
  }, 30_000);

  it.each([
    ["at the end of the line", ["--token-file"]],
    ["before another flag", ["--token-file", "--port", "0"]],
  ])("when --token-file has no value %s", (_label, args) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--token-file needs a path");
  }, 30_000);

  it.each([
    ["--token <value>", ["--token", token]],
    ["--token=<value>", [`--token=${token}`]],
    ["--token-file=<path>", [`--token-file=${tokenFile}`]],
  ])("on %s, and does not repeat it", (_label, args) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not accepted on the command line");
    expect(result.stderr).not.toContain(token);
  }, 30_000);
});

describe("a server started with --token-file", () => {
  let port = 0;
  const local = () => ({ Host: `127.0.0.1:${port}` });
  const url = () => new URL(`http://127.0.0.1:${port}/mcp`);

  beforeAll(async () => {
    port = await launch(["--token-file", tokenFile]);
  }, 30_000);

  it.each([
    ["tools/list", listTools],
    ["tools/call", callAuthStatus],
  ])("refuses %s with no token", async (_label, rpc) => {
    expectUnauthorized(await send(port, local(), rpc));
  });

  describe.each(wrongTokens)("with the wrong token %s", (wrong) => {
    it.each([
      ["tools/list", listTools],
      ["tools/call", callAuthStatus],
    ])("refuses %s and does not echo it", async (_label, rpc) => {
      const reply = await send(port, { ...local(), ...bearer(wrong) }, rpc);
      expectUnauthorized(reply);
      expect(reply.body).not.toContain(wrong);
    });
  });

  it.each([
    ["the bare token", token],
    ["another scheme", `Basic ${token}`],
    ["no token after the scheme", "Bearer"],
  ])("refuses %s in the Authorization header", async (_label, value) => {
    expectUnauthorized(await send(port, { ...local(), Authorization: value }, listTools));
  });

  it("reads the token without the newline at the end of the file", async () => {
    const reply = await send(port, { ...local(), ...bearer(token) }, listTools);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("search_genes");
  });

  it("runs tools/call with the right token", async () => {
    const reply = await send(port, { ...local(), ...bearer(token) }, callAuthStatus);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("is_logged_in");
  });

  it("accepts the scheme in any case", async () => {
    const reply = await send(port, { ...local(), Authorization: `bearer ${token}` }, listTools);
    expect(reply.status).toBe(200);
  });

  it.each(["GET", "DELETE"])("refuses %s on /mcp with no token", async (method) => {
    expectUnauthorized(await send(port, local(), null, { method }));
  });

  it("guards the / entry point too", async () => {
    expectUnauthorized(await send(port, local(), listTools, { path: "/" }));
    expect((await send(port, { ...local(), ...bearer(token) }, listTools, { path: "/" })).status).toBe(200);
  });

  it("guards other paths too", async () => {
    expectUnauthorized(await send(port, local(), null, { method: "GET", path: "/anything" }));
    expect((await send(port, { ...local(), ...bearer(token) }, null, { method: "GET", path: "/anything" })).status).toBe(404);
  });

  it("leaves /health open", async () => {
    expect((await send(port, local(), null, { method: "GET", path: "/health" })).status).toBe(200);
  });

  it("refuses a forged Host even with the right token", async () => {
    const reply = await send(port, { Host: "rebind.example", ...bearer(token) }, listTools);
    expect(reply.status).toBe(403);
    expect(reply.body).not.toContain("search_genes");
  });

  it("refuses a forged Origin even with the right token", async () => {
    const reply = await send(port, { ...local(), Origin: "http://rebind.example", ...bearer(token) }, listTools);
    expect(reply.status).toBe(403);
    expect(reply.body).not.toContain("search_genes");
  });

  it("checks Host before the token", async () => {
    expect((await send(port, { Host: "rebind.example" }, listTools)).status).toBe(403);
  });

  describe("a preflight", () => {
    const preflight = (headers: Record<string, string>) =>
      send(port, { "Access-Control-Request-Method": "POST", ...headers }, null, { method: "OPTIONS" });

    it("needs no token and answers with CORS headers only", async () => {
      const origin = `http://localhost:${port}`;
      const reply = await preflight({ ...local(), Origin: origin });
      expect(reply.status).toBe(204);
      expect(reply.headers["access-control-allow-origin"]).toBe(origin);
      expect(reply.headers["access-control-allow-headers"]).toContain("Authorization");
      expect(reply.body).toBe("");
    });

    it("is refused from a forged Origin", async () => {
      const reply = await preflight({ ...local(), Origin: "http://rebind.example" });
      expect(reply.status).toBe(403);
      expect(reply.headers["access-control-allow-origin"]).toBe("");
    });

    it("is refused when addressed to a forged Host", async () => {
      expect((await preflight({ Host: "rebind.example" })).status).toBe(403);
    });
  });

  describe("the MCP SDK client", () => {
    const connect = async (value?: string) => {
      const client = new Client({ name: "access-token-test", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(url(), {
        requestInit: value ? { headers: bearer(value) } : undefined,
      });
      await client.connect(transport);
      return client;
    };

    it("lists and calls tools with the right token", async () => {
      const client = await connect(token);
      try {
        expect((await client.listTools()).tools.map((t) => t.name)).toContain("search_genes");
        const status = (await client.callTool({ name: "auth_status", arguments: {} })) as {
          content: Array<{ text: string }>;
        };
        expect(status.content[0].text).toContain("is_logged_in");
      } finally {
        await client.close();
      }
    });

    it("cannot connect with no token", async () => {
      await expect(connect()).rejects.toThrow(/requires its access token/);
    });

    it("cannot connect with the wrong token", async () => {
      await expect(connect(wrongTokens[0])).rejects.toThrow(/requires its access token/);
    });
  });
});

describe("a server started with the environment variable", () => {
  let port = 0;
  const local = () => ({ Host: `127.0.0.1:${port}` });
  const bin = join(work, "bin");

  beforeAll(async () => {
    mkdirSync(bin);
    const fake = join(bin, "rotifer");
    writeFileSync(fake, `#!/bin/sh\necho "inherited=\${${TOKEN_VAR}-absent}"\n`);
    chmodSync(fake, 0o755);
    port = await launch([], {
      ...baseEnv,
      [TOKEN_VAR]: token,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    });
  }, 30_000);

  it("requires that token", async () => {
    expectUnauthorized(await send(port, local(), listTools));
    expect((await send(port, { ...local(), ...bearer(token) }, listTools)).status).toBe(200);
  });

  it.skipIf(process.platform === "win32")("does not pass it to the CLI processes that tools start", async () => {
    const reply = await send(
      port,
      { ...local(), ...bearer(token) },
      { method: "tools/call", params: { name: "doctor", arguments: {} } },
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("inherited=absent");
    expect(reply.body).not.toContain(token);
  }, 30_000);
});

describe("a server reachable from other machines", () => {
  let port = 0;

  beforeAll(async () => {
    port = await launch(["--host", "0.0.0.0", "--allowed-hosts", "mcp.example.com", "--token-file", tokenFile]);
  }, 30_000);

  it("needs the token under its allowed name", async () => {
    expectUnauthorized(await send(port, { Host: "mcp.example.com" }, listTools));
    expect((await send(port, { Host: "mcp.example.com", ...bearer(token) }, listTools)).status).toBe(200);
  });

  it("still refuses a name that is not on the list", async () => {
    expect((await send(port, { Host: "rebind.example", ...bearer(token) }, listTools)).status).toBe(403);
  });

  it("warns that traffic is not encrypted", () => {
    expect(output.join("")).toContain("HTTPS reverse proxy or tunnel");
  });
});

// Vitest runs the describes in order, so this sees everything printed above.
describe("what the servers printed", () => {
  it("contains no token, right or wrong", () => {
    const printed = output.join("");
    expect(printed).toContain("listening on");
    for (const value of [token, ...wrongTokens.slice(1)]) expect(printed).not.toContain(value);
  });
});
