import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * logMcpCall reports with the signed-in user's token (T-74): the registry
 * records the caller from the token and no longer counts a report without
 * one. So the token has to be there, renewed when it has expired, and a
 * sign-in that cannot be renewed has to be said out loud rather than leave
 * the call count quietly frozen (T-72 review r2, risk R3).
 */

const auth = vi.hoisted(() => ({
  current: null as null | Record<string, any>,
  stored: null as null | Record<string, any>,
  saved: [] as Array<Record<string, any>>,
}));

vi.mock("../../src/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth.js")>("../../src/auth.js");
  return {
    ...actual,
    loadCredentials: () => auth.current,
    loadStoredCredentials: () => auth.stored,
    saveCredentials: (c: Record<string, any>) => { auth.saved.push(c); },
  };
});

const USER = { id: "user-123", username: "someone", avatar_url: null, provider_id: "" };
const valid = (token = "token-valid") => ({
  access_token: token, refresh_token: "refresh-1", expires_at: Date.now() + 3_600_000, provider: "github", user: USER,
});
const expired = () => ({
  access_token: "token-old", refresh_token: "refresh-1", expires_at: Date.now() - 1_000, provider: "github", user: USER,
});

type Call = { url: string; init: any };

function fakeFetch(opts: { refresh?: { status: number; body?: any }; report?: { status: number } } = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/auth/v1/token")) {
      const r = opts.refresh ?? { status: 200, body: { access_token: "token-new", refresh_token: "refresh-2", expires_in: 3600 } };
      return { ok: r.status < 300, status: r.status, json: async () => r.body ?? {} } as any;
    }
    const r = opts.report ?? { status: 204 };
    return { ok: r.status < 300, status: r.status, json: async () => ({}) } as any;
  });
  return { fn, calls };
}

const reports = (calls: Call[]) => calls.filter((c) => c.url.includes("/rpc/log_mcp_call"));
const renewals = (calls: Call[]) => calls.filter((c) => c.url.includes("/auth/v1/token?grant_type=refresh_token"));
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("logMcpCall reports with the user's token", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalFlag: string | undefined;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalFlag = process.env.ROTIFER_TELEMETRY;
    delete process.env.ROTIFER_TELEMETRY;
    auth.current = null;
    auth.stored = null;
    auth.saved = [];
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.ROTIFER_TELEMETRY;
    else process.env.ROTIFER_TELEMETRY = originalFlag;
    vi.restoreAllMocks();
  });

  it("sends the access token, and the account as p_caller for a registry without T-74", async () => {
    auth.current = auth.stored = valid();
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await vi.waitFor(() => expect(reports(calls)).toHaveLength(1));
    const [report] = reports(calls);
    expect(report.init.method).toBe("POST");
    expect(report.init.headers.Authorization).toBe("Bearer token-valid");
    const body = JSON.parse(report.init.body);
    expect(body).toMatchObject({ p_tool_name: "search_genes", p_success: true, p_latency_ms: 42, p_gene_id: null, p_caller: "user-123" });
    expect(renewals(calls)).toHaveLength(0);
  });

  it("includes gene_id when provided", async () => {
    auth.current = auth.stored = valid();
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "run_gene", gene_id: "abc-123", success: true, latency_ms: 100 });

    await vi.waitFor(() => expect(reports(calls)).toHaveLength(1));
    expect(JSON.parse(reports(calls)[0].init.body).p_gene_id).toBe("abc-123");
  });

  it("sends nothing when nobody is signed in", async () => {
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await settle();
    expect(calls).toHaveLength(0);
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(["0", "false", "off", "OFF", " 0 "])(
    "sends nothing, and renews nothing, when ROTIFER_TELEMETRY=%s",
    async (flag) => {
      process.env.ROTIFER_TELEMETRY = flag;
      auth.stored = expired();
      const { fn, calls } = fakeFetch();
      globalThis.fetch = fn;

      const { logMcpCall } = await import("../../src/cloud.js");
      logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

      await settle();
      expect(calls).toHaveLength(0);
    },
  );

  // Any other value is not an opt-out.
  it("still sends when ROTIFER_TELEMETRY is set to something else", async () => {
    process.env.ROTIFER_TELEMETRY = "1";
    auth.current = auth.stored = valid();
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await vi.waitFor(() => expect(reports(calls)).toHaveLength(1));
  });

  it("renews an expired token, saves it, and reports with the new one", async () => {
    auth.stored = expired();
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await vi.waitFor(() => expect(reports(calls)).toHaveLength(1));
    expect(renewals(calls)).toHaveLength(1);
    expect(JSON.parse(renewals(calls)[0].init.body)).toEqual({ refresh_token: "refresh-1" });
    expect(auth.saved).toHaveLength(1);
    expect(auth.saved[0]).toMatchObject({ access_token: "token-new", refresh_token: "refresh-2", user: USER });
    expect(reports(calls)[0].init.headers.Authorization).toBe("Bearer token-new");
  });

  it("renews once for reports made at the same time — a refresh token is single-use", async () => {
    auth.stored = expired();
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 1 });
    logMcpCall({ tool_name: "get_gene_detail", success: true, latency_ms: 2 });
    logMcpCall({ tool_name: "run_gene", success: true, latency_ms: 3 });

    await vi.waitFor(() => expect(reports(calls)).toHaveLength(3));
    expect(renewals(calls)).toHaveLength(1);
  });

  it("says once, on stderr, that calls are not being counted when renewal fails — and does not retry a refused token", async () => {
    auth.stored = expired();
    const { fn, calls } = fakeFetch({ refresh: { status: 400, body: { error: "invalid_grant" } } });
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 1 });
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledTimes(1));
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 1 });
    await settle();

    expect(reports(calls)).toHaveLength(0);
    expect(renewals(calls)).toHaveLength(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toMatch(/not being counted.*rotifer login/);
  });

  it("says so when the registry rejects the token", async () => {
    auth.current = auth.stored = valid();
    const { fn, calls } = fakeFetch({ report: { status: 401 } });
    globalThis.fetch = fn;

    const { logMcpCall } = await import("../../src/cloud.js");
    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 1 });

    await vi.waitFor(() => expect(stderr).toHaveBeenCalledTimes(1));
    expect(reports(calls)).toHaveLength(1);
    expect(String(stderr.mock.calls[0][0])).toMatch(/not being counted.*rotifer login/);
  });

  it("never throws: a network failure or an error status is the report's problem, not the tool's", async () => {
    auth.current = auth.stored = valid();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const { logMcpCall } = await import("../../src/cloud.js");
    expect(() => logMcpCall({ tool_name: "search_genes", success: false, latency_ms: 0 })).not.toThrow();

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(() => logMcpCall({ tool_name: "get_gene_detail", success: true, latency_ms: 50 })).not.toThrow();
    await settle();
  });
});
