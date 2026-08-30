import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ~/.rotifer/telemetry.json — shared, in practice, with rotifer-playground
 * on the same machine. Each test gets its own HOME via vi.resetModules() +
 * a fresh dynamic import, so nothing here touches the real ~/.rotifer/ this
 * process happens to be running under.
 *
 * mcp-server does not implement setHeartbeatEnabled — there is no `rotifer
 * telemetry on|off` equivalent here; users manage the stored choice through
 * playground's CLI and this process just reads what it wrote. See config.ts.
 */
describe("telemetry/config", () => {
  let testHome: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "mcp-telemetry-"));
    process.env.HOME = testHome;
    delete process.env.ROTIFER_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it("mints a random machine_id on first read and persists it", async () => {
    const { loadOrInitHeartbeatConfig } = await import("../../src/telemetry/config.js");
    const first = loadOrInitHeartbeatConfig();
    expect(first.machine_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first.enabled).toBe(true);
    expect(first.first_run_notice_shown).toBe(false);

    const second = loadOrInitHeartbeatConfig();
    expect(second.machine_id).toBe(first.machine_id); // same file, not re-minted
  });

  it("writes telemetry.json with 0600 permissions", async () => {
    const { loadOrInitHeartbeatConfig } = await import("../../src/telemetry/config.js");
    loadOrInitHeartbeatConfig();
    const mode = statSync(join(testHome, ".rotifer", "telemetry.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("a machine_id minted here is what a playground process reading the same file would see", async () => {
    // Not a real cross-package test (that would need both installed in one
    // harness) — this pins the on-disk shape's field names, which is the
    // actual contract between the two processes.
    const { loadOrInitHeartbeatConfig } = await import("../../src/telemetry/config.js");
    const { readFileSync } = await import("node:fs");
    loadOrInitHeartbeatConfig();
    const raw = JSON.parse(readFileSync(join(testHome, ".rotifer", "telemetry.json"), "utf-8"));
    expect(Object.keys(raw).sort()).toEqual(
      ["consent_source", "enabled", "first_run_notice_shown", "machine_id", "updated_at"].sort(),
    );
  });

  it("a corrupt file is treated as absent — remints rather than refusing to run", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(testHome, ".rotifer"), { recursive: true });
    writeFileSync(join(testHome, ".rotifer", "telemetry.json"), "{ not json");

    const { loadOrInitHeartbeatConfig } = await import("../../src/telemetry/config.js");
    const config = loadOrInitHeartbeatConfig();
    expect(config.machine_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(config.enabled).toBe(true);
  });

  it("marks the first-run notice shown exactly once, persisted", async () => {
    const { loadOrInitHeartbeatConfig, markFirstRunNoticeShown } = await import("../../src/telemetry/config.js");
    const config = loadOrInitHeartbeatConfig();
    expect(config.first_run_notice_shown).toBe(false);

    markFirstRunNoticeShown(config);
    const reloaded = loadOrInitHeartbeatConfig();
    expect(reloaded.first_run_notice_shown).toBe(true);
    expect(reloaded.machine_id).toBe(config.machine_id);
  });
});

describe("resolveHeartbeatDecision", () => {
  function config(overrides: Partial<{ enabled: boolean; consent_source: "installer" | "cli" | "default-notice" }> = {}) {
    return {
      enabled: true,
      machine_id: "00000000-0000-4000-8000-000000000000",
      consent_source: "default-notice" as const,
      first_run_notice_shown: false,
      updated_at: new Date(0).toISOString(),
      ...overrides,
    };
  }

  it("no env, no prior choice -> on-default", async () => {
    const { resolveHeartbeatDecision, heartbeatDecisionEnabled } = await import("../../src/telemetry/config.js");
    const d = resolveHeartbeatDecision(config(), {});
    expect(d).toBe("on-default");
    expect(heartbeatDecisionEnabled(d)).toBe(true);
  });

  it("stored off, no env -> off-stored", async () => {
    const { resolveHeartbeatDecision, heartbeatDecisionEnabled } = await import("../../src/telemetry/config.js");
    const d = resolveHeartbeatDecision(config({ enabled: false }), {});
    expect(d).toBe("off-stored");
    expect(heartbeatDecisionEnabled(d)).toBe(false);
  });

  it("env ROTIFER_TELEMETRY=0 overrides a stored on -> off-env", async () => {
    const { resolveHeartbeatDecision, heartbeatDecisionEnabled } = await import("../../src/telemetry/config.js");
    const d = resolveHeartbeatDecision(config({ enabled: true }), { ROTIFER_TELEMETRY: "0" });
    expect(d).toBe("off-env");
    expect(heartbeatDecisionEnabled(d)).toBe(false);
  });

  it("DO_NOT_TRACK overrides everything, including an explicit ROTIFER_TELEMETRY=1", async () => {
    const { resolveHeartbeatDecision, heartbeatDecisionEnabled } = await import("../../src/telemetry/config.js");
    const d = resolveHeartbeatDecision(config({ enabled: true }), {
      DO_NOT_TRACK: "1",
      ROTIFER_TELEMETRY: "1",
    });
    expect(d).toBe("off-env");
    expect(heartbeatDecisionEnabled(d)).toBe(false);
  });
});
