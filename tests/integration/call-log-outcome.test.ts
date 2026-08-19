import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * The acceptance test for ADR-319 plan item 2.9: a call that fails must be
 * logged as a failure.
 *
 * It drives the real server through the real MCP transport and reads what
 * actually went out on the wire, because the defect lived in the seam — the
 * judging code and the logging code were each fine on their own, and the bug
 * was that the handler never asked. A unit test on either side would have
 * passed throughout.
 *
 * The `run_gene` shell-out is stubbed rather than executed: the point is the
 * seam, and a real shell-out would either need a compiled gene on disk or fall
 * back to `npx @rotifer/playground`, which reaches the network from CI.
 */

const SIGNED_IN = { user: { id: "user-2-9", username: "tester" }, provider: "github" };

async function serverWithCapturedLogs(runGeneResult: unknown) {
  vi.doMock("../../src/auth.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/auth.js")>("../../src/auth.js");
    return { ...actual, loadCredentials: () => SIGNED_IN };
  });
  vi.doMock("../../src/local.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/local.js")>("../../src/local.js");
    return { ...actual, runGene: () => runGeneResult };
  });

  const logged: Array<Record<string, unknown>> = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    if (String(url).includes("log_mcp_call")) {
      logged.push(JSON.parse(init.body));
    }
    return { ok: true, status: 201, json: async () => ({}), text: async () => "" } as any;
  }) as any;

  const { createServer } = await import("../../src/server.js");
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "outcome-test", version: "1.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    logged,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("mcp_call_log records the outcome, not the control flow", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalFlag = process.env.ROTIFER_TELEMETRY;
    delete process.env.ROTIFER_TELEMETRY;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.ROTIFER_TELEMETRY;
    else process.env.ROTIFER_TELEMETRY = originalFlag;
    vi.doUnmock("../../src/auth.js");
    vi.doUnmock("../../src/local.js");
    vi.restoreAllMocks();
  });

  /**
   * The regression. `run_gene` returning `{ success: false, exitCode: 1 }` is
   * the most common real failure there is, and the handler returns normally
   * from it — which is exactly why it used to be logged as a success.
   */
  it("logs success=false when a gene runs and fails", async () => {
    const { client, logged, cleanup } = await serverWithCapturedLogs({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "gene threw",
    });

    try {
      await client.callTool({ name: "run_gene", arguments: { gene_name: "broken" } });
      await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

      const entry = logged.find((e) => e.p_tool_name === "run_gene");
      expect(entry).toBeDefined();
      expect(entry!.p_success).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("logs success=true when the same call succeeds", async () => {
    const { client, logged, cleanup } = await serverWithCapturedLogs({
      success: true,
      exitCode: 0,
      stdout: "{}",
      stderr: "",
    });

    try {
      await client.callTool({ name: "run_gene", arguments: { gene_name: "working" } });
      await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

      const entry = logged.find((e) => e.p_tool_name === "run_gene");
      expect(entry!.p_success).toBe(true);
    } finally {
      await cleanup();
    }
  });

  /**
   * Invocation count and success count answer different questions, and plan
   * item 1.4 settled that a gene that ran and failed still ran. Pinning it here
   * so a later tightening of the success rule does not quietly take the
   * invocation record with it.
   */
  it("still records the invocation for a failed run", async () => {
    const { client, logged, cleanup } = await serverWithCapturedLogs({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "boom",
    });

    try {
      await client.callTool({ name: "run_gene", arguments: { gene_name: "broken" } });
      await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

      const call = logged.find((e) => e.p_tool_name === "run_gene");
      expect(call!.p_success).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
