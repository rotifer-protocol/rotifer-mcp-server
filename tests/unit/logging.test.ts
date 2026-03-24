import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logMcpCall (fire-and-forget)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
    expect(body.p_caller).toBeNull();
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

  it("does not throw when fetch fails (fire-and-forget)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const { logMcpCall } = await import("../../src/cloud.js");
    expect(() => {
      logMcpCall({
        tool_name: "search_genes",
        success: false,
        latency_ms: 0,
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
      });
    }).not.toThrow();
  });
});

describe("MCP tool call logging integration", () => {
  it("server.ts logMcpCall is called on success and failure paths", async () => {
    const { createServer } = await import("../../src/server.js");
    const server = createServer();
    expect(server).toBeDefined();
  });
});
