import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Black-box regression for the MCP channel (Cursor/Claude Code/etc., via
 * this server). The playground CLI bug — a fire-and-forget heartbeat
 * request that a short-lived process can outrun — was analyzed as
 * architecturally absent here, because this server is long-lived: it
 * answers `initialize` over stdio and keeps running until the host closes
 * the connection, not "runs one command and exits" the way a CLI
 * invocation does. That analysis was never run end to end, so this file
 * runs it: spawn the real built server (dist/index.js) as its own process,
 * talk to it over the real stdio MCP transport (not InMemoryTransport,
 * which shares this process and therefore proves nothing about process
 * lifetime), call `run_gene` for real against a real local gene, and
 * check what a fake cloud endpoint actually received.
 *
 * Two things this file checks that the "it's long-lived, so it's fine"
 * analysis could not have found on its own:
 *
 * 1. Ordinary case: does the heartbeat this server sends on `run_gene`
 *    actually arrive, with channel `mcp:<host>` derived from the client's
 *    declared name? (server.ts:717, channel.ts's resolveMcpChannel.)
 *
 * 2. The one way "long-lived" could still lose a request: this server
 *    shells out to the real `rotifer` CLI via spawnSync (local.ts) to
 *    execute the gene — synchronous, so the tool handler is blocked until
 *    that child fully exits before this server's own recordHeartbeat()
 *    (server.ts:717) even runs. If a host closes the stdio connection the
 *    instant callTool() resolves — not implausible; MCP hosts are not
 *    obligated to linger — does this server's own fire-and-forget request,
 *    started after callTool() has already returned to the client, get a
 *    chance to leave before the process is torn down? Tested by closing
 *    the client transport immediately after the tool call resolves, with
 *    no grace period, and checking whether the fake server still saw the
 *    request.
 */

const CLI = join(__dirname, "..", "..", "dist", "index.js");
// A gene the real, already-installed `rotifer` CLI on this machine can
// execute directly (local.ts's rotiferCmd finds it via `which rotifer` —
// confirmed present on this machine — before falling back to a
// network-reaching `npx @rotifer/playground`).
function makeGeneWorkspace(): string {
  const dir = join(tmpdir(), "rotifer-mcp-heartbeat-e2e-" + randomUUID());
  mkdirSync(join(dir, "genes", "hb-mcp-gene"), { recursive: true });
  writeFileSync(
    join(dir, "rotifer.json"),
    JSON.stringify({ name: "mcp-heartbeat-e2e", version: "0.1.0", author: "test", genes_dir: "genes", default_domain: "general" }),
  );
  writeFileSync(
    join(dir, "genes", "hb-mcp-gene", "phenotype.json"),
    JSON.stringify({ domain: "general", inputSchema: { type: "object" }, outputSchema: { type: "object" }, version: "0.1.0", fidelity: "Wrapped" }, null, 2),
  );
  writeFileSync(join(dir, "genes", "hb-mcp-gene", "index.ts"), "export function express(input) { return { ok: true, ...input }; }\n");
  return dir;
}

interface RecordedRequest {
  path: string;
  body: unknown;
}

function startFakeCloud(): { server: Server; url: string; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "null");
      } catch {
        /* not JSON */
      }
      requests.push({ path: req.url || "", body });
      res.writeHead(204);
      res.end();
    });
  });
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, requests };
}

describe("MCP channel heartbeat delivery — real stdio process, not InMemoryTransport", () => {
  let fakeCloud: ReturnType<typeof startFakeCloud>;
  let projectDir: string;
  let fakeHome: string;

  beforeAll(() => {
    fakeCloud = startFakeCloud();
  });

  afterAll(() => {
    fakeCloud.server.close();
  });

  beforeEach(() => {
    projectDir = makeGeneWorkspace();
    fakeHome = mkdtempSync(join(tmpdir(), "rotifer-mcp-heartbeat-e2e-home-"));
    fakeCloud.requests.length = 0;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function connect(clientName: string): { client: Client; transport: StdioClientTransport } {
    // Same VITEST/JEST_WORKER_ID/NODE_ENV stripping as the playground CLI
    // suite this file is modeled on — recordHeartbeat() refuses to report
    // under a test runner (runningUnderTest()), and StdioClientTransport
    // otherwise inherits this process's full env into the child.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "VITEST" && k !== "JEST_WORKER_ID" && k !== "NODE_ENV") env[k] = v;
    }
    env.HOME = fakeHome;
    env.ROTIFER_CLOUD_ENDPOINT = fakeCloud.url;
    env.ROTIFER_CLOUD_ANON_KEY = "test-anon-key";
    env.ROTIFER_TELEMETRY = "1";
    env.DO_NOT_TRACK = "";

    const transport = new StdioClientTransport({ command: "node", args: [CLI], env });
    const client = new Client({ name: clientName, version: "1.0.0" });
    return { client, transport };
  }

  it("run_gene sends this server's own heartbeat with channel mcp:<host>, derived from the client's declared name", async () => {
    const { client, transport } = connect("cursor-e2e-test");
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "run_gene",
        arguments: { gene_name: "hb-mcp-gene", project_root: projectDir, input: "{}" },
      });
      expect(result.isError).toBeFalsy();

      // Fire-and-forget on this server's side too — give it a moment to
      // actually leave before asserting on what arrived, same as the
      // production/E2E pattern in the playground repo's equivalent suite.
      await vi.waitFor(
        () => expect(fakeCloud.requests.some((r) => r.path.includes("record_heartbeat"))).toBe(true),
        { timeout: 5000 },
      );

      const heartbeats = fakeCloud.requests.filter((r) => r.path.includes("record_heartbeat"));
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);
      expect((heartbeats[0].body as any).p_channel).toBe("mcp:cursor_e2e_test");
    } finally {
      await client.close();
    }
  }, 30000);

  /**
   * The scenario the "it's long-lived, so it's fine" analysis could not
   * rule out on its own: this server's own recordHeartbeat() (server.ts:717)
   * runs only after the synchronous shellExec to the real CLI has already
   * returned — so it starts late in the handler, and a host that tears the
   * connection down the instant callTool() resolves gives it less runway
   * than the ordinary case above. No delay, no grace period: close()
   * immediately, then check what the fake server actually received.
   */
  it("still delivers the heartbeat when the client closes the connection immediately after the tool call resolves — no grace period", async () => {
    const { client, transport } = connect("claude-code-e2e-test");
    await client.connect(transport);

    const result = await client.callTool({
      name: "run_gene",
      arguments: { gene_name: "hb-mcp-gene", project_root: projectDir, input: "{}" },
    });
    expect(result.isError).toBeFalsy();

    // The load-bearing step: close immediately, no waiting, no delay —
    // simulating a host that does not linger after its call returns.
    await client.close();

    // Now check from outside, exactly like the CLI suite: the connection
    // (and, if the server tears down its process on stdio close, the
    // process itself) is already gone by the time this runs. If the
    // heartbeat was still in flight when that happened, it's gone — there
    // is deliberately no "wait a bit and see" here, because a host that
    // does not linger gives none either.
    await new Promise((r) => setTimeout(r, 500));
    const heartbeats = fakeCloud.requests.filter((r) => r.path.includes("record_heartbeat"));
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
    expect((heartbeats[0].body as any).p_channel).toBe("mcp:claude_code_e2e_test");
  }, 30000);
});
