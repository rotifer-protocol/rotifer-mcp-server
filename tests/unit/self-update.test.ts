import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// `rotifer-mcp-server self-update`. The server could already *detect* that it
// was behind (index.ts prints a notice to stderr at startup) but had no way to
// act on it; the upgrade lived only in @rotifer/playground's CLI, where a
// version-comparison bug meant it had never actually run for this package.
//
// What these tests are really guarding is that the two ways this command can
// do harm stay closed: installing a build nobody attested to, and installing a
// global copy in front of an npx launch that is already newer.

const MOD = "../../src/self-update.js";

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "rotifer-mcp-su-"));
  vi.stubEnv("ROTIFER_CONFIG_DIR", configDir);
  vi.resetModules();
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.doUnmock("node:child_process");
  vi.restoreAllMocks();
});

describe("detectPackageManager", () => {
  it.each([
    ["", "npm"],
    ["npm/10.0.0 node/v20", "npm"],
    ["pnpm/9.0.0 npm/? node/v20", "pnpm"],
    ["yarn/1.22.0 npm/? node/v20", "yarn"],
    ["bun/1.1.0", "bun"],
  ])("reads %j as %s", async (ua, expected) => {
    vi.stubEnv("npm_config_user_agent", ua);
    const mod = await import(MOD);
    expect(mod.detectPackageManager()).toBe(expected);
  });
});

describe("getInstallCommand", () => {
  it.each([
    ["npm", ["npm", ["install", "-g", "@rotifer/mcp-server@0.18.0"]]],
    ["pnpm", ["pnpm", ["add", "-g", "@rotifer/mcp-server@0.18.0"]]],
    ["yarn", ["yarn", ["global", "add", "@rotifer/mcp-server@0.18.0"]]],
    ["bun", ["bun", ["add", "-g", "@rotifer/mcp-server@0.18.0"]]],
  ])("builds a global install for %s", async (pm, expected) => {
    const mod = await import(MOD);
    expect(mod.getInstallCommand(pm, "0.18.0")).toEqual(expected);
  });
});

describe("isRunViaNpx", () => {
  it("recognises an npx launch by npm_execpath", async () => {
    vi.stubEnv("npm_execpath", "/Users/x/.npm/_npx/abc/node_modules/npm/bin/npx-cli.js");
    vi.stubEnv("npm_command", "");
    const mod = await import(MOD);
    expect(mod.isRunViaNpx()).toBe(true);
  });

  it("recognises an npx launch by npm_command=exec", async () => {
    vi.stubEnv("npm_execpath", "");
    vi.stubEnv("npm_command", "exec");
    const mod = await import(MOD);
    expect(mod.isRunViaNpx()).toBe(true);
  });

  it("does not mistake a plain global install for npx", async () => {
    vi.stubEnv("npm_execpath", "");
    vi.stubEnv("npm_command", "");
    const mod = await import(MOD);
    expect(mod.isRunViaNpx()).toBe(false);
  });
});

describe("verifyProvenance", () => {
  it("is true only when the registry reports an attestation", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ dist: { attestations: { url: "https://…" } } }), { status: 200 }),
    ) as typeof globalThis.fetch;
    const mod = await import(MOD);
    expect(await mod.verifyProvenance("0.18.0")).toBe(true);
  });

  it("is false when the version has no attestation", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ dist: { tarball: "https://…" } }), { status: 200 }),
    ) as typeof globalThis.fetch;
    const mod = await import(MOD);
    expect(await mod.verifyProvenance("0.18.0")).toBe(false);
  });

  it("is false on a non-OK response and on a network failure", async () => {
    const mod = await import(MOD);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as typeof globalThis.fetch;
    expect(await mod.verifyProvenance("9.9.9")).toBe(false);
    globalThis.fetch = vi.fn(async () => { throw new Error("ENOTFOUND"); }) as typeof globalThis.fetch;
    expect(await mod.verifyProvenance("0.18.0")).toBe(false);
  });
});

describe("rollback bookkeeping", () => {
  it("round-trips the previous version", async () => {
    const mod = await import(MOD);
    expect(mod.readLastVersion()).toBeNull();
    mod.recordLastVersion("0.17.0");
    expect(mod.readLastVersion()).toBe("0.17.0");
  });

  it("preserves keys the CLI owns — the config file is shared", async () => {
    const f = join(configDir, "config.json");
    writeFileSync(f, JSON.stringify({
      "update-check": false,
      "last-version": "0.23.2",
      "last-versions": { "@rotifer/playground": "0.23.2" },
    }));

    const mod = await import(MOD);
    mod.recordLastVersion("0.17.0");

    const after = JSON.parse(readFileSync(f, "utf-8"));
    expect(after["update-check"]).toBe(false);
    expect(after["last-version"]).toBe("0.23.2");
    expect(after["last-versions"]).toEqual({
      "@rotifer/playground": "0.23.2",
      "@rotifer/mcp-server": "0.17.0",
    });
  });

  it("survives a corrupt config instead of throwing", async () => {
    writeFileSync(join(configDir, "config.json"), "{ not json");
    const mod = await import(MOD);
    expect(mod.readLastVersion()).toBeNull();
    expect(() => mod.recordLastVersion("0.17.0")).not.toThrow();
  });
});

describe("runSelfUpdate — what it must never install", () => {
  /** Mocks ./version.js and node:child_process; returns the install spy. */
  async function loadWith(opts: { current: string; latest: string | null }) {
    // `npm config get prefix` must answer with a real writable directory, or
    // doesNeedSudo() correctly bails out before any install is attempted.
    const execFileSync = vi.fn((_cmd: string, args: string[]) =>
      args.join(" ") === "config get prefix" ? configDir + "\n" : "",
    );
    vi.doMock("node:child_process", () => ({ execFileSync }));
    vi.doMock("../../src/version.js", () => ({
      getPackageVersion: () => opts.current,
      fetchLatestVersion: async () => opts.latest,
      compareSemver: (a: string, b: string) => {
        const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) > (pb[i] || 0)) return 1;
          if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
      },
      getConfigDir: () => configDir,
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const mod = await import(MOD);
    return { mod, execFileSync };
  }

  afterEach(() => {
    vi.doUnmock("../../src/version.js");
  });

  it("installs nothing under npx, and does not even ask the registry", async () => {
    vi.stubEnv("npm_command", "exec");
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const { mod, execFileSync } = await loadWith({ current: "0.17.0", latest: "0.18.0" });

    await mod.runSelfUpdate();

    expect(execFileSync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("installs nothing when already current", async () => {
    vi.stubEnv("npm_command", "");
    const { mod, execFileSync } = await loadWith({ current: "0.18.0", latest: "0.18.0" });
    await mod.runSelfUpdate();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("refuses a newer version that carries no provenance attestation", async () => {
    vi.stubEnv("npm_command", "");
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ dist: {} }), { status: 200 }),
    ) as typeof globalThis.fetch;
    const { mod, execFileSync } = await loadWith({ current: "0.17.0", latest: "0.18.0" });

    await expect(mod.runSelfUpdate()).rejects.toThrow("process.exit(1)");
    // Control: the update WAS available and was still not installed.
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("installs an attested newer version, and records it for rollback", async () => {
    vi.stubEnv("npm_command", "");
    vi.stubEnv("npm_config_user_agent", "npm/10.0.0");
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ dist: { attestations: { url: "https://…" } } }), { status: 200 }),
    ) as typeof globalThis.fetch;
    const { mod, execFileSync } = await loadWith({ current: "0.17.0", latest: "0.18.0" });

    await mod.runSelfUpdate();

    const installCall = execFileSync.mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes("@rotifer/mcp-server@0.18.0"),
    );
    expect(installCall, "the attested update should have been installed").toBeDefined();
    expect(mod.readLastVersion()).toBe("0.17.0");
  });

  it("refuses to roll back when nothing was ever recorded", async () => {
    const { mod, execFileSync } = await loadWith({ current: "0.18.0", latest: "0.18.0" });
    await expect(mod.runSelfUpdate({ isRollback: true })).rejects.toThrow("process.exit(1)");
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

describe("doesNeedSudo", () => {
  afterEach(() => vi.doUnmock("node:child_process"));

  it("is false when the global prefix is writable", async () => {
    vi.doMock("node:child_process", () => ({
      execFileSync: () => configDir + "\n",
    }));
    const mod = await import(MOD);
    expect(mod.doesNeedSudo("npm")).toBe(false);
  });

  it("is true when the global prefix cannot be written", async () => {
    vi.doMock("node:child_process", () => ({
      execFileSync: () => "/definitely/not/a/real/prefix\n",
    }));
    const mod = await import(MOD);
    expect(mod.doesNeedSudo("npm")).toBe(true);
  });

  it("never claims sudo for package managers npm does not own", async () => {
    const mod = await import(MOD);
    for (const pm of ["pnpm", "yarn", "bun"]) {
      expect(mod.doesNeedSudo(pm)).toBe(false);
    }
  });
});

describe("ESM discipline (CommonJS regression guard)", () => {
  // This package is ESM ("type": "module"), where `require` is not defined.
  // An earlier draft of self-update.ts resolved fs with `require("node:fs")`,
  // copied verbatim from @rotifer/playground's CLI — which gets away with it
  // only because that package compiles to CommonJS. Here the ReferenceError
  // fell into a catch and became "Global install requires elevated
  // permissions", so every self-update refused to run with a permissions
  // problem that did not exist. Confirmed against the real runtime: the
  // require build printed that error where the fixed build installed.
  //
  // The behavioural tests above cannot catch this — Vitest's module runner
  // provides a `require` shim, so the broken line passes there and only fails
  // once Node loads the built ESM. A source check is what actually fires.
  it("no source file reaches for CommonJS require()", () => {
    const dir = join(__dirname, "../../src");
    const offenders: string[] = [];

    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        readFileSync(full, "utf-8").split("\n").forEach((line, i) => {
          if (/(^|[^.\w])require\s*\(/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
            offenders.push(`${full.replace(dir, "src")}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    };
    walk(dir);

    expect(
      offenders,
      "`require()` is not defined in an ESM package. Import the module at the " +
        "top of the file instead. Offenders:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("actually scanned the sources — a guard that reads nothing always passes", () => {
    const dir = join(__dirname, "../../src");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files).toContain("self-update.ts");
  });
});
