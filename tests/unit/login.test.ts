import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/cloud.js", () => ({
  loadCloudConfig: vi.fn().mockReturnValue({
    endpoint: "https://mock.supabase.co",
    anonKey: "mock-anon-key",
  }),
}));

vi.mock("../../src/open-browser.js", () => ({
  openBrowser: vi.fn(),
}));

vi.mock("../../src/auth.js", () => ({
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  generateCodeVerifier: vi.fn().mockReturnValue("test-verifier"),
  generateCodeChallenge: vi.fn().mockReturnValue("test-challenge"),
  startOAuthCallbackServer: vi.fn(),
}));

import { runLogin, runLogout } from "../../src/login.js";
import { loadCredentials, saveCredentials, clearCredentials, startOAuthCallbackServer } from "../../src/auth.js";
import { openBrowser } from "../../src/open-browser.js";

function mockCallbackServer(result: string | Error) {
  vi.mocked(startOAuthCallbackServer).mockResolvedValue({
    port: 54321,
    waitForCallback: result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result),
  });
}

const MOCK_CREDS = {
  access_token: "at-123",
  refresh_token: "rt-456",
  expires_at: Date.now() + 3600_000,
  provider: "github" as const,
  user: { id: "u1", username: "testuser", avatar_url: null, provider_id: "gh-1" },
};

describe("runLogin", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("early-returns when credentials already exist", async () => {
    vi.mocked(loadCredentials).mockReturnValue(MOCK_CREDS);
    await runLogin({});
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Already logged in"),
    );
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("shows existing username in early-return message", async () => {
    vi.mocked(loadCredentials).mockReturnValue(MOCK_CREDS);
    await runLogin({});
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("testuser"),
    );
  });

  it("exits with error for unsupported provider", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    await runLogin({ provider: "bitbucket" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported provider"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("defaults to github provider when none specified", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at-new:rt-new");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u2",
        user_metadata: { user_name: "newuser", avatar_url: null },
      }),
    }) as any;

    await runLogin({});
    expect(openBrowser).toHaveBeenCalledWith(
      expect.stringContaining("provider=github"),
    );
  });

  it("constructs auth URL with code challenge", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at-new:rt-new");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u2",
        user_metadata: { user_name: "newuser" },
      }),
    }) as any;

    await runLogin({});
    expect(openBrowser).toHaveBeenCalledWith(
      expect.stringContaining("code_challenge=test-challenge"),
    );
  });

  it("uses random port in redirect URL", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at:rt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u2",
        user_metadata: { user_name: "newuser" },
      }),
    }) as any;

    await runLogin({});
    expect(openBrowser).toHaveBeenCalledWith(
      expect.stringContaining("localhost:54321"),
    );
  });

  it("handles implicit token flow correctly", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:token-abc:refresh-xyz");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u3",
        user_metadata: { user_name: "implicit-user" },
      }),
    }) as any;

    await runLogin({});
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "token-abc",
        refresh_token: "refresh-xyz",
      }),
    );
  });

  it("handles PKCE code exchange flow", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("auth-code-123");
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "pkce-at",
          refresh_token: "pkce-rt",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: "u4",
          user_metadata: { user_name: "pkce-user" },
        }),
      }) as any;

    await runLogin({});
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "pkce-at",
        provider: "github",
      }),
    );
  });

  it("exits with error when token exchange fails", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("bad-code");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve("Invalid code"),
    }) as any;

    await runLogin({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Authentication failed"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("uses custom endpoint when provided", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at:rt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u5",
        user_metadata: { user_name: "custom" },
      }),
    }) as any;

    await runLogin({ endpoint: "https://custom.supabase.co" });
    expect(openBrowser).toHaveBeenCalledWith(
      expect.stringContaining("https://custom.supabase.co"),
    );
  });

  it("extracts username from various metadata fields", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at:rt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u6",
        user_metadata: { preferred_username: "preferred-name" },
      }),
    }) as any;

    await runLogin({});
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ username: "preferred-name" }),
      }),
    );
  });

  it("falls back to email prefix when no username metadata", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at:rt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "u7",
        user_metadata: { email: "alice@example.com" },
      }),
    }) as any;

    await runLogin({});
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ username: "alice" }),
      }),
    );
  });

  it("defaults to 'unknown' when no username info available", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer("implicit:at:rt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "u8", user_metadata: {} }),
    }) as any;

    await runLogin({});
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ username: "unknown" }),
      }),
    );
  });

  it("handles callback error gracefully", async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    mockCallbackServer(new Error("Timed out"));

    await runLogin({});
    expect(errorSpy).toHaveBeenCalledWith("Timed out");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("runLogout", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows message when not logged in", () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    runLogout();
    expect(consoleSpy).toHaveBeenCalledWith("Not currently logged in.");
    expect(clearCredentials).not.toHaveBeenCalled();
  });

  it("clears credentials and shows logout message", () => {
    vi.mocked(loadCredentials).mockReturnValue(MOCK_CREDS);
    runLogout();
    expect(clearCredentials).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Logged out"),
    );
  });

  it("includes previous username in logout message", () => {
    vi.mocked(loadCredentials).mockReturnValue(MOCK_CREDS);
    runLogout();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("testuser"),
    );
  });

  it("includes provider in logout message", () => {
    vi.mocked(loadCredentials).mockReturnValue(MOCK_CREDS);
    runLogout();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("github"),
    );
  });
});
