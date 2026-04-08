import { describe, it, expect } from "vitest";
import { buildOpenCommand } from "../../src/open-browser.js";

describe("buildOpenCommand", () => {
  it("uses 'open' on macOS", () => {
    const { bin, args } = buildOpenCommand("https://example.com", "darwin");
    expect(bin).toBe("open");
    expect(args).toEqual(["https://example.com"]);
  });

  it("uses 'xdg-open' on Linux", () => {
    const { bin, args } = buildOpenCommand("https://example.com", "linux");
    expect(bin).toBe("xdg-open");
    expect(args).toEqual(["https://example.com"]);
  });

  it("uses 'cmd /c start' on Windows", () => {
    const { bin, args } = buildOpenCommand("https://example.com", "win32");
    expect(bin).toBe("cmd");
    expect(args).toEqual(["/c", "start", "", "https://example.com"]);
  });

  it("handles URLs with special characters", () => {
    const { args } = buildOpenCommand("https://example.com/path?a=1&b=2", "darwin");
    expect(args[0]).toContain("https://example.com/path?a=1&b=2");
  });

  it("falls back to xdg-open for unknown platforms", () => {
    const { bin, args } = buildOpenCommand("https://example.com", "freebsd");
    expect(bin).toBe("xdg-open");
    expect(args).toEqual(["https://example.com"]);
  });
});
