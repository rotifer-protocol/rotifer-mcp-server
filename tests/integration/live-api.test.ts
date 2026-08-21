import { describe, it, expect } from "vitest";
import {
  searchGenes,
  getGeneDetail,
  arenaRankings,
  compareGenes,
  geneStats,
  leaderboard,
  developerProfile,
} from "../../src/tools.js";
import { loadCloudConfig } from "../../src/cloud.js";

// The key resolves from ~/.rotifer/cloud.json first and only then from the
// environment, so gating on the env var alone skipped this whole suite on every
// machine that had logged in — reporting green for tests that never ran. Ask
// the same loader the code under test asks.
const hasCloudKey = !!loadCloudConfig().anonKey;
const describeCloud = hasCloudKey ? describe : describe.skip;

describeCloud("search_genes", { timeout: 15000 }, () => {
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

describeCloud("get_gene_detail", { timeout: 15000 }, () => {
  it("returns gene with phenotype", async () => {
    const search = await searchGenes({ perPage: 1 });
    const g = await getGeneDetail({ gene_id: search.genes[0].id });
    expect(g.id).toBe(search.genes[0].id);
    expect(g.name).toBeTruthy();
    expect(g.phenotype).toBeDefined();
  });

  it("throws on invalid gene id", async () => {
    await expect(
      getGeneDetail({ gene_id: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow("not found");
  });

  it("throws on empty id", async () => {
    await expect(getGeneDetail({ gene_id: "" })).rejects.toThrow("required");
  });
});

describeCloud("get_arena_rankings", { timeout: 15000 }, () => {
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
      expect(e.rank === null || typeof e.rank === "number").toBe(true);
      expect(typeof e.tier).toBe("string");
      expect(typeof e.geneId).toBe("string");
      expect(typeof e.fitness).toBe("number");
    }
  });

  // The contract this server broke. These run against the real endpoint on
  // purpose: the defect was never in how the client handled a reply, it was in
  // which reply it asked for, and only a real counterpart can tell those apart.
  it("never hands back a rank the board withheld", async () => {
    const r = await arenaRankings({ perPage: 50 });
    expect(r.rankings.length).toBeGreaterThan(0);
    for (const e of r.rankings) {
      if (e.tier === "not_evaluated") {
        expect(e.rank).toBeNull();
      } else {
        expect(typeof e.rank).toBe("number");
      }
      // A disqualified row may still be shown — with its reason — but never ranked.
      if (e.invalidationReason) expect(e.rank).toBeNull();
    }
  });

  it("does not answer sim.particle with the disqualified March entries", async () => {
    // Before the repoint this returned six rows: three genes' 0.1.x versions at
    // fitness 1.000 last evaluated 2026-03-17 — artifacts the runtime refuses
    // to execute — ranked 1, 2, 3, alongside their replacements.
    const r = await arenaRankings({ domain: "sim.particle" });
    // Six rows came back before; three genes exist. One row per logical gene,
    // not one per version — that difference IS the disqualified versions.
    const names = r.rankings.map((e) => e.geneName);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const e of r.rankings) {
      expect(e.versionsOnBoard).toBeGreaterThanOrEqual(1);
      if (e.tier === "not_evaluated") expect(e.rank).toBeNull();
    }
  });
});

describeCloud("get_gene_stats", { timeout: 15000 }, () => {
  it("returns download stats for valid gene", async () => {
    const search = await searchGenes({ perPage: 1 });
    const r = await geneStats({ gene_id: search.genes[0].id });
    expect(typeof r.total).toBe("number");
    expect(typeof r.last7d).toBe("number");
    expect(r.last7d).toBeLessThanOrEqual(r.last30d);
    expect(r.last30d).toBeLessThanOrEqual(r.last90d);
  });

  it("returns zero stats for non-existent gene", async () => {
    const r = await geneStats({ gene_id: "00000000-0000-0000-0000-000000000000" });
    expect(r.total).toBe(0);
    expect(r.last7d).toBe(0);
    expect(r.last30d).toBe(0);
    expect(r.last90d).toBe(0);
  });
});

describeCloud("get_leaderboard", { timeout: 15000 }, () => {
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
      expect(typeof d.userId).toBe("string");
      expect(typeof d.username).toBe("string");
      expect(typeof d.score).toBe("number");
    }
  });
});

describeCloud("get_developer_profile", { timeout: 15000 }, () => {
  it("returns profile for valid username", async () => {
    const search = await searchGenes({ perPage: 1 });
    const owner = search.genes[0].owner;
    const p = await developerProfile({ username: owner });
    expect(p.username).toBe(owner);
    expect(typeof p.userId).toBe("string");
    expect(typeof p.createdAt).toBe("string");
  });

  it("throws on nonexistent username", async () => {
    await expect(
      developerProfile({ username: "zzz_nonexistent_user_xyz_99999" })
    ).rejects.toThrow("not found");
  });
});

describeCloud("compare_genes", { timeout: 15000 }, () => {
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
