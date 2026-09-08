import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09-07: the admin dashboard reported "调用量管道无数据" — gene_invocation_log
// empty for 7 days, gene_contribution_metrics with zero counted invocations
// all-time. The dashboard was right, and the probe was right to call it dead:
// its reads succeeded and genuinely returned 0.
//
// Nothing was writing. Supabase disabled legacy (JWT) API keys on the Cloud
// project, and ~/.rotifer/cloud.json outlives that migration — anyone who used
// the CLI before it still has a legacy key in that file. @rotifer/playground
// learned to skip such a key (its PR #336); this package took it verbatim, so
// every call carried a dead credential and got `401 Legacy API keys are
// disabled`. Invocation reporting is fire-and-forget, so the 401 was swallowed
// and the table simply stayed empty — no error anywhere, just a zero that
// looked like "nobody ran anything".

const MOD = "../../src/cloud.js";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// The fixtures below start with "eyJ" — which is all the guard looks at — but
// are deliberately NOT shaped like real JWTs. A realistic three-segment token
// trips the repo's gitleaks scan, and the fix for that must not be to allowlist
// this file: an allowlisted test file would also hide a real service_role key
// dropped into it later, which is the thing the scan exists to catch.
describe("isLegacyJwtKey", () => {
  it("recognises a legacy signed-JWT key by its eyJ prefix", async () => {
    const { isLegacyJwtKey } = await import(MOD);
    expect(isLegacyJwtKey("eyJ_NOT_A_REAL_JWT_fixture_legacy_shaped")).toBe(true);
  });

  it("does not mistake a publishable key for a legacy one", async () => {
    const { isLegacyJwtKey } = await import(MOD);
    expect(isLegacyJwtKey("sb_publishable_abcdefghijklmnop")).toBe(false);
  });

  it("treats absent and empty as not-legacy, so they fall through to the default", async () => {
    const { isLegacyJwtKey } = await import(MOD);
    expect(isLegacyJwtKey(undefined)).toBe(false);
    expect(isLegacyJwtKey("")).toBe(false);
  });
});

describe("resolveAnonKey", () => {
  it("skips a legacy key in cloud.json and uses the shipped default", async () => {
    const { resolveAnonKey, isLegacyJwtKey } = await import(MOD);
    const resolved = resolveAnonKey("eyJ_NOT_A_REAL_JWT_stale_from_file", undefined);
    // The point of the whole change: a stale file must not win.
    expect(isLegacyJwtKey(resolved)).toBe(false);
    expect(resolved.startsWith("sb_")).toBe(true);
  });

  it("honours a non-legacy key from the config file", async () => {
    const { resolveAnonKey } = await import(MOD);
    expect(resolveAnonKey("sb_publishable_fromfile", undefined)).toBe("sb_publishable_fromfile");
  });

  it("falls back to the environment when the file's key is legacy", async () => {
    const { resolveAnonKey } = await import(MOD);
    expect(resolveAnonKey("eyJstale", "sb_publishable_fromenv")).toBe("sb_publishable_fromenv");
  });

  it("uses the default when neither source has a usable key", async () => {
    const { resolveAnonKey } = await import(MOD);
    const resolved = resolveAnonKey(undefined, undefined);
    expect(resolved.startsWith("sb_")).toBe(true);
    // Control: the default must be a real value, not an empty string. The old
    // loader's `|| ""` was exactly that, and an empty apikey fails the same way
    // a dead one does.
    expect(resolved.length).toBeGreaterThan(20);
  });

  it("never returns a legacy key from any combination of inputs", async () => {
    const { resolveAnonKey, isLegacyJwtKey } = await import(MOD);
    for (const file of [undefined, "", "eyJa", "sb_publishable_ok"]) {
      for (const env of [undefined, "", "eyJb", "sb_publishable_env"]) {
        expect(isLegacyJwtKey(resolveAnonKey(file, env)), `file=${file} env=${env}`).toBe(false);
      }
    }
  });
});
