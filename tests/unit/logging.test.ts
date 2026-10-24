import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Usage is only reported for signed-in users, and the caller is the account
// behind the sign-in (T-74), so every case below runs signed in as SIGNED_IN.
const SIGNED_IN = "user-123";

vi.mock("../../src/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth.js")>("../../src/auth.js");
  return {
    ...actual,
    loadCredentials: () => ({ access_token: "tok", refresh_token: "r", expires_at: Date.now() + 3_600_000, user: { id: SIGNED_IN } }),
    loadStoredCredentials: () => null,
  };
});

// logMcpCall is covered in mcp-call-report.test.ts: it now reports with the
// signed-in user's token rather than a caller argument (T-74).

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
    logGeneInvocation("gene-1");

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rpc/log_gene_invocation");
    const body = JSON.parse(opts.body);
    expect(body.p_gene_id).toBe("gene-1");
    expect(body.p_caller_agent_id).toBe(SIGNED_IN);
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("sends the channel through v2 when given one", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logGeneInvocation } = await import("../../src/cloud.js");
    logGeneInvocation("gene-1", "mcp:dsh");

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rpc/log_gene_invocation_v2");
    const body = JSON.parse(opts.body);
    expect(body.p_client_channel).toBe("mcp:dsh");
    expect(body.p_gene_id).toBe("gene-1");
  });

  it("falls back to the original RPC when no channel is supplied", async () => {
    // A registry that has not applied migration 20260830000000 has no v2 to
    // call. Losing the attribution must never cost the invocation itself.
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logGeneInvocation } = await import("../../src/cloud.js");
    logGeneInvocation("gene-1");

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/rpc\/log_gene_invocation$/);
    expect(JSON.parse(opts.body)).not.toHaveProperty("p_client_channel");
  });

  // Opting out means all of it, not just the half the user happened to read
  // about.
  it("sends nothing when ROTIFER_TELEMETRY=0", async () => {
    process.env.ROTIFER_TELEMETRY = "0";
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = mockFetch;

    const { logGeneInvocation } = await import("../../src/cloud.js");
    logGeneInvocation("gene-1");

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
