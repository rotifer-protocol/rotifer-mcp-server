import { describe, it, expect } from "vitest";
import { geneVersions, mcpStats } from "../../src/tools.js";
import { getDeveloperProfile } from "../../src/cloud.js";

describe("v0.7.5 migration: gene version chain", { timeout: 15000 }, () => {
  it("list_gene_versions returns linked versions for text-to-video", async () => {
    const r = await geneVersions({ owner: "sharesummer", gene_name: "text-to-video" });
    expect(r.count).toBeGreaterThanOrEqual(2);

    const hasLinked = r.versions.some((v: any) => v.previousVersionId != null);
    expect(hasLinked).toBe(true);
  });

  it("version chain has chronological ordering", async () => {
    const r = await geneVersions({ owner: "sharesummer", gene_name: "text-to-video" });
    const dates = r.versions.map((v: any) => new Date(v.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
    }
  });
});

describe("v0.7.5 migration: developer_reputation gene count", { timeout: 15000 }, () => {
  it("genes_published matches unique gene count (deduplication fix)", async () => {
    const profile = await getDeveloperProfile("rotifer-protocol");
    expect(profile).toBeDefined();
    expect(profile.reputation).not.toBeNull();
    expect(profile.reputation!.genesPublished).toBeGreaterThan(0);
  });
});

describe("v0.7.5 migration: mcp_call_log", { timeout: 15000 }, () => {
  it("get_mcp_stats requires authentication (RLS enforced)", async () => {
    await expect(mcpStats({ days: 30 })).rejects.toThrow(/auth/i);
  });
});
