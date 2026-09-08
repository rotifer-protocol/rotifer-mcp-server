import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  delete process.env.ROTIFER_CLOUD_ENDPOINT;
  delete process.env.ROTIFER_CLOUD_ANON_KEY;
});

describe("loadCloudConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const config = loadCloudConfig();
    expect(config.endpoint).toBe("https://cloud.rotifer.dev");
    // Was `toBe("")`. That expectation encoded the bug: with no key, every
    // Cloud call fails the same way a rejected one does, and because reporting
    // is fire-and-forget the failure is invisible. A fresh install now gets the
    // shipped publishable key, so cloud commands work out of the box.
    expect(config.anonKey.startsWith("sb_")).toBe(true);
  });

  it("reads from cloud.json when it exists", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("cloud.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ endpoint: "https://custom.example.com", anonKey: "custom-key" })
    );
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const config = loadCloudConfig();
    expect(config.endpoint).toBe("https://custom.example.com");
    expect(config.anonKey).toBe("custom-key");
  });

  it("falls back to env vars when config file is missing", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    process.env.ROTIFER_CLOUD_ENDPOINT = "https://env.example.com";
    process.env.ROTIFER_CLOUD_ANON_KEY = "env-key";
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const config = loadCloudConfig();
    expect(config.endpoint).toBe("https://env.example.com");
    expect(config.anonKey).toBe("env-key");
  });

  it("handles malformed JSON in cloud.json gracefully", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("cloud.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const config = loadCloudConfig();
    expect(config.endpoint).toBe("https://cloud.rotifer.dev");
  });

  it("merges partial config with defaults", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("cloud.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ endpoint: "https://partial.example.com" })
    );
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const config = loadCloudConfig();
    expect(config.endpoint).toBe("https://partial.example.com");
    // Same correction: a config file that names only an endpoint leaves the key
    // to the shipped default rather than to an empty string.
    expect(config.anonKey.startsWith("sb_")).toBe(true);
  });

  it("caches config across calls (same reference)", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const first = loadCloudConfig();
    const second = loadCloudConfig();
    expect(first).toBe(second);
  });
});

describe("loadCloudConfig — a stale legacy key in cloud.json must not win", () => {
  it("ignores the legacy key the file carries and resolves a usable one", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p).endsWith("cloud.json"));
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        endpoint: "https://cloud.rotifer.dev",
        // What every machine that used the CLI before the key migration still
        // has on disk. Presenting it returns 401 "Legacy API keys are disabled".
        anonKey: "eyJ_NOT_A_REAL_JWT_stale_from_file",
      }),
    );
    const { loadCloudConfig } = await import("../../src/cloud.js");
    const config = loadCloudConfig();
    expect(config.anonKey.startsWith("eyJ")).toBe(false);
    expect(config.anonKey.startsWith("sb_")).toBe(true);
    // The endpoint from the file is still honoured — only the dead key is
    // replaced, not the whole file.
    expect(config.endpoint).toBe("https://cloud.rotifer.dev");
  });
});
