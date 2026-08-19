import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Every case names a caller unless it is testing the signed-out path: usage is
// only reported for signed-in users now, so omitting it silently tests nothing.
const SIGNED_IN = "user-123";

describe("logMcpCall (fire-and-forget)", () => {
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
    vi.restoreAllMocks();
  });

  it("sends POST to mcp_call_log endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({
      tool_name: "search_genes",
      success: true,
      latency_ms: 42,
      caller: SIGNED_IN,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rpc/log_mcp_call");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.p_tool_name).toBe("search_genes");
    expect(body.p_success).toBe(true);
    expect(body.p_latency_ms).toBe(42);
    expect(body.p_gene_id).toBeNull();
    expect(body.p_caller).toBe(SIGNED_IN);
  });

  it("includes gene_id when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({
      tool_name: "run_gene",
      gene_id: "abc-123",
      success: true,
      latency_ms: 100,
      caller: "cursor",
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.p_gene_id).toBe("abc-123");
    expect(body.p_caller).toBe("cursor");
  });

  // Reporting used to happen for everyone, the anon key being enough to write
  // the row. Someone who only ran `npx` has no account and was never in a
  // position to be told, so there is nothing to report about them.
  it.each([
    ["null caller", null],
    ["undefined caller", undefined],
    ["empty caller", ""],
  ])("sends nothing when signed out (%s)", async (_label, caller) => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({
      tool_name: "search_genes",
      success: true,
      latency_ms: 42,
      caller: caller as string | null | undefined,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(["0", "false", "off", "OFF", " 0 "])(
    "sends nothing when ROTIFER_TELEMETRY=%s, even signed in",
    async (flag) => {
      process.env.ROTIFER_TELEMETRY = flag;
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
      globalThis.fetch = mockFetch;

      const { logMcpCall } = await import("../../src/cloud.js");
      logMcpCall({
        tool_name: "search_genes",
        success: true,
        latency_ms: 42,
        caller: SIGNED_IN,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  // Any other value is not an opt-out. Guards against a future reader assuming
  // the variable is a boolean where merely being set means "off".
  it("still sends when ROTIFER_TELEMETRY is set to something else", async () => {
    process.env.ROTIFER_TELEMETRY = "1";
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({
      tool_name: "search_genes",
      success: true,
      latency_ms: 42,
      caller: SIGNED_IN,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });

  it("does not throw when fetch fails (fire-and-forget)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const { logMcpCall } = await import("../../src/cloud.js");
    expect(() => {
      logMcpCall({
        tool_name: "search_genes",
        success: false,
        latency_ms: 0,
        caller: SIGNED_IN,
      });
    }).not.toThrow();
  });

  it("does not throw when fetch returns error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const { logMcpCall } = await import("../../src/cloud.js");
    expect(() => {
      logMcpCall({
        tool_name: "get_gene_detail",
        success: true,
        latency_ms: 50,
        caller: SIGNED_IN,
      });
    }).not.toThrow();
  });
});

describe("logGeneInvocation", () => {
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
    vi.restoreAllMocks();
  });

  it("records the invocation for a signed-in caller", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logGeneInvocation } = await import("../../src/cloud.js");
    logGeneInvocation("gene-1", SIGNED_IN);

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rpc/log_gene_invocation");
    const body = JSON.parse(opts.body);
    expect(body.p_gene_id).toBe("gene-1");
    expect(body.p_caller_agent_id).toBe(SIGNED_IN);
  });

  // Opting out means all of it, not just the half the user happened to read
  // about.
  it("sends nothing when ROTIFER_TELEMETRY=0", async () => {
    process.env.ROTIFER_TELEMETRY = "0";
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logGeneInvocation } = await import("../../src/cloud.js");
    logGeneInvocation("gene-1", SIGNED_IN);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

/**
 * What used to sit here claimed to cover "logMcpCall on success and failure
 * paths" and asserted only that `createServer()` returned something — so it
 * passed throughout the whole period when every failure was being logged as a
 * success. The real coverage lives in
 * tests/integration/call-log-outcome.test.ts, which drives the server over the
 * MCP transport and reads what went out on the wire.
 */

/**
 * The two gates are deliberately different. `telemetryEnabled` also requires a
 * signed-in caller, because a usage record is about a person. The install
 * counter is not about a person, so it asks only whether reporting was switched
 * off — which is why the split exists at all.
 */
describe("telemetryOptedOut vs telemetryEnabled", () => {
  const originalFlag = process.env.ROTIFER_TELEMETRY;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ROTIFER_TELEMETRY;
    else process.env.ROTIFER_TELEMETRY = originalFlag;
  });

  it("treats being signed out as no usage reporting, but not as an opt-out", async () => {
    delete process.env.ROTIFER_TELEMETRY;
    const { telemetryOptedOut, telemetryEnabled } = await import("../../src/cloud.js");

    expect(telemetryEnabled(null)).toBe(false);
    expect(telemetryOptedOut()).toBe(false);
  });

  it.each(["0", "false", "off", "OFF", " 0 "])("treats %s as an opt-out for both", async (flag) => {
    process.env.ROTIFER_TELEMETRY = flag;
    const { telemetryOptedOut, telemetryEnabled } = await import("../../src/cloud.js");

    expect(telemetryOptedOut()).toBe(true);
    expect(telemetryEnabled(SIGNED_IN)).toBe(false);
  });

  it("treats any other value as no opt-out", async () => {
    process.env.ROTIFER_TELEMETRY = "1";
    const { telemetryOptedOut, telemetryEnabled } = await import("../../src/cloud.js");

    expect(telemetryOptedOut()).toBe(false);
    expect(telemetryEnabled(SIGNED_IN)).toBe(true);
  });
});
