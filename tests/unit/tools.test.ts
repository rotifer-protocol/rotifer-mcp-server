import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/cloud.js", () => ({
  listGenes: vi.fn(),
  getGene: vi.fn(),
  getArenaRankings: vi.fn(),
  getGeneStatsRpc: vi.fn(),
  getReputationLeaderboard: vi.fn(),
  getDeveloperProfile: vi.fn(),
  arenaSubmitCloud: vi.fn(),
  installGene: vi.fn(),
  loadCloudConfig: vi.fn().mockReturnValue({ endpoint: "https://test.rotifer.dev", anonKey: "test-key" }),
}));

vi.mock("../../src/auth.js", () => ({
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  generateCodeVerifier: vi.fn().mockReturnValue("test-verifier"),
  generateCodeChallenge: vi.fn().mockReturnValue("test-challenge"),
  waitForOAuthCallback: vi.fn(),
}));

vi.mock("../../src/open-browser.js", () => ({
  openBrowser: vi.fn(),
}));

import {
  searchGenes,
  getGeneDetail,
  arenaRankings,
  compareGenes,
  geneStats,
  leaderboard,
  developerProfile,
  submitToArena,
  installGeneFromCloud,
  authStatus,
  login,
  logout,
} from "../../src/tools.js";

import {
  listGenes,
  getGene,
  getArenaRankings as getArenaRankingsMock,
  getGeneStatsRpc,
  getReputationLeaderboard,
  getDeveloperProfile,
  arenaSubmitCloud,
  installGene,
} from "../../src/cloud.js";

import { loadCredentials, clearCredentials } from "../../src/auth.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchGenes", () => {
  it("caps perPage at 50", async () => {
    vi.mocked(listGenes).mockResolvedValueOnce({ genes: [], total: 0, page: 1, per_page: 50 });
    await searchGenes({ perPage: 999 });
    expect(vi.mocked(listGenes)).toHaveBeenCalledWith(
      expect.objectContaining({ perPage: 50 })
    );
  });

  it("defaults page to 1", async () => {
    vi.mocked(listGenes).mockResolvedValueOnce({ genes: [], total: 0, page: 1, per_page: 20 });
    await searchGenes({});
    expect(vi.mocked(listGenes)).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  it("passes through all filter options", async () => {
    vi.mocked(listGenes).mockResolvedValueOnce({ genes: [], total: 0, page: 1, per_page: 5 });
    await searchGenes({ query: "test", domain: "code", fidelity: "Native", page: 2, perPage: 5 });
    expect(vi.mocked(listGenes)).toHaveBeenCalledWith({
      query: "test", domain: "code", fidelity: "Native", page: 2, perPage: 5,
    });
  });
});

describe("getGeneDetail", () => {
  it("throws on empty id", async () => {
    await expect(getGeneDetail({ id: "" })).rejects.toThrow("required");
  });

  it("delegates to getGene", async () => {
    const fakeGene = { id: "abc", name: "test", phenotype: {} } as any;
    vi.mocked(getGene).mockResolvedValueOnce(fakeGene);
    const result = await getGeneDetail({ id: "abc" });
    expect(result).toBe(fakeGene);
  });
});

describe("geneStats", () => {
  it("throws on empty gene_id", async () => {
    await expect(geneStats({ gene_id: "" })).rejects.toThrow("required");
  });

  it("attaches gene_id to result", async () => {
    vi.mocked(getGeneStatsRpc).mockResolvedValueOnce({ total: 10, last_7d: 1, last_30d: 5, last_90d: 8 });
    const result = await geneStats({ gene_id: "xyz" });
    expect(result.gene_id).toBe("xyz");
    expect(result.total).toBe(10);
  });
});

describe("leaderboard", () => {
  it("defaults limit to 20", async () => {
    vi.mocked(getReputationLeaderboard).mockResolvedValueOnce([]);
    await leaderboard({});
    expect(vi.mocked(getReputationLeaderboard)).toHaveBeenCalledWith(20);
  });

  it("count matches array length", async () => {
    const devs = [{ user_id: "a" }, { user_id: "b" }] as any[];
    vi.mocked(getReputationLeaderboard).mockResolvedValueOnce(devs);
    const result = await leaderboard({ limit: 5 });
    expect(result.count).toBe(2);
    expect(result.developers.length).toBe(2);
  });
});

describe("developerProfile", () => {
  it("throws on empty username", async () => {
    await expect(developerProfile({ username: "" })).rejects.toThrow("required");
  });

  it("delegates to getDeveloperProfile", async () => {
    const fakeProfile = { user_id: "u1", username: "dev" } as any;
    vi.mocked(getDeveloperProfile).mockResolvedValueOnce(fakeProfile);
    const result = await developerProfile({ username: "dev" });
    expect(result).toBe(fakeProfile);
  });
});

describe("arenaRankings", () => {
  it("caps perPage at 50", async () => {
    vi.mocked(getArenaRankingsMock).mockResolvedValueOnce({ rankings: [], total: 0, domain: null });
    await arenaRankings({ perPage: 999 });
    expect(vi.mocked(getArenaRankingsMock)).toHaveBeenCalledWith(
      expect.objectContaining({ perPage: 50 })
    );
  });

  it("defaults page to 1", async () => {
    vi.mocked(getArenaRankingsMock).mockResolvedValueOnce({ rankings: [], total: 0, domain: null });
    await arenaRankings({});
    expect(vi.mocked(getArenaRankingsMock)).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  it("passes domain filter", async () => {
    vi.mocked(getArenaRankingsMock).mockResolvedValueOnce({ rankings: [], total: 0, domain: "search.web" });
    await arenaRankings({ domain: "search.web" });
    expect(vi.mocked(getArenaRankingsMock)).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "search.web" })
    );
  });
});

describe("compareGenes", () => {
  it("rejects fewer than 2 gene_ids", async () => {
    await expect(compareGenes({ gene_ids: ["one"] })).rejects.toThrow("At least 2");
  });

  it("rejects more than 5 gene_ids", async () => {
    await expect(compareGenes({ gene_ids: ["a", "b", "c", "d", "e", "f"] })).rejects.toThrow("Maximum 5");
  });

  it("rejects empty array", async () => {
    await expect(compareGenes({ gene_ids: [] })).rejects.toThrow("At least 2");
  });

  it("sorts by reputation_score and generates recommendation", async () => {
    vi.mocked(getGene)
      .mockResolvedValueOnce({ id: "a", name: "Low", domain: "d", fidelity: "Wrapped", reputation_score: 3, downloads: 1 } as any)
      .mockResolvedValueOnce({ id: "b", name: "High", domain: "d", fidelity: "Native", reputation_score: 9, downloads: 5 } as any);

    const result = await compareGenes({ gene_ids: ["a", "b"] });
    expect(result.comparison.length).toBe(2);
    expect(result.recommendation).toContain("High");
    expect(result.recommendation).toContain("9");
  });

  it("rejects when one getGene call fails", async () => {
    vi.mocked(getGene)
      .mockResolvedValueOnce({ id: "a", name: "OK", domain: "d", fidelity: "Wrapped", reputation_score: 5, downloads: 1 } as any)
      .mockRejectedValueOnce(new Error("Gene 'b' not found"));

    await expect(compareGenes({ gene_ids: ["a", "b"] })).rejects.toThrow("not found");
  });

  it("handles null reputation scores", async () => {
    vi.mocked(getGene)
      .mockResolvedValueOnce({ id: "a", name: "A", domain: "d", fidelity: "Wrapped", reputation_score: null, downloads: 0 } as any)
      .mockResolvedValueOnce({ id: "b", name: "B", domain: "d", fidelity: "Wrapped", reputation_score: null, downloads: 0 } as any);

    const result = await compareGenes({ gene_ids: ["a", "b"] });
    expect(result.recommendation).toContain("N/A");
  });
});

describe("submitToArena", () => {
  it("throws on empty gene_id", async () => {
    await expect(submitToArena({
      gene_id: "", fitness_value: 0.5, safety_score: 0.5,
      success_rate: 0.5, latency_score: 0.5, resource_efficiency: 0.5,
    })).rejects.toThrow("required");
  });

  it("delegates to arenaSubmitCloud with correct mapping", async () => {
    vi.mocked(arenaSubmitCloud).mockResolvedValueOnce({
      gene_id: "g1", domain: "d", fitness_value: 0.9, safety_score: 0.8,
      success_rate: 0.95, latency_score: 0.7, resource_efficiency: 0.85,
    });
    const result = await submitToArena({
      gene_id: "g1", fitness_value: 0.9, safety_score: 0.8,
      success_rate: 0.95, latency_score: 0.7, resource_efficiency: 0.85,
    });
    expect(result.gene_id).toBe("g1");
    expect(vi.mocked(arenaSubmitCloud)).toHaveBeenCalledWith("g1", {
      value: 0.9, safety_score: 0.8, success_rate: 0.95,
      latency_score: 0.7, resource_efficiency: 0.85,
    });
  });
});

describe("installGeneFromCloud", () => {
  it("throws on empty gene_id", async () => {
    await expect(installGeneFromCloud({ gene_id: "" })).rejects.toThrow("required");
  });

  it("delegates to installGene", async () => {
    vi.mocked(installGene).mockResolvedValueOnce({
      gene_id: "g1", name: "test", domain: "d", fidelity: "Native", installed_to: "/path",
    });
    const result = await installGeneFromCloud({ gene_id: "g1" });
    expect(result.name).toBe("test");
  });
});

describe("authStatus", () => {
  it("returns logged_in=false when no credentials", () => {
    vi.mocked(loadCredentials).mockReturnValueOnce(null);
    const result = authStatus();
    expect(result.logged_in).toBe(false);
    expect(result.username).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.expires_in_minutes).toBeNull();
  });

  it("returns logged_in=true with user info when credentials exist", () => {
    vi.mocked(loadCredentials).mockReturnValueOnce({
      access_token: "tok", refresh_token: "ref",
      expires_at: Date.now() + 3600_000,
      provider: "gitlab",
      user: { id: "u1", username: "dev", avatar_url: null, provider_id: "p1" },
    });
    const result = authStatus();
    expect(result.logged_in).toBe(true);
    expect(result.username).toBe("dev");
    expect(result.provider).toBe("gitlab");
    expect(result.expires_in_minutes).toBeGreaterThan(0);
  });
});

describe("login", () => {
  it("returns early if already logged in", async () => {
    vi.mocked(loadCredentials).mockReturnValueOnce({
      access_token: "tok", refresh_token: "ref",
      expires_at: Date.now() + 3600_000,
      provider: "gitlab",
      user: { id: "u1", username: "existing-user", avatar_url: null, provider_id: "p1" },
    });
    const result = await login({});
    expect(result.success).toBe(true);
    expect(result.username).toBe("existing-user");
    expect(result.message).toContain("Already logged in");
  });
});

describe("logout", () => {
  it("returns message when not logged in", () => {
    vi.mocked(loadCredentials).mockReturnValueOnce(null);
    const result = logout();
    expect(result.success).toBe(true);
    expect(result.message).toContain("Not currently logged in");
  });

  it("clears credentials and returns username", () => {
    vi.mocked(loadCredentials).mockReturnValueOnce({
      access_token: "tok", refresh_token: "ref",
      expires_at: Date.now() + 3600_000,
      provider: "github",
      user: { id: "u1", username: "dev", avatar_url: null, provider_id: "p1" },
    });
    const result = logout();
    expect(result.success).toBe(true);
    expect(result.message).toContain("dev");
    expect(vi.mocked(clearCredentials)).toHaveBeenCalled();
  });
});
