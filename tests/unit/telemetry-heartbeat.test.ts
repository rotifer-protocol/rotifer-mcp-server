import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * recordHeartbeat() through the fake network boundary. Real production
 * behaviour (RPC reachable, upsert semantics, RLS) was verified against the
 * live database on the playground side of ADR-329 — this file is the
 * client-side contract specific to mcp-server: the channel argument, the
 * returned notice text (not printed — see heartbeat.ts's header for why),
 * and that every failure mode is silence.
 */
describe("recordHeartbeat", () => {
  let testHome: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  const savedEnv = { ...process.env };
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "mcp-heartbeat-"));
    process.env.HOME = testHome;
    process.env.ROTIFER_CLOUD_ENDPOINT = "https://cloud.example.test";
    process.env.ROTIFER_CLOUD_ANON_KEY = "anon-test-key";
    delete process.env.ROTIFER_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(testHome, { recursive: true, force: true });
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it("posts to record_heartbeat with the machine's id, the given channel, version, and delta 1", async () => {
    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");
    const { loadOrInitHeartbeatConfig } = await import("../../src/telemetry/config.js");
    const config = loadOrInitHeartbeatConfig();

    recordHeartbeat("mcp:dsh");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://cloud.example.test/rest/v1/rpc/record_heartbeat");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.apikey).toBe("anon-test-key");
    // No Authorization header — record_heartbeat is anon-callable by design.
    expect(init?.headers?.Authorization).toBeUndefined();

    const body = JSON.parse(String(init?.body));
    expect(body.p_machine_id).toBe(config.machine_id);
    expect(body.p_channel).toBe("mcp:dsh");
    expect(body.p_invocation_delta).toBe(1);
    expect(typeof body.p_client_version).toBe("string");
  });

  it("returns the first-run notice on the first call, and null on every call after", async () => {
    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");

    const first = recordHeartbeat("mcp");
    expect(first).toContain("Anonymous usage heartbeat");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const second = recordHeartbeat("mcp");
    expect(second).toBeNull();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("returns null and sends nothing when ROTIFER_TELEMETRY=0", async () => {
    process.env.ROTIFER_TELEMETRY = "0";
    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");

    const notice = recordHeartbeat("mcp");
    expect(notice).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null and sends nothing when DO_NOT_TRACK=1, even with ROTIFER_TELEMETRY=1", async () => {
    process.env.DO_NOT_TRACK = "1";
    process.env.ROTIFER_TELEMETRY = "1";
    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");

    expect(recordHeartbeat("mcp")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects a stored 'off' choice written by another process (e.g. playground's CLI)", async () => {
    // Simulates the shared-file contract: something else wrote enabled:false
    // to ~/.rotifer/telemetry.json before this process ever read it.
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(testHome, ".rotifer"), { recursive: true });
    writeFileSync(
      join(testHome, ".rotifer", "telemetry.json"),
      JSON.stringify({
        enabled: false,
        machine_id: "11111111-1111-4111-8111-111111111111",
        consent_source: "cli",
        first_run_notice_shown: true,
        updated_at: new Date().toISOString(),
      }),
    );

    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");
    expect(recordHeartbeat("mcp")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the network fails", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");

    expect(() => recordHeartbeat("mcp")).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });

  it("never throws when ~/.rotifer can't be created", async () => {
    // HOME points at a plain file, not a directory — mkdirSync(...,
    // {recursive:true}) for anything under it fails structurally (ENOTDIR).
    // Not a chmod-based permission test — that depends on the runner not
    // being root, which CI sometimes is.
    const { writeFileSync: write } = await import("node:fs");
    const blockerFile = join(tmpdir(), "mcp-heartbeat-blocker-" + Date.now());
    write(blockerFile, "not a directory");
    process.env.HOME = blockerFile;
    vi.resetModules();

    const { recordHeartbeat } = await import("../../src/telemetry/heartbeat.js");
    expect(() => recordHeartbeat("mcp")).not.toThrow();
    expect(recordHeartbeat("mcp")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    rmSync(blockerFile);
  });
});
