import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth.js", () => ({
  loadCredentials: vi.fn().mockReturnValue({
    access_token: "test-token", refresh_token: "ref",
    expires_at: Date.now() + 3600_000, provider: "gitlab",
    user: { id: "u1", username: "testuser", avatar_url: null, provider_id: "p1" },
  }),
  saveCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  generateCodeVerifier: vi.fn(),
  generateCodeChallenge: vi.fn(),
  startOAuthCallbackServer: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(data: any, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// Dynamic import after mocking fetch
const {
  listGenes,
  getGene,
  getArenaRankings,
  getGeneStatsRpc,
  getReputationLeaderboard,
  getDeveloperProfile,
} = await import("../../src/cloud.js");

beforeEach(() => {
  mockFetch.mockReset();
});

describe("listGenes", () => {
  it("calls RPC search_genes endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await listGenes({});
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/rest/v1/rpc/search_genes");
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.method).toBe("POST");
  });

  it("passes query in POST body as p_query", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await listGenes({ query: "%()*_\\.test" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.p_query).toBe("%()*_\\.test");
  });

  it("passes domain filter in POST body as p_domain", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await listGenes({ domain: "search.web" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.p_domain).toBe("search.web");
  });

  it("passes real server-side pagination parameters", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await listGenes({ page: 3, perPage: 10 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.p_offset).toBe(20);
    expect(body.p_limit).toBe(10);
  });

  it("maps RPC response rows to Gene shape and reads the exact total_count", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        [{ id: "abc", name: "test", domain: "d", version: "1", fidelity: "Native", description: "desc", wasm_size: 100, downloads: 5, reputation_score: 0.8, created_at: "2026-01-01", updated_at: "2026-01-02", owner_username: "user1", rank: 0, total_count: 92 }]
      )
    );
    const result = await listGenes({});
    expect(result.genes[0].owner).toBe("user1");
    expect(result.genes[0].name).toBe("test");
    expect(result.total).toBe(92);
    expect(result.has_more).toBe(true);
  });

  it("reports has_more=false on the final page", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        [{ id: "xyz", name: "last", domain: "d", version: "1", fidelity: "Native", description: "desc", wasm_size: 1, downloads: 0, reputation_score: null, created_at: "2026-01-01", updated_at: "2026-01-02", owner_username: "user1", rank: 0, total_count: 21 }]
      )
    );
    const result = await listGenes({ page: 2, perPage: 20 });
    expect(result.total).toBe(21);
    expect(result.has_more).toBe(false);
  });

  it("returns total 0 for an empty result", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    const result = await listGenes({ page: 9, perPage: 50 });
    expect(result.total).toBe(0);
    expect(result.has_more).toBe(false);
  });

  it("defaults owner to 'unknown' when owner_username is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        [{ id: "abc", name: "test", domain: "d", version: "1", fidelity: "Native", description: "desc" }]
      )
    );
    const result = await listGenes({});
    expect(result.genes[0].owner).toBe("unknown");
  });
});

describe("getGene", () => {
  it("throws on empty result", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await expect(getGene("no-such-id")).rejects.toThrow("not found");
  });

  it("maps response to Gene with phenotype", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        id: "abc", name: "test", domain: "d", version: "1", fidelity: "Native",
        description: "desc", phenotype: { input: {} }, wasm_size: 100, downloads: 5,
        reputation_score: null, created_at: "2026-01-01", updated_at: "2026-01-02",
        published: true, owner_id: "u1",
        profiles: { username: "owner1" },
      }])
    );
    const gene = await getGene("abc");
    expect(gene.phenotype).toEqual({ input: {} });
    expect(gene.owner).toBe("owner1");
    expect(gene.reputationScore).toBeNull();
  });
});

describe("getArenaRankings", () => {
  // Shape of one `get_arena_leaderboard` row, trimmed to what the mapper reads.
  function lbRow(over: Record<string, unknown> = {}) {
    return {
      tier: "verified", tier_rank: 1, gene_id: "abc", gene_name: "test",
      gene_version: "1.0.0", owner_username: "usr", domain: "d", fidelity: "Native",
      fitness_value: 0.9, base_fitness: 1.0, fidelity_discount: 0.9, safety_score: 0.8,
      evaluation_method: "sandbox", evaluation_n: 5, unique_callers: 3,
      invalidation_reason: null, total_calls: "50", last_evaluated: "2026-01-01",
      versions_on_board: "2", ...over,
    };
  }

  it("asks the leaderboard function, not the arena_entries table", async () => {
    // The table is what this server used to select, and selecting it is the
    // whole defect: it cannot see invalidation, tiers, or which version of a
    // gene should represent it.
    mockFetch
      .mockResolvedValueOnce(mockResponse([], 200, { "content-range": "0-0/0" }))
      .mockResolvedValueOnce(mockResponse([]));
    await getArenaRankings({ domain: "search.web", page: 2, perPage: 10 });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rpc/get_arena_leaderboard");
    expect(url).not.toContain("/arena_entries");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ p_domain: "search.web", p_limit: 10, p_offset: 10 });
  });

  it("carries the tier and the rank the tier granted", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse([lbRow()], 200, { "content-range": "0-0/1" }))
      .mockResolvedValueOnce(mockResponse([{
        gene_id: "abc", success_rate: 0.95, latency_score: 0.7, resource_efficiency: 0.85,
      }]));
    const result = await getArenaRankings({});
    const e = result.rankings[0];

    expect(e.tier).toBe("verified");
    expect(e.rank).toBe(1);
    expect(e.geneVersion).toBe("1.0.0");
    expect(e.owner).toBe("usr");
    expect(e.baseFitness).toBe(1.0);
    expect(e.evaluationMethod).toBe("sandbox");
    expect(e.uniqueCallers).toBe(3);
    expect(e.versionsOnBoard).toBe(2);
    expect(e.totalCalls).toBe(50);
    // The three dimensions the leaderboard does not carry, merged back in.
    expect(e.successRate).toBe(0.95);
    expect(e.latencyScore).toBe(0.7);
    expect(e.resourceEfficiency).toBe(0.85);
    expect(result.total).toBe(1);
  });

  it("reports no rank for a row the board granted none", async () => {
    // This is the case that mattered. `sim.particle` answered with three
    // entries at fitness 1.000 whose artifacts the runtime refuses to execute,
    // ranked 1-2-3 by array position. A null tier_rank must survive as null.
    mockFetch
      .mockResolvedValueOnce(mockResponse(
        [lbRow({ tier: "not_evaluated", tier_rank: null, invalidation_reason: "async-express-artifact" })],
        200, { "content-range": "0-0/1" },
      ))
      .mockResolvedValueOnce(mockResponse([]));
    const result = await getArenaRankings({});

    expect(result.rankings[0].rank).toBeNull();
    expect(result.rankings[0].tier).toBe("not_evaluated");
    expect(result.rankings[0].invalidationReason).toBe("async-express-artifact");
  });

  it("does not renumber rows by their position in the array", async () => {
    // The old mapper assigned `offset + i + 1`, so page 2 of anything came back
    // ranked 11, 12, 13 whatever the board said. Give it rows whose ranks are
    // neither sequential nor positional and check they arrive untouched.
    mockFetch
      .mockResolvedValueOnce(mockResponse(
        [lbRow({ tier_rank: 4 }), lbRow({ tier: "not_evaluated", tier_rank: null }), lbRow({ tier_rank: 1 })],
        200, { "content-range": "0-2/3" },
      ))
      .mockResolvedValueOnce(mockResponse([]));
    const result = await getArenaRankings({ page: 2, perPage: 10 });

    expect(result.rankings.map((r) => r.rank)).toEqual([4, null, 1]);
  });

  it("still returns the rankings when the metrics lookup fails", async () => {
    // Exercised, not merely written: the second call is made to reject, and the
    // three optional dimensions come back null while everything else survives.
    mockFetch
      .mockResolvedValueOnce(mockResponse([lbRow()], 200, { "content-range": "0-0/1" }))
      .mockRejectedValueOnce(new Error("network down"));
    const result = await getArenaRankings({});

    expect(result.rankings[0].fitness).toBe(0.9);
    expect(result.rankings[0].tier).toBe("verified");
    expect(result.rankings[0].successRate).toBeNull();
    expect(result.rankings[0].latencyScore).toBeNull();
    expect(result.rankings[0].resourceEfficiency).toBeNull();
  });

  it("skips the metrics lookup entirely when the board returned nothing", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([], 200, { "content-range": "*/0" }));
    const result = await getArenaRankings({ domain: "nothing.here" });

    expect(result.rankings).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("getGeneStatsRpc", () => {
  it("sends RPC POST and returns stats", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ total: 100, last_7d: 10, last_30d: 30, last_90d: 80 })
    );
    const stats = await getGeneStatsRpc("abc");
    expect(stats.total).toBe(100);
    expect(stats.last7d).toBe(10);
  });

  it("throws on error field in response", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: "Gene not found or not published" })
    );
    await expect(getGeneStatsRpc("bad")).rejects.toThrow("Gene not found");
  });

  it("coerces null values to 0", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ total: null, last_7d: null, last_30d: null, last_90d: null })
    );
    const stats = await getGeneStatsRpc("abc");
    expect(stats.total).toBe(0);
    expect(stats.last7d).toBe(0);
  });
});

describe("getReputationLeaderboard", () => {
  it("caps limit at 100", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await getReputationLeaderboard(999);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.p_limit).toBe(100);
  });

  it("returns array directly", async () => {
    const data = [{ user_id: "u1", username: "dev", avatar_url: null, score: 5, genes_published: 2, total_downloads: 10, arena_wins: 1 }];
    mockFetch.mockResolvedValueOnce(mockResponse(data));
    const result = await getReputationLeaderboard(5);
    expect(result).toEqual([{ userId: "u1", username: "dev", avatarUrl: null, score: 5, genesPublished: 2, totalDownloads: 10, arenaWins: 1 }]);
  });
});

describe("getDeveloperProfile", () => {
  it("throws on empty result", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await expect(getDeveloperProfile("nobody")).rejects.toThrow("not found");
  });

  it("normalizes developer_reputation array to object", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        id: "u1", username: "dev", avatar_url: null, created_at: "2026-01-01",
        developer_reputation: [{ score: 5, genes_published: 2, total_downloads: "10", arena_wins: 1 }],
      }])
    );
    const profile = await getDeveloperProfile("dev");
    expect(profile.reputation?.score).toBe(5);
    expect(profile.reputation?.totalDownloads).toBe(10);
  });

  it("handles missing developer_reputation gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        id: "u1", username: "dev", avatar_url: null, created_at: "2026-01-01",
        developer_reputation: null,
      }])
    );
    const profile = await getDeveloperProfile("dev");
    expect(profile.reputation).toBeNull();
  });
});
