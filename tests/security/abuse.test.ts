import { describe, it, expect } from "vitest";
import { searchGenes, getGeneDetail, compareGenes, geneStats, developerProfile, listLocalGenes, submitToArena, installGeneFromCloud, authStatus } from "../../src/tools.js";

const hasCloudKey = !!process.env.ROTIFER_CLOUD_ANON_KEY;
const describeCloud = hasCloudKey ? describe : describe.skip;

describeCloud("oversized input", { timeout: 15000 }, () => {
  it("handles 10000-char query without crashing", async () => {
    const longQuery = "a".repeat(10000);
    try {
      const result = await searchGenes({ query: longQuery });
      expect(Array.isArray(result.genes)).toBe(true);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it("handles 1000-char gene_id", async () => {
    await expect(getGeneDetail({ gene_id: "x".repeat(1000) })).rejects.toThrow();
  });

  it("handles 1000-char username", async () => {
    await expect(developerProfile({ username: "u".repeat(1000) })).rejects.toThrow();
  });
});

describeCloud("null bytes", { timeout: 15000 }, () => {
  it("handles null byte in query (reject or return empty)", async () => {
    try {
      const result = await searchGenes({ query: "test\x00injected" });
      expect(Array.isArray(result.genes)).toBe(true);
    } catch (err: any) {
      expect(err.message).toBeDefined();
    }
  });

  it("handles null byte in gene_id", async () => {
    await expect(geneStats({ gene_id: "abc\x00def" })).rejects.toThrow();
  });

  it("handles null byte in username", async () => {
    await expect(developerProfile({ username: "user\x00admin" })).rejects.toThrow();
  });
});

describeCloud("unicode edge cases", { timeout: 15000 }, () => {
  it("handles emoji in query", async () => {
    const result = await searchGenes({ query: "🧬gene" });
    expect(Array.isArray(result.genes)).toBe(true);
  });

  it("handles RTL characters", async () => {
    const result = await searchGenes({ query: "مرحبا" });
    expect(Array.isArray(result.genes)).toBe(true);
  });

  it("handles zero-width joiners", async () => {
    const result = await searchGenes({ query: "test\u200Dvalue" });
    expect(Array.isArray(result.genes)).toBe(true);
  });
});

describeCloud("extreme pagination", { timeout: 15000 }, () => {
  it("handles very large page number", async () => {
    try {
      const result = await searchGenes({ page: 999999 });
      expect(result.genes.length).toBe(0);
    } catch (err: any) {
      expect(err.message).toContain("416");
    }
  });

  it("handles perPage=0 (uses default 20)", async () => {
    const result = await searchGenes({ perPage: 0 });
    expect(result.per_page).toBe(20);
  });

  it("handles negative perPage (uses Math.min clamped)", async () => {
    try {
      const result = await searchGenes({ perPage: -1 });
      expect(typeof result.per_page).toBe("number");
    } catch (err: any) {
      expect(err.message).toBeDefined();
    }
  });
});

describeCloud("array abuse", { timeout: 15000 }, () => {
  it("handles 5 identical gene IDs", async () => {
    const search = await searchGenes({ perPage: 1 });
    if (search.genes.length === 0) return;
    const id = search.genes[0].id;
    const result = await compareGenes({ gene_ids: [id, id, id, id, id] });
    expect(result.comparison.length).toBe(5);
  });
});

describeCloud("empty strings", { timeout: 15000 }, () => {
  it("gene_id='' throws", async () => {
    await expect(geneStats({ gene_id: "" })).rejects.toThrow("required");
  });

  it("username='' throws", async () => {
    await expect(developerProfile({ username: "" })).rejects.toThrow("required");
  });

  it("getGeneDetail id='' throws", async () => {
    await expect(getGeneDetail({ gene_id: "" })).rejects.toThrow("required");
  });
});

describe("local filesystem abuse", () => {
  it("handles empty project_root", () => {
    const result = listLocalGenes({ project_root: "" });
    expect(typeof result.total).toBe("number");
  });

  it("handles project_root with spaces", () => {
    const result = listLocalGenes({ project_root: "/tmp/path with spaces" });
    expect(typeof result.total).toBe("number");
  });
});

describeCloud("write operation input abuse", { timeout: 15000 }, () => {
  it("submitToArena rejects empty gene_id", async () => {
    await expect(submitToArena({
      gene_id: "", fitness_value: 0.5, safety_score: 0.5,
      success_rate: 0.5, latency_score: 0.5, resource_efficiency: 0.5,
    })).rejects.toThrow("required");
  });

  it("installGeneFromCloud rejects empty gene_id", async () => {
    await expect(installGeneFromCloud({ gene_id: "" })).rejects.toThrow("required");
  });

  it("authStatus returns valid structure without crashing", () => {
    const result = authStatus();
    expect(typeof result.isLoggedIn).toBe("boolean");
    if (result.isLoggedIn) {
      expect(typeof result.username).toBe("string");
    } else {
      expect(result.username).toBeNull();
    }
  });
});
