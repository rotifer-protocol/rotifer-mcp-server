import { describe, it, expect } from "vitest";
import { buildOpenCommand } from "../../src/open-browser.js";

describe("buildOpenCommand", () => {
  it("uses 'open' on macOS", () => {
    const cmd = buildOpenCommand("https://example.com", "darwin");
    expect(cmd).toBe('open "https://example.com"');
  });

  it("uses 'xdg-open' on Linux", () => {
    const cmd = buildOpenCommand("https://example.com", "linux");
    expect(cmd).toBe('xdg-open "https://example.com"');
  });

  it("uses 'start' on Windows", () => {
    const cmd = buildOpenCommand("https://example.com", "win32");
    expect(cmd).toBe('start "" "https://example.com"');
  });

  it("handles URLs with special characters", () => {
    const cmd = buildOpenCommand("https://example.com/path?a=1&b=2", "darwin");
    expect(cmd).toContain("https://example.com/path?a=1&b=2");
  });

  it("falls back to xdg-open for unknown platforms", () => {
    const cmd = buildOpenCommand("https://example.com", "freebsd");
    expect(cmd).toBe('xdg-open "https://example.com"');
  });
});
