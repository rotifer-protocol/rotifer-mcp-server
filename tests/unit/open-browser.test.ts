import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { buildOpenCommand, openBrowser } from "../../src/open-browser.js";

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

  it("opens through the system URL handler on Windows, by absolute path", () => {
    const { bin, args } = buildOpenCommand("https://example.com", "win32", { SystemRoot: "D:\\WinNT" });
    expect(bin).toBe("D:\\WinNT\\System32\\rundll32.exe");
    expect(args).toEqual(["url.dll,FileProtocolHandler", "https://example.com"]);
  });

  it("uses the standard Windows folder when SystemRoot is not set", () => {
    const { bin } = buildOpenCommand("https://example.com", "win32", {});
    expect(bin).toBe("C:\\Windows\\System32\\rundll32.exe");
  });

  it("never hands a Windows URL to a command interpreter", () => {
    const { bin, args } = buildOpenCommand("https://example.com/?a=1&b=2", "win32", {});
    expect(bin).not.toMatch(/(^|[\\/])(cmd|powershell|pwsh)(\.exe)?$/i);
    expect(args).not.toContain("/c");
    // The URL stays one whole argument; nothing is split off at the ampersand.
    expect(args[args.length - 1]).toBe("https://example.com/?a=1&b=2");
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

describe("openBrowser", () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

  beforeEach(() => {
    vi.mocked(execFile).mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", realPlatform);
  });

  it.each([
    ["a local file", "file:///C:/Windows/System32/calc.exe"],
    ["script", "javascript:alert(1)"],
    ["an arbitrary protocol handler", "ms-msdt:/id"],
    ["a UNC-style path", "\\\\host\\share\\x.exe"],
    ["no protocol at all", "example.com"],
    ["embedded credentials", "https://user:pass@example.com/"],
    ["a line break", "https://example.com/\r\nx"],
    ["a tab", "https://exa\tmple.com/"],
    ["a space", "https://example.com/a b"],
    ["a NUL byte", "https://example.com/\0"],
  ])("refuses %s and starts nothing", (_label, url) => {
    expect(() => openBrowser(url)).toThrow(/URL/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("refuses anything that is not a string", () => {
    expect(() => openBrowser(undefined as unknown as string)).toThrow(/URL/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("opens http and https URLs", () => {
    openBrowser("http://localhost:3000/x");
    openBrowser("https://example.com/x");
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("passes on the normalized form of the URL, not the raw text", () => {
    Object.defineProperty(process, "platform", { ...realPlatform, value: "linux" });
    openBrowser("HTTPS://EXAMPLE.com/?q=<x>");
    expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(["https://example.com/?q=%3Cx%3E"]);
  });

  it("does not use a shell on Windows", () => {
    Object.defineProperty(process, "platform", { ...realPlatform, value: "win32" });
    openBrowser("https://example.com/?a=1&b=2");
    const [bin, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], { shell?: unknown } | undefined];
    expect(bin).toMatch(/rundll32\.exe$/);
    expect(args).toEqual(["url.dll,FileProtocolHandler", "https://example.com/?a=1&b=2"]);
    expect(options?.shell).toBeFalsy();
  });
});
