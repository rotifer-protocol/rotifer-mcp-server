import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The flush mechanism behind logGeneInvocation — the MCP server's half of
 * the §33.4 anti-manipulation ledger, mirroring playground's
 * tests/unit/cloud-invocation.test.ts for the CLI's recordGeneInvocation,
 * which this file's fix (cloud.ts's inFlight/flushInvocationReports/
 * FLUSH_TIMEOUT_MS) was modeled on directly.
 *
 * Unlike the CLI's version, logGeneInvocation() returns void rather than a
 * { settled } handle — this server tracks in-flight requests in a module-
 * level Set instead, so these tests observe behavior through
 * flushInvocationReports() rather than a per-call return value.
 */

const { loadCredentialsMock } = vi.hoisted(() => ({ loadCredentialsMock: vi.fn() }));
vi.mock("../../src/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth.js")>("../../src/auth.js");
  return { ...actual, loadCredentials: loadCredentialsMock };
});

const CLOUD_ID = "250243be-4f02-4a29-8d8a-fe8bc3609c76";
const USER_ID = "3fcaab49-3b61-4e75-9268-5bf90394b947";

describe("flushInvocationReports (MCP server)", () => {
  const savedEnv = { ...process.env };
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.ROTIFER_CLOUD_ENDPOINT = "https://cloud.example.test";
    process.env.ROTIFER_CLOUD_ANON_KEY = "anon-test-key";
    delete process.env.ROTIFER_TELEMETRY;
    loadCredentialsMock.mockReset();
    loadCredentialsMock.mockReturnValue({ access_token: "tok", user: { id: USER_ID } });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stderrSpy.mockRestore();
    process.env = { ...savedEnv };
  });

  it("resolves immediately when nothing is in flight", async () => {
    const { flushInvocationReports } = await import("../../src/cloud.js");
    await expect(flushInvocationReports(50)).resolves.toBeUndefined();
  });

  it("waits for an in-flight report to settle", async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { release = res; })));
    const { logGeneInvocation, flushInvocationReports } = await import("../../src/cloud.js");

    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");

    let flushed = false;
    const flushing = flushInvocationReports(5000).then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false); // still pending — this is the kill that used to lose it

    release(new Response(null, { status: 204 }));
    await flushing;
    expect(flushed).toBe(true);
  });

  it("gives up after the timeout rather than hanging shutdown forever", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => { /* never settles */ })));
    const { logGeneInvocation, flushInvocationReports } = await import("../../src/cloud.js");
    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");
    await expect(flushInvocationReports(30)).resolves.toBeUndefined();
  });

  /**
   * flushInvocationReports() giving up after the timeout (above) only stops
   * the *caller* from waiting — without aborting the fetch itself, a stalled
   * endpoint would hang the process for however long the OS's own TCP
   * timeout takes, not just FLUSH_TIMEOUT_MS. Same mechanism, same reasoning,
   * as playground's cloud/invocation.ts — mirrored here rather than
   * rediscovered.
   */
  it("aborts the underlying fetch after FLUSH_TIMEOUT_MS, not just the caller's wait", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { logGeneInvocation, FLUSH_TIMEOUT_MS } = await import("../../src/cloud.js");

    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
    expect(capturedSignal!.aborted).toBe(true);

    vi.useRealTimers();
  });

  it("stops tracking a report once it settles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const { logGeneInvocation, flushInvocationReports } = await import("../../src/cloud.js");
    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");
    // Let the fetch's .then/.finally chain actually run before asserting
    // nothing is left to wait for.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await expect(flushInvocationReports(0)).resolves.toBeUndefined();
  });

  /**
   * The debug-visibility gap this fix also closes: logGeneInvocation had no
   * ROTIFER_DEBUG output at all, unlike its CLI equivalent — found only by
   * bypassing the MCP layer entirely and unit-testing the function directly
   * (see this file's sibling E2E suite's top comment). A silently-eaten
   * error is exactly how the underlying bug went unnoticed for as long as
   * it did.
   */
  it("writes a failed HTTP status to stderr under ROTIFER_DEBUG", async () => {
    process.env.ROTIFER_DEBUG = "1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { logGeneInvocation } = await import("../../src/cloud.js");

    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("log_gene_invocation_v2");
    expect(written).toContain("500");
  });

  it("writes a network error to stderr under ROTIFER_DEBUG", async () => {
    process.env.ROTIFER_DEBUG = "1";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { logGeneInvocation } = await import("../../src/cloud.js");

    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("ECONNREFUSED");
  });

  it("stays silent on stderr without ROTIFER_DEBUG, even on failure", async () => {
    delete process.env.ROTIFER_DEBUG;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { logGeneInvocation, flushInvocationReports } = await import("../../src/cloud.js");

    logGeneInvocation(CLOUD_ID, USER_ID, "mcp:cursor");
    await flushInvocationReports(1000);

    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
