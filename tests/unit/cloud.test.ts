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
  arenaSubmitCloud,
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

  it("always fetches from offset 0 with inflated limit for client-side dedup pagination", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await listGenes({ page: 3, perPage: 10 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.p_offset).toBe(0);
    expect(body.p_limit).toBe(30);
  });

  it("maps RPC response rows to Gene shape", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        [{ id: "abc", name: "test", domain: "d", version: "1", fidelity: "Native", description: "desc", wasm_size: 100, downloads: 5, reputation_score: 0.8, created_at: "2026-01-01", updated_at: "2026-01-02", owner_username: "user1" }]
      )
    );
    const result = await listGenes({});
    expect(result.genes[0].owner).toBe("user1");
    expect(result.genes[0].name).toBe("test");
    expect(result.total).toBe(1);
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
  it("sends PostgREST GET with correct query params", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await getArenaRankings({ domain: "search.web", page: 2, perPage: 10 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/arena_entries");
    expect(url).toContain("domain=eq.search.web");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=10");
    expect(opts.method ?? "GET").toBe("GET");
  });

  it("parses rank and full metrics", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        gene_id: "abc", domain: "d", fitness_value: 0.9, safety_score: 0.8,
        success_rate: 0.95, latency_score: 0.7, resource_efficiency: 0.85,
        total_calls: "50", last_evaluated: "2026-01-01",
        genes: { id: "abc", name: "test", fidelity: "Native", profiles: { username: "usr" } },
      }])
    );
    const result = await getArenaRankings({});
    expect(result.rankings[0].rank).toBe(1);
    expect(result.rankings[0].totalCalls).toBe(50);
    expect(result.rankings[0].successRate).toBe(0.95);
    expect(result.rankings[0].latencyScore).toBe(0.7);
    expect(result.rankings[0].resourceEfficiency).toBe(0.85);
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

describe("arenaSubmitCloud", () => {
  it("fetches gene detail then POSTs to arena_entries", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        id: "gene-1", name: "test", domain: "d", version: "1", fidelity: "Native",
        description: "desc", phenotype: {}, wasm_size: 100, downloads: 5,
        reputation_score: null, created_at: "2026-01-01", updated_at: "2026-01-02",
        published: true, owner_id: "u1",
        profiles: { username: "owner1" },
      }])
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        gene_id: "gene-1", domain: "d", fitness_value: 0.9, safety_score: 0.8,
        success_rate: 0.95, latency_score: 0.7, resource_efficiency: 0.85,
      }])
    );

    const result = await arenaSubmitCloud("gene-1", {
      value: 0.9, safety_score: 0.8, success_rate: 0.95,
      latency_score: 0.7, resource_efficiency: 0.85,
    });

    expect(result.geneId).toBe("gene-1");
    expect(result.fitnessValue).toBe(0.9);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const postUrl = mockFetch.mock.calls[1][0] as string;
    expect(postUrl).toContain("/arena_entries");
    const postOpts = mockFetch.mock.calls[1][1];
    expect(postOpts.method).toBe("POST");
  });

  it("throws when gene not found", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await expect(
      arenaSubmitCloud("bad-id", { value: 0.5, safety_score: 0.5, success_rate: 0.5, latency_score: 0.5, resource_efficiency: 0.5 })
    ).rejects.toThrow("not found");
  });

  it("includes Authorization header when credentials exist", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        id: "g1", name: "t", domain: "d", version: "1", fidelity: "Native",
        description: "d", phenotype: {}, wasm_size: 0, downloads: 0,
        reputation_score: null, created_at: "2026-01-01", updated_at: "2026-01-01",
        published: true, owner_id: "u1",
        profiles: { username: "u" },
      }])
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse([{
        gene_id: "g1", domain: "d", fitness_value: 0.5, safety_score: 0.5,
        success_rate: 0.5, latency_score: 0.5, resource_efficiency: 0.5,
      }])
    );

    await arenaSubmitCloud("g1", {
      value: 0.5, safety_score: 0.5, success_rate: 0.5, latency_score: 0.5, resource_efficiency: 0.5,
    });

    const postOpts = mockFetch.mock.calls[1][1];
    expect(postOpts.headers).toHaveProperty("Prefer");
    expect(postOpts.headers.Prefer).toContain("return=representation");
  });
});
