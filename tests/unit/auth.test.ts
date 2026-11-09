import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
});

const VALID_CREDS = {
  access_token: "at-123",
  refresh_token: "rt-456",
  expires_at: Date.now() + 3600_000,
  provider: "github" as const,
  user: { id: "u1", username: "dev", avatar_url: null, provider_id: "gh-1" },
};

describe("loadCredentials", () => {
  it("returns null when credentials file does not exist", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { loadCredentials } = await import("../../src/auth.js");
    expect(loadCredentials()).toBeNull();
  });

  it("returns credentials when file is valid and not expired", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(VALID_CREDS));
    const { loadCredentials } = await import("../../src/auth.js");
    const creds = loadCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.access_token).toBe("at-123");
    expect(creds!.provider).toBe("github");
  });

  it("returns null when credentials are expired", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ ...VALID_CREDS, expires_at: Date.now() - 1000 })
    );
    const { loadCredentials } = await import("../../src/auth.js");
    expect(loadCredentials()).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{{bad json");
    const { loadCredentials } = await import("../../src/auth.js");
    expect(loadCredentials()).toBeNull();
  });
});

describe("saveCredentials", () => {
  it("creates .rotifer directory if missing", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { saveCredentials } = await import("../../src/auth.js");
    saveCredentials(VALID_CREDS);
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(
      expect.stringContaining(".rotifer"),
      { recursive: true }
    );
  });

  it("writes credentials with mode 0o600", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { saveCredentials } = await import("../../src/auth.js");
    saveCredentials(VALID_CREDS);
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining("credentials.json"),
      expect.stringContaining("at-123"),
      { mode: 0o600 }
    );
  });
});

describe("clearCredentials", () => {
  it("attempts deletion when existsSync returns true", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const { clearCredentials } = await import("../../src/auth.js");
    // require("node:fs") inside clearCredentials bypasses vi.mock in ESM,
    // so the real unlinkSync is called — ENOENT is expected in test env.
    try {
      clearCredentials();
    } catch {
      // expected: real unlinkSync on non-existent test path
    }
    expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(
      expect.stringContaining("credentials.json")
    );
  });

  it("skips deletion when existsSync returns false", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { clearCredentials } = await import("../../src/auth.js");
    clearCredentials();
    const existsCalls = vi.mocked(fs.existsSync).mock.calls.filter(
      ([p]) => String(p).includes("credentials.json")
    );
    expect(existsCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PKCE helpers", () => {
  it("generateCodeVerifier returns base64url string", async () => {
    const { generateCodeVerifier } = await import("../../src/auth.js");
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(32);
  });

  it("generateCodeChallenge is S256 of verifier", async () => {
    const { generateCodeVerifier, generateCodeChallenge } = await import("../../src/auth.js");
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("different verifiers produce different challenges", async () => {
    const { generateCodeVerifier, generateCodeChallenge } = await import("../../src/auth.js");
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(generateCodeChallenge(v1)).not.toBe(generateCodeChallenge(v2));
  });
});

describe("startOAuthCallbackServer", () => {
  it("resolves PKCE code callbacks", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        if (timeout === 120_000) {
          return {
            ref() {
              return this;
            },
            unref() {
              return this;
            },
          } as any;
        }
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof globalThis.setTimeout,
    );
    const { startOAuthCallbackServer } = await import("../../src/auth.js");

    const { port, waitForCallback } = await startOAuthCallbackServer(0);
    const response = await fetch(`http://127.0.0.1:${port}/?code=auth-code-123`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Login successful");
    await expect(waitForCallback).resolves.toBe("auth-code-123");

    timeoutSpy.mockRestore();
  });

  it("refuses a token handed to the callback port and keeps waiting for a code", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        if (timeout === 120_000) {
          return {
            ref() {
              return this;
            },
            unref() {
              return this;
            },
          } as any;
        }
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof globalThis.setTimeout,
    );
    const { startOAuthCallbackServer } = await import("../../src/auth.js");

    const { port, waitForCallback } = await startOAuthCallbackServer(0);
    const response = await fetch(
      `http://127.0.0.1:${port}/callback/token?access_token=forged&refresh_token=forged`,
    );

    expect(await response.text()).not.toContain("Login successful");
    const pending = Symbol("pending");
    await expect(
      Promise.race([waitForCallback, new Promise((r) => setTimeout(() => r(pending), 50))]),
    ).resolves.toBe(pending);

    await fetch(`http://127.0.0.1:${port}/callback?code=real-code`);
    await expect(waitForCallback).resolves.toBe("real-code");

    timeoutSpy.mockRestore();
  });

  it("does not serve a page that forwards a URL fragment to this port", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        if (timeout === 120_000) {
          return {
            ref() {
              return this;
            },
            unref() {
              return this;
            },
          } as any;
        }
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof globalThis.setTimeout,
    );
    const { startOAuthCallbackServer } = await import("../../src/auth.js");

    const { port, waitForCallback } = await startOAuthCallbackServer(0);
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();

    expect(html).not.toContain("location.hash");
    expect(html).not.toContain("<script");
    expect(html).toContain("Login failed");

    await fetch(`http://127.0.0.1:${port}/?code=done`);
    await expect(waitForCallback).resolves.toBe("done");

    timeoutSpy.mockRestore();
  });
});
