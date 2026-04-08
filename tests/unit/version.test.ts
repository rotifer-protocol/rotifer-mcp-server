import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("version utility", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = join(tmpdir(), "rotifer-ver-test-" + randomUUID());
    mkdirSync(configDir, { recursive: true });
    vi.stubEnv("ROTIFER_CONFIG_DIR", configDir);
    vi.stubEnv("npm_execpath", "");
    vi.stubEnv("npm_command", "");
    delete process.env.CI;
    delete process.env.NO_UPDATE_NOTIFIER;
    delete process.env.ROTIFER_NO_UPDATE_CHECK;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("getPackageVersion returns a valid semver string", async () => {
    const mod = await import("../../src/version.js");
    const version = mod.getPackageVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("getVersionInfo returns updateAvailable=false when CI is set", async () => {
    vi.stubEnv("CI", "true");
    const mod = await import("../../src/version.js");
    const info = await mod.getVersionInfo();
    expect(info.updateAvailable).toBe(false);
    expect(info.latest).toBeNull();
  });

  it("getVersionInfo uses cache when available", async () => {
    writeFileSync(join(configDir, "update-check.json"), JSON.stringify({
      "@rotifer/mcp-server": { lastCheck: Date.now(), latest: "99.0.0" },
    }));

    const mod = await import("../../src/version.js");
    const info = await mod.getVersionInfo();
    expect(info.updateAvailable).toBe(true);
    expect(info.latest).toBe("99.0.0");
  });

  it("formatUpdateHint returns a well-formed system hint", async () => {
    const mod = await import("../../src/version.js");
    const hint = mod.formatUpdateHint({
      current: "0.8.0",
      latest: "0.9.0",
      updateAvailable: true,
    });
    expect(hint).toContain("[System]");
    expect(hint).toContain("0.8.0");
    expect(hint).toContain("0.9.0");
    expect(hint).toContain("npm i -g @rotifer/mcp-server@latest");
  });

  it("getVersionInfo returns updateAvailable=false when cache shows same version", async () => {
    const mod = await import("../../src/version.js");
    const current = mod.getPackageVersion();
    writeFileSync(join(configDir, "update-check.json"), JSON.stringify({
      "@rotifer/mcp-server": { lastCheck: Date.now(), latest: current },
    }));

    vi.resetModules();
    vi.stubEnv("ROTIFER_CONFIG_DIR", configDir);
    const mod2 = await import("../../src/version.js");
    const info = await mod2.getVersionInfo();
    expect(info.updateAvailable).toBe(false);
    expect(info.current).toBe(current);
  });

  it("getVersionInfo returns updateAvailable=false when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const mod = await import("../../src/version.js");
    const info = await mod.getVersionInfo();
    expect(info.updateAvailable).toBe(false);
  });
});
