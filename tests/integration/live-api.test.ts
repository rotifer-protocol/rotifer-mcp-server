import { describe, it, expect } from "vitest";
import {
  searchGenes,
  getGeneDetail,
  arenaRankings,
  compareGenes,
  geneStats,
  leaderboard,
  developerProfile,
  listLocalGenes,
} from "../../src/tools.js";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYGROUND_ROOT = resolve(__dirname, "../../../rotifer-playground");

describe("search_genes", { timeout: 15000 }, () => {
  let firstGeneId = "";

  it("finds genes matching a query", async () => {
    const r = await searchGenes({ query: "grammar" });
    expect(r.genes.length).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(0);
    expect(r.page).toBe(1);
    firstGeneId = r.genes[0].id;
  });

  it("filters by domain", async () => {
    const r = await searchGenes({ domain: "search.web" });
    for (const g of r.genes) {
      expect(g.domain).toBe("search.web");
    }
  });

  it("filters by fidelity", async () => {
    const r = await searchGenes({ fidelity: "Native" });
    for (const g of r.genes) {
      expect(g.fidelity).toBe("Native");
    }
  });

  it("respects pagination", async () => {
    const r = await searchGenes({ perPage: 3, page: 1 });
    expect(r.per_page).toBe(3);
    expect(r.genes.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for nonsense query", async () => {
    const r = await searchGenes({ query: "zzz_nonexistent_gene_xyz_12345" });
    expect(r.genes.length).toBe(0);
    expect(r.total).toBe(0);
  });

  it("caps perPage at 50", async () => {
    const r = await searchGenes({ perPage: 999 });
    expect(r.per_page).toBe(50);
  });
});

describe("get_gene_detail", { timeout: 15000 }, () => {
  it("returns gene with phenotype", async () => {
    const search = await searchGenes({ perPage: 1 });
    const g = await getGeneDetail({ id: search.genes[0].id });
    expect(g.id).toBe(search.genes[0].id);
    expect(g.name).toBeTruthy();
    expect(g.phenotype).toBeDefined();
  });

  it("throws on invalid gene id", async () => {
    await expect(
      getGeneDetail({ id: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow("not found");
  });

  it("throws on empty id", async () => {
    await expect(getGeneDetail({ id: "" })).rejects.toThrow("required");
  });
});

describe("get_arena_rankings", { timeout: 15000 }, () => {
  it("returns rankings for all domains", async () => {
    const r = await arenaRankings({});
    expect(Array.isArray(r.rankings)).toBe(true);
    expect(r.domain).toBeNull();
  });

  it("filters by domain", async () => {
    const r = await arenaRankings({ domain: "search.web" });
    expect(r.domain).toBe("search.web");
    for (const e of r.rankings) {
      expect(e.domain).toBe("search.web");
    }
  });

  it("has correct shape", async () => {
    const r = await arenaRankings({ perPage: 5 });
    if (r.rankings.length > 0) {
      const e = r.rankings[0];
      expect(typeof e.rank).toBe("number");
      expect(typeof e.gene_id).toBe("string");
      expect(typeof e.fitness).toBe("number");
    }
  });
});

describe("get_gene_stats", { timeout: 15000 }, () => {
  it("returns download stats for valid gene", async () => {
    const search = await searchGenes({ perPage: 1 });
    const r = await geneStats({ gene_id: search.genes[0].id });
    expect(typeof r.total).toBe("number");
    expect(typeof r.last_7d).toBe("number");
    expect(r.last_7d).toBeLessThanOrEqual(r.last_30d);
    expect(r.last_30d).toBeLessThanOrEqual(r.last_90d);
  });

  it("returns zero stats for non-existent gene", async () => {
    const r = await geneStats({ gene_id: "00000000-0000-0000-0000-000000000000" });
    expect(r.total).toBe(0);
    expect(r.last_7d).toBe(0);
    expect(r.last_30d).toBe(0);
    expect(r.last_90d).toBe(0);
  });
});

describe("get_leaderboard", { timeout: 15000 }, () => {
  it("returns array with count", async () => {
    const r = await leaderboard({});
    expect(Array.isArray(r.developers)).toBe(true);
    expect(r.count).toBe(r.developers.length);
  });

  it("respects custom limit", async () => {
    const r = await leaderboard({ limit: 5 });
    expect(r.developers.length).toBeLessThanOrEqual(5);
  });

  it("entries have correct shape", async () => {
    const r = await leaderboard({ limit: 3 });
    if (r.developers.length > 0) {
      const d = r.developers[0];
      expect(typeof d.user_id).toBe("string");
      expect(typeof d.username).toBe("string");
      expect(typeof d.score).toBe("number");
    }
  });
});

describe("get_developer_profile", { timeout: 15000 }, () => {
  it("returns profile for valid username", async () => {
    const search = await searchGenes({ perPage: 1 });
    const owner = search.genes[0].owner;
    const p = await developerProfile({ username: owner });
    expect(p.username).toBe(owner);
    expect(typeof p.user_id).toBe("string");
    expect(typeof p.created_at).toBe("string");
  });

  it("throws on nonexistent username", async () => {
    await expect(
      developerProfile({ username: "zzz_nonexistent_user_xyz_99999" })
    ).rejects.toThrow("not found");
  });
});

describe("compare_genes", { timeout: 15000 }, () => {
  it("compares 2 genes", async () => {
    const search = await searchGenes({ perPage: 2 });
    expect(search.genes.length).toBeGreaterThanOrEqual(2);
    const ids = search.genes.map((g) => g.id);
    const r = await compareGenes({ gene_ids: ids });
    expect(r.comparison.length).toBe(2);
    expect(typeof r.recommendation).toBe("string");
  });

  it("rejects < 2 genes", async () => {
    await expect(compareGenes({ gene_ids: ["one"] })).rejects.toThrow("At least 2");
  });

  it("rejects > 5 genes", async () => {
    await expect(
      compareGenes({ gene_ids: ["a", "b", "c", "d", "e", "f"] })
    ).rejects.toThrow("Maximum 5");
  });
});

describe("list_local_genes", () => {
  it("scans playground genes", () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    expect(r.total).toBeGreaterThan(0);
    expect(r.genes.length).toBe(r.total);
  });

  it("every gene has required fields", () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    for (const g of r.genes) {
      expect(g.name).toBeTruthy();
      expect(g.domain).toBeTruthy();
      expect(typeof g.fidelity).toBe("string");
      expect(typeof g.has_wasm).toBe("boolean");
      expect(typeof g.has_source).toBe("boolean");
    }
  });

  it("filters by domain", () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT, domain: "code" });
    expect(r.total).toBeGreaterThan(0);
    for (const g of r.genes) {
      expect(g.domain === "code" || g.domain.startsWith("code.")).toBe(true);
    }
  });

  it("filters by fidelity", () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT, fidelity: "Native" });
    for (const g of r.genes) {
      expect(g.fidelity).toBe("Native");
    }
  });

  it("results are sorted", () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    for (let i = 1; i < r.genes.length; i++) {
      const prev = r.genes[i - 1];
      const curr = r.genes[i];
      const cmp = prev.domain.localeCompare(curr.domain) || prev.name.localeCompare(curr.name);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  it("returns empty for nonexistent path", () => {
    const r = listLocalGenes({ project_root: "/tmp/rotifer_test_nonexistent_xyz" });
    expect(r.total).toBe(0);
  });

  it("handles combined filters", () => {
    const all = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    const filtered = listLocalGenes({ project_root: PLAYGROUND_ROOT, domain: "content", fidelity: "Wrapped" });
    expect(filtered.total).toBeLessThanOrEqual(all.total);
    for (const g of filtered.genes) {
      expect(g.domain.startsWith("content")).toBe(true);
      expect(g.fidelity).toBe("Wrapped");
    }
  });
});
