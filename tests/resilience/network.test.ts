import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("network resilience", () => {
  it("handles HTTP 500 gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Internal Server Error"}'),
      json: () => Promise.resolve({ message: "Internal Server Error" }),
    });

    const { listGenes } = await import("../../src/cloud.js");
    await expect(listGenes({})).rejects.toThrow("500");
  });

  it("handles HTTP 429 rate limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Rate limit exceeded"}'),
      json: () => Promise.resolve({ message: "Rate limit exceeded" }),
    });

    const { listGenes } = await import("../../src/cloud.js");
    await expect(listGenes({})).rejects.toThrow("429");
  });

  it("handles malformed JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "0-0/0" },
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
      text: () => Promise.resolve("not json at all"),
    });

    const { listGenes } = await import("../../src/cloud.js");
    await expect(listGenes({})).rejects.toThrow();
  });

  it("handles network TypeError (fetch failure)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const { listGenes } = await import("../../src/cloud.js");
    await expect(listGenes({})).rejects.toThrow();
  });

  it("handles ECONNREFUSED", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 0,
      headers: { get: () => null },
      text: () => Promise.resolve("ECONNREFUSED"),
      json: () => Promise.reject(new Error("not json")),
    });

    const { listGenes } = await import("../../src/cloud.js");
    await expect(listGenes({})).rejects.toThrow("Cannot reach Rotifer Cloud API");
  });

  it("handles ENOTFOUND", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 0,
      headers: { get: () => null },
      text: () => Promise.resolve("ENOTFOUND"),
      json: () => Promise.reject(new Error("not json")),
    });

    const { listGenes } = await import("../../src/cloud.js");
    await expect(listGenes({})).rejects.toThrow("Cannot reach Rotifer Cloud API");
  });

  it("provides user-friendly error message on connection failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 0,
      headers: { get: () => null },
      text: () => Promise.resolve("ECONNREFUSED 127.0.0.1:443"),
      json: () => Promise.reject(new Error("not json")),
    });

    const { listGenes } = await import("../../src/cloud.js");
    try {
      await listGenes({});
    } catch (err: any) {
      expect(err.message).toContain("rotifer.dev");
      expect(err.message).not.toContain("stack");
    }
  });

  it("error message includes status code for API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Forbidden"}'),
      json: () => Promise.resolve({ message: "Forbidden" }),
    });

    const { listGenes } = await import("../../src/cloud.js");
    try {
      await listGenes({});
    } catch (err: any) {
      expect(err.message).toContain("403");
      expect(err.message).toContain("Forbidden");
    }
  });

  it("getGene handles HTTP 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Not Found"}'),
      json: () => Promise.resolve({ message: "Not Found" }),
    });

    const { getGene } = await import("../../src/cloud.js");
    await expect(getGene("nonexistent-id")).rejects.toThrow("404");
  });

  it("getGene handles HTTP 401 (expired/missing apikey)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Invalid API key"}'),
      json: () => Promise.resolve({ message: "Invalid API key" }),
    });

    const { getGene } = await import("../../src/cloud.js");
    await expect(getGene("any-id")).rejects.toThrow("401");
  });

  it("getArenaRankings handles HTTP 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Internal Server Error"}'),
      json: () => Promise.resolve({ message: "Internal Server Error" }),
    });

    const { getArenaRankings } = await import("../../src/cloud.js");
    await expect(getArenaRankings({})).rejects.toThrow("500");
  });

  it("getGeneStatsRpc handles network TypeError", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const { getGeneStatsRpc } = await import("../../src/cloud.js");
    await expect(getGeneStatsRpc("any-id")).rejects.toThrow();
  });

  it("getReputationLeaderboard handles HTTP 403", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: () => Promise.resolve('{"message":"Forbidden"}'),
      json: () => Promise.resolve({ message: "Forbidden" }),
    });

    const { getReputationLeaderboard } = await import("../../src/cloud.js");
    await expect(getReputationLeaderboard(10)).rejects.toThrow("403");
  });

  it("getDeveloperProfile handles ECONNREFUSED", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 0,
      headers: { get: () => null },
      text: () => Promise.resolve("ECONNREFUSED"),
      json: () => Promise.reject(new Error("not json")),
    });

    const { getDeveloperProfile } = await import("../../src/cloud.js");
    await expect(getDeveloperProfile("user")).rejects.toThrow("Cannot reach Rotifer Cloud API");
  });
});
