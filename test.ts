#!/usr/bin/env npx tsx
/**
 * Comprehensive MCP Server test — exercises all 8 tools + 5 resources + error paths.
 * Run: npx tsx test.ts
 */

import {
  searchGenes,
  getGeneDetail,
  arenaRankings,
  compareGenes,
  geneStats,
  leaderboard,
  developerProfile,
  listLocalGenes,
} from "./src/tools.js";
import {
  getGeneStatsRpc,
  getReputationLeaderboard,
  getDeveloperProfile,
  getGene,
} from "./src/cloud.js";

const PLAYGROUND_ROOT = "../rotifer-playground";

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function expectError(fn: () => Promise<any>, pattern?: string) {
  try {
    await fn();
    throw new Error("Expected error but succeeded");
  } catch (err: any) {
    if (err.message === "Expected error but succeeded") throw err;
    if (pattern && !err.message.includes(pattern)) {
      throw new Error(`Expected error containing "${pattern}", got: "${err.message}"`);
    }
  }
}

// ============================================================
// SECTION 1: Cloud API Tools
// ============================================================

async function testCloudTools() {
  console.log("\n📡 Cloud API Tools\n");

  // --- search_genes ---
  let firstGeneId = "";

  await test("search_genes: basic query", async () => {
    const r = await searchGenes({ query: "grammar" });
    assert(r.genes.length > 0, "Should find at least one gene matching 'grammar'");
    assert(r.total > 0, "Total should be > 0");
    assert(r.page === 1, "Default page should be 1");
    firstGeneId = r.genes[0].id;
  });

  await test("search_genes: with domain filter", async () => {
    const r = await searchGenes({ domain: "search.web" });
    for (const g of r.genes) {
      assert(g.domain === "search.web", `Gene "${g.name}" has domain "${g.domain}", expected "search.web"`);
    }
  });

  await test("search_genes: with fidelity filter", async () => {
    const r = await searchGenes({ fidelity: "Native" });
    for (const g of r.genes) {
      assert(g.fidelity === "Native", `Gene "${g.name}" has fidelity "${g.fidelity}", expected "Native"`);
    }
  });

  await test("search_genes: pagination", async () => {
    const r = await searchGenes({ perPage: 3, page: 1 });
    assert(r.per_page === 3, "per_page should be 3");
    assert(r.genes.length <= 3, "Should return at most 3 genes");
  });

  await test("search_genes: empty results", async () => {
    const r = await searchGenes({ query: "zzz_nonexistent_gene_xyz_12345" });
    assert(r.genes.length === 0, "Should return empty results for nonsense query");
    assert(r.total === 0, "Total should be 0");
  });

  await test("search_genes: perPage capped at 50", async () => {
    const r = await searchGenes({ perPage: 999 });
    assert(r.per_page === 50, `per_page should be capped at 50, got ${r.per_page}`);
  });

  // --- get_gene_detail ---
  await test("get_gene_detail: valid gene", async () => {
    assert(firstGeneId !== "", "Need a gene ID from search_genes");
    const g = await getGeneDetail({ id: firstGeneId });
    assert(g.id === firstGeneId, "ID should match");
    assert(typeof g.name === "string" && g.name.length > 0, "Name should be non-empty");
    assert(typeof g.domain === "string", "Domain should exist");
    assert(g.phenotype !== undefined, "Phenotype should exist");
  });

  await test("get_gene_detail: invalid gene id → error", async () => {
    await expectError(
      () => getGeneDetail({ id: "00000000-0000-0000-0000-000000000000" }),
      "not found"
    );
  });

  await test("get_gene_detail: missing id → error", async () => {
    await expectError(
      () => getGeneDetail({ id: "" }),
      "required"
    );
  });

  // --- get_arena_rankings ---
  await test("get_arena_rankings: default (all domains)", async () => {
    const r = await arenaRankings({});
    assert(Array.isArray(r.rankings), "Rankings should be an array");
    assert(r.domain === null, "Domain should be null when not filtered");
  });

  await test("get_arena_rankings: with domain filter", async () => {
    const r = await arenaRankings({ domain: "search.web" });
    assert(r.domain === "search.web", "Domain should match filter");
    for (const e of r.rankings) {
      assert(e.domain === "search.web", `Entry domain "${e.domain}" should be "search.web"`);
    }
  });

  await test("get_arena_rankings: entries have correct shape", async () => {
    const r = await arenaRankings({ perPage: 5 });
    if (r.rankings.length > 0) {
      const e = r.rankings[0];
      assert(typeof e.rank === "number", "rank should be number");
      assert(typeof e.gene_id === "string", "gene_id should be string");
      assert(typeof e.gene_name === "string", "gene_name should be string");
      assert(typeof e.fitness === "number", "fitness should be number");
      assert(typeof e.safety === "number", "safety should be number");
    }
  });

  // --- get_gene_stats ---
  await test("get_gene_stats: valid gene", async () => {
    assert(firstGeneId !== "", "Need a gene ID");
    const r = await geneStats({ gene_id: firstGeneId });
    assert(r.gene_id === firstGeneId, "gene_id should match");
    assert(typeof r.total === "number", "total should be number");
    assert(typeof r.last_7d === "number", "last_7d should be number");
    assert(typeof r.last_30d === "number", "last_30d should be number");
    assert(typeof r.last_90d === "number", "last_90d should be number");
    assert(r.last_7d <= r.last_30d, "7d should be <= 30d");
    assert(r.last_30d <= r.last_90d, "30d should be <= 90d");
  });

  await test("get_gene_stats: invalid gene → error", async () => {
    await expectError(
      () => geneStats({ gene_id: "00000000-0000-0000-0000-000000000000" }),
      ""
    );
  });

  // --- get_leaderboard ---
  await test("get_leaderboard: default limit", async () => {
    const r = await leaderboard({});
    assert(Array.isArray(r.developers), "developers should be an array");
    assert(r.count === r.developers.length, "count should match array length");
  });

  await test("get_leaderboard: custom limit", async () => {
    const r = await leaderboard({ limit: 5 });
    assert(r.developers.length <= 5, "Should return at most 5 entries");
  });

  await test("get_leaderboard: entries have correct shape", async () => {
    const r = await leaderboard({ limit: 3 });
    if (r.developers.length > 0) {
      const d = r.developers[0];
      assert(typeof d.user_id === "string", "user_id should be string");
      assert(typeof d.username === "string", "username should be string");
      assert(typeof d.score === "number", "score should be number");
      assert(typeof d.genes_published === "number", "genes_published should be number");
    } else {
      console.log("    ⚠ leaderboard is empty (developer_reputation not computed yet)");
    }
  });

  // --- get_developer_profile ---
  let testUsername = "";

  await test("get_developer_profile: find a username first", async () => {
    const search = await searchGenes({ perPage: 1 });
    assert(search.genes.length > 0, "Need at least one published gene to find an owner");
    testUsername = search.genes[0].owner;
    assert(testUsername.length > 0 && testUsername !== "unknown", "Owner username should be non-empty");
  });

  await test("get_developer_profile: valid username", async () => {
    assert(testUsername !== "", "Need a username");
    const p = await developerProfile({ username: testUsername });
    assert(p.username === testUsername, "Username should match");
    assert(typeof p.user_id === "string", "user_id should be string");
    assert(typeof p.created_at === "string", "created_at should be string");
  });

  await test("get_developer_profile: invalid username → error", async () => {
    await expectError(
      () => developerProfile({ username: "zzz_nonexistent_user_xyz_99999" }),
      "not found"
    );
  });

  // --- compare_genes ---
  await test("compare_genes: compare 2 genes", async () => {
    const search = await searchGenes({ perPage: 2 });
    assert(search.genes.length >= 2, "Need at least 2 genes");
    const ids = search.genes.map((g) => g.id);
    const r = await compareGenes({ gene_ids: ids });
    assert(r.comparison.length === 2, "Should have 2 entries");
    assert(typeof r.recommendation === "string", "recommendation should be string");
  });

  await test("compare_genes: < 2 genes → error", async () => {
    await expectError(
      () => compareGenes({ gene_ids: ["one-id"] }),
      "At least 2"
    );
  });

  await test("compare_genes: > 5 genes → error", async () => {
    await expectError(
      () => compareGenes({ gene_ids: ["a", "b", "c", "d", "e", "f"] }),
      "Maximum 5"
    );
  });
}

// ============================================================
// SECTION 2: Local Filesystem Tool
// ============================================================

async function testLocalTools() {
  console.log("\n📂 Local Filesystem Tools\n");

  await test("list_local_genes: scan playground", async () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    assert(r.total > 0, `Should find genes, got ${r.total}`);
    assert(r.genes.length === r.total, "genes.length should match total");
    assert(r.genes_dir.includes("genes"), "genes_dir should include 'genes'");
  });

  await test("list_local_genes: every gene has required fields", async () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    for (const g of r.genes) {
      assert(typeof g.name === "string" && g.name.length > 0, `Gene name empty`);
      assert(typeof g.domain === "string" && g.domain.length > 0, `Gene "${g.name}" domain empty`);
      assert(typeof g.fidelity === "string", `Gene "${g.name}" fidelity missing`);
      assert(typeof g.has_wasm === "boolean", `Gene "${g.name}" has_wasm should be boolean`);
      assert(typeof g.has_source === "boolean", `Gene "${g.name}" has_source should be boolean`);
    }
  });

  await test("list_local_genes: domain filter", async () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT, domain: "code" });
    assert(r.total > 0, "Should find code.* genes");
    for (const g of r.genes) {
      assert(
        g.domain === "code" || g.domain.startsWith("code."),
        `Gene "${g.name}" domain "${g.domain}" doesn't match prefix "code"`
      );
    }
  });

  await test("list_local_genes: fidelity filter", async () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT, fidelity: "Native" });
    for (const g of r.genes) {
      assert(g.fidelity === "Native", `Gene "${g.name}" fidelity "${g.fidelity}" should be "Native"`);
    }
  });

  await test("list_local_genes: sorted by domain then name", async () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    for (let i = 1; i < r.genes.length; i++) {
      const prev = r.genes[i - 1];
      const curr = r.genes[i];
      const cmp = prev.domain.localeCompare(curr.domain) || prev.name.localeCompare(curr.name);
      assert(cmp <= 0, `Not sorted: "${prev.domain}/${prev.name}" > "${curr.domain}/${curr.name}"`);
    }
  });

  await test("list_local_genes: nonexistent path → empty", async () => {
    const r = listLocalGenes({ project_root: "/tmp/rotifer_test_nonexistent_xyz" });
    assert(r.total === 0, "Should return 0 genes for nonexistent path");
    assert(r.genes.length === 0, "genes array should be empty");
  });

  await test("list_local_genes: combined domain + fidelity filter", async () => {
    const all = listLocalGenes({ project_root: PLAYGROUND_ROOT });
    const filtered = listLocalGenes({ project_root: PLAYGROUND_ROOT, domain: "content", fidelity: "Wrapped" });
    assert(filtered.total <= all.total, "Filtered total should be <= all total");
    for (const g of filtered.genes) {
      assert(g.domain.startsWith("content"), `Domain "${g.domain}" should start with "content"`);
      assert(g.fidelity === "Wrapped", `Fidelity "${g.fidelity}" should be "Wrapped"`);
    }
  });
}

// ============================================================
// SECTION 3: MCP Resources (via cloud functions directly)
// ============================================================

async function testResources() {
  console.log("\n🔗 MCP Resource Handlers\n");

  await test("resource rotifer://genes/{id}/stats", async () => {
    const search = await searchGenes({ perPage: 1 });
    const geneId = search.genes[0]?.id;
    assert(geneId, "Need a gene ID");
    const stats = await getGeneStatsRpc(geneId);
    assert(typeof stats.total === "number", "total should be number");
    assert(typeof stats.last_7d === "number", "last_7d should be number");
  });

  await test("resource rotifer://genes/{id}", async () => {
    const search = await searchGenes({ perPage: 1 });
    const geneId = search.genes[0]?.id;
    const gene = await getGene(geneId);
    assert(gene.id === geneId, "ID should match");
    assert(typeof gene.phenotype === "object", "phenotype should be object");
  });

  await test("resource rotifer://developers/{username}", async () => {
    const search = await searchGenes({ perPage: 1 });
    assert(search.genes.length > 0, "Need a published gene to find an owner");
    const ownerName = search.genes[0].owner;
    const profile = await getDeveloperProfile(ownerName);
    assert(profile.username === ownerName, "Username should match");
  });

  await test("resource rotifer://leaderboard", async () => {
    const lb = await getReputationLeaderboard(20);
    assert(Array.isArray(lb), "Should return array");
  });

  await test("resource rotifer://local/genes", async () => {
    const r = listLocalGenes({});
    assert(typeof r.total === "number", "total should be number");
    assert(Array.isArray(r.genes), "genes should be array");
  });
}

// ============================================================
// SECTION 4: Edge Cases & Error Handling
// ============================================================

async function testEdgeCases() {
  console.log("\n⚠️  Edge Cases & Error Handling\n");

  await test("search_genes: special chars in query sanitized", async () => {
    const r = await searchGenes({ query: "%()*_\\.grammar" });
    // Should not throw, special chars stripped
    assert(r.page === 1, "Should return valid response");
  });

  await test("search_genes: query is only special chars → returns all", async () => {
    const r = await searchGenes({ query: "%_\\()*." });
    assert(r.page === 1, "Should return valid response (all genes, no filter)");
  });

  await test("get_gene_detail: malformed UUID → error", async () => {
    await expectError(
      () => getGeneDetail({ id: "not-a-uuid" }),
    );
  });

  await test("get_gene_stats: malformed UUID → error", async () => {
    await expectError(
      () => geneStats({ gene_id: "not-a-uuid" }),
    );
  });

  await test("compare_genes: empty array → error", async () => {
    await expectError(
      () => compareGenes({ gene_ids: [] }),
      "At least 2"
    );
  });

  await test("list_local_genes: domain filter with no matches → empty", async () => {
    const r = listLocalGenes({ project_root: PLAYGROUND_ROOT, domain: "zzz.nonexistent" });
    assert(r.total === 0, "Should return 0 for non-matching domain");
  });
}

// ============================================================
// Main runner
// ============================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Rotifer MCP Server — Comprehensive Test Suite      ║");
  console.log("║  8 Tools + 5 Resources + Error Paths                ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  const start = Date.now();

  await testCloudTools();
  await testLocalTools();
  await testResources();
  await testEdgeCases();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(56));
  console.log(`  Total: ${passed + failed}  |  ✅ ${passed} passed  |  ❌ ${failed} failed  |  ⏱ ${elapsed}s`);
  console.log("═".repeat(56));

  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
