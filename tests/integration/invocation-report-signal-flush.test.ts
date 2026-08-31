import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FLUSH_TIMEOUT_MS } from "../../src/cloud.js";

/**
 * Black-box regression for the fix in cloud.ts's logGeneInvocation +
 * index.ts's SIGINT/SIGTERM handlers.
 *
 * The bug, confirmed by hand (2026-08-30): a diagnostic script spawned this
 * server, drove it through a real MCP handshake, called `run_gene`, and
 * killed the process the instant the tool response came back. The §33.4
 * invocation report — sent fire-and-forget after the response was already on
 * its way — never landed. No error, no ROTIFER_DEBUG output, nothing.
 *
 * This is a different scenario from
 * tests/integration/heartbeat-mcp-channel-delivery.test.ts's "no grace
 * period" case, which closes the *client* transport (client.close()) — a
 * graceful stdio close, after which this server's own open fetch keeps
 * Node's event loop alive on its own without any special handling. What this
 * file covers is what bypasses that entirely: an explicit SIGTERM sent to
 * the server's own pid, matching a host that spawns → calls → kills.
 *
 * First draft of this test asserted "did the fake server receive the
 * request", against a fake server that responds immediately — and passed
 * even with the fix fully reverted (confirmed by hand: reverted both
 * cloud.ts and index.ts, reran, still green). Root cause is the same lesson
 * documented at length in playground's telemetry-heartbeat-delivery.test.ts:
 * a POST's outbound bytes are handed to the OS socket buffer synchronously
 * when fetch() is called, well before SIGTERM has any chance to interrupt
 * anything — a fast local loopback response arrives regardless of whether
 * the fix exists, so "did the request arrive" cannot distinguish fixed code
 * from unfixed code here. The one thing that can: whether the process
 * actually waits near FLUSH_TIMEOUT_MS before dying (proof the SIGTERM
 * handler ran flushInvocationReports() at all) versus dying within
 * milliseconds of the signal (proof no handler exists) — measured against a
 * cloud endpoint that never responds, so nothing about a fast reply can
 * short-circuit the timing.
 */

const CLI = join(__dirname, "..", "..", "dist", "index.js");
const CLOUD_ID = "b7e4a1f2-3c9d-4e8a-9f1b-2d6c8a5e0f31";
const USER_ID = "signal-flush-test-user";
// Wide margin above FLUSH_TIMEOUT_MS: this suite spawns a real child process
// and drives a real MCP handshake + tool call, and running under the full
// suite (28+ files, real subprocess spawns competing for the same machine)
// measurably slows wall-clock timing versus running this file alone — caught
// by hand: passed in isolation, timed out at exactly UPPER_BOUND_MS under
// full-suite contention. 20s of headroom absorbs that without weakening what
// the lower bound actually proves.
const UPPER_BOUND_MS = FLUSH_TIMEOUT_MS + 20_000;
// Kept tight, unlike the upper bound: this is what actually proves the
// SIGTERM handler ran flushInvocationReports() rather than dying instantly
// (confirmed by hand: an unhandled SIGTERM kills this process in <200ms,
// consistently, including under full-suite contention — the reverted-fix
// case failed at 52ms, nowhere near this line even under load).
const LOWER_BOUND_MS = FLUSH_TIMEOUT_MS - 1000;

function makeCloudGeneWorkspace(): string {
  const dir = join(tmpdir(), "rotifer-mcp-signalflush-e2e-" + randomUUID());
  const geneDir = join(dir, "genes", "sig-gene");
  mkdirSync(geneDir, { recursive: true });
  writeFileSync(
    join(dir, "rotifer.json"),
    JSON.stringify({ name: "mcp-signalflush-e2e", version: "0.1.0", author: "test", genes_dir: "genes", default_domain: "general" }),
  );
  writeFileSync(
    join(geneDir, "phenotype.json"),
    JSON.stringify({ domain: "general", inputSchema: { type: "object" }, outputSchema: { type: "object" }, version: "0.1.0", fidelity: "Wrapped" }, null, 2),
  );
  writeFileSync(join(geneDir, "index.ts"), "export function express(input) { return { ok: true, ...input }; }\n");
  // .cloud-manifest.json is what resolveLocalGeneCloudId() (local.ts) reads
  // to give extractGeneId() (server.ts) something to attribute the
  // invocation report to at all.
  writeFileSync(
    join(geneDir, ".cloud-manifest.json"),
    JSON.stringify({ cloud_id: CLOUD_ID, owner: "e2e-test-owner", version: "0.1.0" }, null, 2),
  );
  return dir;
}

/** What `rotifer login` leaves on disk — loadCredentials() just reads and JSON.parses this, no OAuth involved. */
function writeSignedInCredentials(fakeHome: string): void {
  mkdirSync(join(fakeHome, ".rotifer"), { recursive: true });
  writeFileSync(
    join(fakeHome, ".rotifer", "credentials.json"),
    JSON.stringify({
      access_token: "e2e-signal-flush-token",
      refresh_token: "e2e-signal-flush-refresh",
      expires_at: Date.now() + 3600_000,
      provider: "github",
      user: { id: USER_ID, username: "signal-flush-tester" },
    }),
  );
}

/** Receives the request in full but never responds — see this file's top comment for why. */
function startHangingCloud(): { server: Server; url: string; requestsSeen: { count: number } } {
  const requestsSeen = { count: 0 };
  const server = createServer((req) => {
    req.on("data", () => {});
    req.on("end", () => {
      requestsSeen.count++;
      // No res.end() — ever.
    });
  });
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, requestsSeen };
}

/** Polls for the process actually having exited (ESRCH from kill(pid, 0)), and returns elapsed ms. */
async function waitForProcessDeath(pid: number, maxMs: number): Promise<{ died: boolean; elapsedMs: number }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      process.kill(pid, 0); // signal 0: existence/permission check only, sends nothing
    } catch {
      return { died: true, elapsedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { died: false, elapsedMs: Date.now() - start };
}

describe("logGeneInvocation survives an explicit kill — real stdio process, real SIGTERM", () => {
  let hangingCloud: ReturnType<typeof startHangingCloud>;
  let projectDir: string;
  let fakeHome: string;

  beforeEach(() => {
    hangingCloud = startHangingCloud();
    projectDir = makeCloudGeneWorkspace();
    fakeHome = mkdtempSync(join(tmpdir(), "rotifer-mcp-signalflush-e2e-home-"));
    writeSignedInCredentials(fakeHome);
  });

  afterEach(() => {
    hangingCloud.server.close();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function connect(): { client: Client; transport: StdioClientTransport } {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "VITEST" && k !== "JEST_WORKER_ID" && k !== "NODE_ENV") env[k] = v;
    }
    env.HOME = fakeHome;
    env.ROTIFER_CLOUD_ENDPOINT = hangingCloud.url;
    env.ROTIFER_CLOUD_ANON_KEY = "test-anon-key";
    env.ROTIFER_TELEMETRY = "1";
    env.DO_NOT_TRACK = "";
    env.ROTIFER_DEBUG = "1";
    // Restricted capability, unrelated to this fix — just what makes an
    // uncompiled Cloud-installed fixture gene runnable via the CLI shell-out.
    env.ROTIFER_MCP_ALLOW = "trust-unsigned";

    const transport = new StdioClientTransport({ command: "node", args: [CLI], env, stderr: "pipe" });
    const client = new Client({ name: "signal-flush-e2e", version: "1.0.0" });
    return { client, transport };
  }

  /**
   * The regression, reproduced exactly: call run_gene, then SIGTERM the
   * server's own pid the instant the response is back. The endpoint never
   * responds, so the request cannot actually be delivered end to end either
   * way — what this proves is that the SIGTERM handler intercepts at all and
   * gives the in-flight report its full, bounded window rather than letting
   * the default SIGTERM action kill the process on the spot.
   */
  it("waits out FLUSH_TIMEOUT_MS before exiting, instead of dying within milliseconds of SIGTERM", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const pid = transport.pid;
    expect(pid).not.toBeNull();

    try {
      const result = await client.callTool({
        name: "run_gene",
        arguments: { gene_name: "sig-gene", project_root: projectDir, input: "{}", trust_unsigned: true },
      });
      expect(result.isError).toBeFalsy();

      // The endpoint has to have actually seen the request before killing —
      // otherwise this would just be testing that the process exits fast
      // when there was never anything to flush.
      const deadline = Date.now() + 3000;
      while (hangingCloud.requestsSeen.count === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(hangingCloud.requestsSeen.count).toBeGreaterThan(0);

      process.kill(pid!, "SIGTERM");

      const { died, elapsedMs } = await waitForProcessDeath(pid!, UPPER_BOUND_MS);
      expect(died, `process did not exit within ${UPPER_BOUND_MS}ms of SIGTERM`).toBe(true);
      expect(
        elapsedMs,
        `process exited after only ${elapsedMs}ms — the SIGTERM handler either isn't installed or isn't waiting for flushInvocationReports()`,
      ).toBeGreaterThanOrEqual(LOWER_BOUND_MS);
    } finally {
      await client.close().catch(() => {});
    }
  }, UPPER_BOUND_MS + 15_000);
});
