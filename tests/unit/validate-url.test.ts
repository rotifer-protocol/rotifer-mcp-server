import { describe, it, expect } from "vitest";
import { normalizeCloudEndpoint, parseHttpUrl } from "../../src/validate-url.js";

describe("parseHttpUrl", () => {
  it("accepts http and https", () => {
    expect(parseHttpUrl("http://localhost:54321/a").href).toBe("http://localhost:54321/a");
    expect(parseHttpUrl("https://example.com/a?b=1&c=2").href).toBe("https://example.com/a?b=1&c=2");
  });

  it("accepts an upper-case scheme and returns the canonical form", () => {
    expect(parseHttpUrl("HTTPS://Example.COM").href).toBe("https://example.com/");
  });

  it.each([
    ["ftp://example.com", /http:\/\/ or https:\/\//],
    ["file:///etc/passwd", /http:\/\/ or https:\/\//],
    ["javascript:alert(1)", /http:\/\/ or https:\/\//],
    ["example.com", /http:\/\/ or https:\/\//],
    // The URL parser would quietly accept these two as https://example.com.
    ["https:example.com", /http:\/\/ or https:\/\//],
    ["https:\\\\example.com", /backslash|http:\/\//],
  ])("rejects %s and says what is expected", (url, message) => {
    expect(() => parseHttpUrl(url)).toThrow(message);
  });

  it("rejects credentials embedded in the URL", () => {
    expect(() => parseHttpUrl("https://user@example.com")).toThrow(/user name or password/);
    expect(() => parseHttpUrl("https://user:secret@example.com")).toThrow(/user name or password/);
  });

  it("does not repeat a rejected URL back, since it may hold a password", () => {
    expect(() => parseHttpUrl("https://user:secret@example.com")).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining("secret") }),
    );
  });

  // The URL parser strips tabs and newlines silently, so these have to be
  // caught before it runs.
  it.each([
    ["newline", "https://example.com\n.evil"],
    ["carriage return", "https://example.com/\r"],
    ["tab", "https://exa\tmple.com"],
    ["NUL", "https://example.com\0"],
    ["space", "https://example.com/a b"],
    ["DEL", "https://example.com/\u007f"],
    ["C1 control", "https://example.com/\u0085"],
  ])("rejects a %s", (_label, url) => {
    expect(() => parseHttpUrl(url)).toThrow(/spaces or control characters/);
  });

  it("rejects a backslash, which the parser would turn into a slash", () => {
    expect(() => parseHttpUrl("https://example.com\\@evil.example")).toThrow(/backslash/);
  });

  it("rejects text that is not a URL, and non-strings", () => {
    expect(() => parseHttpUrl("https://")).toThrow(/not a valid URL/);
    expect(() => parseHttpUrl("")).toThrow(/http:\/\/ or https:\/\//);
    expect(() => parseHttpUrl(42)).toThrow(/must be a string/);
    expect(() => parseHttpUrl(null)).toThrow(/must be a string/);
  });

  it("names the thing being validated", () => {
    expect(() => parseHttpUrl("ftp://x", "Cloud endpoint")).toThrow(/^Cloud endpoint /);
  });
});

describe("normalizeCloudEndpoint", () => {
  it("keeps a plain endpoint", () => {
    expect(normalizeCloudEndpoint("https://cloud.rotifer.dev")).toBe("https://cloud.rotifer.dev");
  });

  it("removes trailing slashes", () => {
    expect(normalizeCloudEndpoint("https://example.com/")).toBe("https://example.com");
    expect(normalizeCloudEndpoint("https://example.com/base///")).toBe("https://example.com/base");
  });

  it("keeps a port and a path prefix", () => {
    expect(normalizeCloudEndpoint("http://localhost:54321/supabase")).toBe("http://localhost:54321/supabase");
  });

  it("rejects a query string, which would swallow the API path", () => {
    expect(() => normalizeCloudEndpoint("https://example.com/?a=1")).toThrow(/query string or fragment/);
  });

  it("rejects a fragment, which would swallow the API path", () => {
    expect(() => normalizeCloudEndpoint("https://example.com/#a")).toThrow(/query string or fragment/);
  });

  it("applies every URL rule", () => {
    expect(() => normalizeCloudEndpoint("file:///x")).toThrow(/http:\/\/ or https:\/\//);
    expect(() => normalizeCloudEndpoint("https://u:p@example.com")).toThrow(/user name or password/);
    expect(() => normalizeCloudEndpoint("https://example.com\n")).toThrow(/control characters/);
  });

  it("tells the caller what a valid endpoint looks like", () => {
    expect(() => normalizeCloudEndpoint("nope")).toThrow(/https:\/\/cloud\.rotifer\.dev/);
  });
});
