import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `rotifer telemetry off` (run in the CLI) must stop this server's reports
 * too. Both read and write ~/.rotifer/telemetry.json on the same machine; up
 * to 0.19.4 this server read only DO_NOT_TRACK / ROTIFER_TELEMETRY, so a user
 * who switched telemetry off in the CLI kept being reported through every MCP
 * tool call (T-87). ADR-329: off means everything.
 *
 * The file below is written in exactly the shape the CLI's
 * setHeartbeatEnabled(false) writes. An unreadable file counts as "no
 * choice": telemetry must never break or block a tool call.
 */

const auth = vi.hoisted(() => ({ current: null as null | Record<string, any> }));

vi.mock("../../src/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth.js")>("../../src/auth.js");
  return {
    ...actual,
    loadCredentials: () => auth.current,
    loadStoredCredentials: () => auth.current,
    saveCredentials: () => {},
  };
});

const USER = { id: "user-123", username: "someone", avatar_url: null, provider_id: "" };
const signedIn = () => ({
  access_token: "token-valid", refresh_token: "refresh-1", expires_at: Date.now() + 3_600_000, provider: "github", user: USER,
});

const CLI_OFF = {
  enabled: false,
  machine_id: "3f1c2b7e-0d4a-4c51-9a7e-6b2f8e1d0c93",
  consent_source: "cli",
  first_run_notice_shown: true,
  updated_at: "2026-10-26T00:00:00.000Z",
};

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("reports honour the stored telemetry choice", () => {
  const savedEnv = { ...process.env };
  let home = "";
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rotifer-mcp-telemetry-"));
    process.env.HOME = home;
    delete process.env.ROTIFER_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    auth.current = signedIn();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as any);
    globalThis.fetch = fetchMock as any;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  const telemetryFile = () => join(home, ".rotifer", "telemetry.json");
  function writeTelemetryFile(content: string): void {
    mkdirSync(join(home, ".rotifer"), { recursive: true });
    writeFileSync(telemetryFile(), content);
  }

  it("logMcpCall sends nothing after `rotifer telemetry off`, with no environment variable set", async () => {
    writeTelemetryFile(JSON.stringify(CLI_OFF));
    const { logMcpCall } = await import("../../src/cloud.js");

    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logGeneInvocation sends nothing after `rotifer telemetry off`", async () => {
    writeTelemetryFile(JSON.stringify(CLI_OFF));
    const { logGeneInvocation } = await import("../../src/cloud.js");

    logGeneInvocation("gene-1", "mcp:dsh");
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("telemetryOptedOut() is true for a hand-written file that only says enabled: false", async () => {
    writeTelemetryFile(JSON.stringify({ enabled: false }));
    const { telemetryOptedOut } = await import("../../src/cloud.js");

    expect(telemetryOptedOut()).toBe(true);
  });

  it("still reports when the stored choice is on", async () => {
    writeTelemetryFile(JSON.stringify({ ...CLI_OFF, enabled: true }));
    const { logMcpCall } = await import("../../src/cloud.js");

    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rpc/log_mcp_call");
  });

  it("still reports when there is no file, and does not create one", async () => {
    const { logMcpCall } = await import("../../src/cloud.js");

    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(existsSync(telemetryFile())).toBe(false);
  });

  it.each(["", "{not json", "null", "[]"])("treats an unreadable file (%j) as no choice — reports, never throws", async (content) => {
    writeTelemetryFile(content);
    const { logMcpCall } = await import("../../src/cloud.js");

    expect(() => logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 1 })).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("an explicit ROTIFER_TELEMETRY=1 in this shell still wins over a stored off, as for the heartbeat", async () => {
    writeTelemetryFile(JSON.stringify(CLI_OFF));
    process.env.ROTIFER_TELEMETRY = "1";
    const { logMcpCall } = await import("../../src/cloud.js");

    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("DO_NOT_TRACK=1 still stops it over a stored on", async () => {
    writeTelemetryFile(JSON.stringify({ ...CLI_OFF, enabled: true }));
    process.env.DO_NOT_TRACK = "1";
    const { logMcpCall } = await import("../../src/cloud.js");

    logMcpCall({ tool_name: "search_genes", success: true, latency_ms: 42 });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
