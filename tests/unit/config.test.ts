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
    expect(config.anonKey).toBe("");
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
    expect(config.anonKey).toBe("");
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
