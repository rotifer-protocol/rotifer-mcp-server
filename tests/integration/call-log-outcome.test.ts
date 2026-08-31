import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runGene } from "../../src/local.js";
import { createServer } from "../../src/server.js";

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
 *
 * Rewritten 2026-08-31 from a per-test `vi.doMock` + `vi.resetModules()` +
 * fresh dynamic `import("../../src/server.js")` — three tests, each
 * re-registering mocks and re-importing the whole module graph from scratch.
 * That pattern was reported flaky (this exact file, ~1-in-3 locally at the
 * time), and `toolCallSucceeded()` (src/call-outcome.ts) is a pure function of
 * its `result` argument with no shared mutable state to race on — the only way
 * a test here could see the *wrong* boolean is if it ran against a *stale*
 * mock, i.e. a `runGeneResult` closure left over from a different test's
 * `vi.doMock` registration. Repeated re-mock + re-import per test is exactly
 * the shape of thing that can leave stale registry state on some runs and not
 * others; a single hoisted `vi.mock` with one server built once and a mock
 * return value swapped per test removes that whole mechanism rather than
 * trying to sequence it correctly. Could not reproduce the original failure
 * locally (21 runs of the old version, 0 failures) to confirm this is the
 * exact mechanism — see the PR this shipped in for the honest account of what
 * is and isn't proven here.
 */

const SIGNED_IN = { user: { id: "user-2-9", username: "tester" }, provider: "github" };

vi.mock("../../src/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth.js")>("../../src/auth.js");
  return { ...actual, loadCredentials: () => SIGNED_IN };
});

vi.mock("../../src/local.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/local.js")>("../../src/local.js");
  return { ...actual, runGene: vi.fn() };
});

let client: Client;
let cleanup: () => Promise<void>;
let logged: Array<Record<string, unknown>>;
let originalFetch: typeof globalThis.fetch;
let originalFlag: string | undefined;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "outcome-test", version: "1.0.0" });
  await client.connect(clientTransport);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterAll(async () => {
  await cleanup?.();
});

describe("mcp_call_log records the outcome, not the control flow", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalFlag = process.env.ROTIFER_TELEMETRY;
    delete process.env.ROTIFER_TELEMETRY;

    logged = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      if (String(url).includes("log_mcp_call")) {
        logged.push(JSON.parse(init.body));
      }
      return { ok: true, status: 201, json: async () => ({}), text: async () => "" } as any;
    }) as any;

    vi.mocked(runGene).mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.ROTIFER_TELEMETRY;
    else process.env.ROTIFER_TELEMETRY = originalFlag;
  });

  /**
   * The regression. `run_gene` returning `{ success: false, exitCode: 1 }` is
   * the most common real failure there is, and the handler returns normally
   * from it — which is exactly why it used to be logged as a success.
   */
  it("logs success=false when a gene runs and fails", async () => {
    vi.mocked(runGene).mockReturnValue({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "gene threw",
    });

    await client.callTool({ name: "run_gene", arguments: { gene_name: "broken" } });
    await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

    const entry = logged.find((e) => e.p_tool_name === "run_gene");
    expect(entry).toBeDefined();
    expect(entry!.p_success).toBe(false);
  });

  it("logs success=true when the same call succeeds", async () => {
    vi.mocked(runGene).mockReturnValue({
      success: true,
      exitCode: 0,
      stdout: "{}",
      stderr: "",
    });

    await client.callTool({ name: "run_gene", arguments: { gene_name: "working" } });
    await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

    const entry = logged.find((e) => e.p_tool_name === "run_gene");
    expect(entry!.p_success).toBe(true);
  });

  /**
   * Invocation count and success count answer different questions, and plan
   * item 1.4 settled that a gene that ran and failed still ran. Pinning it here
   * so a later tightening of the success rule does not quietly take the
   * invocation record with it.
   */
  it("still records the invocation for a failed run", async () => {
    vi.mocked(runGene).mockReturnValue({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "boom",
    });

    await client.callTool({ name: "run_gene", arguments: { gene_name: "broken" } });
    await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

    const call = logged.find((e) => e.p_tool_name === "run_gene");
    expect(call!.p_success).toBe(false);
  });
});
