import {
  listGenes,
  getGene,
  getArenaRankings,
  getGeneStatsRpc,
  getReputationLeaderboard,
  getDeveloperProfile,
  arenaSubmitCloud,
  installGene,
  listGeneVersions as listGeneVersionsCloud,
  getMcpStats as getMcpStatsCloud,
  getGeneReputation as getGeneReputationCloud,
  getMyReputation as getMyReputationCloud,
  suggestDomain as suggestDomainCloud,
  loadCloudConfig,
  type Gene,
  type GeneListResult,
  type ArenaRankingsResult,
  type GeneStats,
  type LeaderboardEntry,
  type DeveloperProfile,
  type ArenaSubmitResult,
  type InstallResult,
  type GeneVersionEntry,
  type McpStatsResult,
  type GeneReputationResult,
  type MyReputationResult,
  type DomainSuggestion,
} from "./cloud.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  generateCodeVerifier,
  generateCodeChallenge,
  waitForOAuthCallback,
} from "./auth.js";
import { openBrowser } from "./open-browser.js";

export async function searchGenes(args: {
  query?: string;
  domain?: string;
  fidelity?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<GeneListResult> {
  return listGenes({
    query: args.query,
    domain: args.domain,
    fidelity: args.fidelity,
    sort: args.sort,
    page: args.page || 1,
    perPage: Math.min(args.perPage || 20, 50),
  });
}

export async function getGeneDetail(args: { id: string }): Promise<Gene & { phenotype: Record<string, unknown> }> {
  if (!args.id) throw new Error("Gene id is required");
  return getGene(args.id);
}

export async function arenaRankings(args: {
  domain?: string;
  page?: number;
  perPage?: number;
}): Promise<ArenaRankingsResult> {
  return getArenaRankings({
    domain: args.domain,
    page: args.page || 1,
    perPage: Math.min(args.perPage || 20, 50),
  });
}

export async function geneStats(args: { gene_id: string }): Promise<GeneStats & { gene_id: string }> {
  if (!args.gene_id) throw new Error("gene_id is required");
  const stats = await getGeneStatsRpc(args.gene_id);
  return { gene_id: args.gene_id, ...stats };
}

export async function leaderboard(args: {
  limit?: number;
}): Promise<{ developers: LeaderboardEntry[]; count: number }> {
  const data = await getReputationLeaderboard(args.limit || 20);
  return { developers: data, count: data.length };
}

export async function developerProfile(args: {
  username: string;
}): Promise<DeveloperProfile> {
  if (!args.username) throw new Error("username is required");
  return getDeveloperProfile(args.username);
}

export { listLocalGenes, listLocalAgents, createLocalAgent, agentRun, compileGene, runGene, initGene, scanGenes, wrapGene, testGene, publishGene } from "./local.js";

export async function mcpStats(args: {
  days?: number;
}): Promise<McpStatsResult> {
  return getMcpStatsCloud(args.days || 7);
}

export async function geneVersions(args: {
  owner: string;
  name: string;
}): Promise<{ versions: GeneVersionEntry[]; count: number }> {
  if (!args.owner || !args.name) throw new Error("owner and name are required");
  const versions = await listGeneVersionsCloud(args.owner, args.name);
  return { versions, count: versions.length };
}

// ── Reputation tools ──

export async function geneReputation(args: {
  gene_id: string;
}): Promise<GeneReputationResult> {
  if (!args.gene_id) throw new Error("gene_id is required");
  return getGeneReputationCloud(args.gene_id);
}

export async function myReputation(): Promise<MyReputationResult> {
  return getMyReputationCloud();
}

export async function domainSuggestion(args: {
  description: string;
}): Promise<{ suggestions: DomainSuggestion[]; count: number }> {
  if (!args.description) throw new Error("description is required");
  const suggestions = await suggestDomainCloud(args.description);
  return { suggestions, count: suggestions.length };
}

// ── Auth tools ──

export interface AuthStatusResult {
  logged_in: boolean;
  username: string | null;
  provider: string | null;
  expires_in_minutes: number | null;
}

export function authStatus(): AuthStatusResult {
  const creds = loadCredentials();
  if (!creds) {
    return { logged_in: false, username: null, provider: null, expires_in_minutes: null };
  }
  const remaining = Math.max(0, Math.round((creds.expires_at - Date.now()) / 60_000));
  return {
    logged_in: true,
    username: creds.user.username,
    provider: creds.provider,
    expires_in_minutes: remaining,
  };
}

export interface LoginResult {
  success: boolean;
  username: string | null;
  provider: string | null;
  message: string;
}

export async function login(args: {
  provider?: string;
}): Promise<LoginResult> {
  const existing = loadCredentials();
  if (existing) {
    return {
      success: true,
      username: existing.user.username,
      provider: existing.provider,
      message: `Already logged in as ${existing.user.username} (via ${existing.provider}).`,
    };
  }

  const provider = (args.provider || "github") as "github" | "gitlab";
  const config = loadCloudConfig();
  const callbackPort = 9876;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl =
    `${config.endpoint}/auth/v1/authorize?provider=${provider}` +
    `&redirect_to=http://localhost:${callbackPort}/callback` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  openBrowser(authUrl);

  try {
    const callbackResult = await waitForOAuthCallback(callbackPort);

    let accessToken: string;
    let refreshToken: string;

    if (callbackResult.startsWith("implicit:")) {
      const parts = callbackResult.split(":");
      accessToken = parts.slice(1, -1).join(":");
      refreshToken = parts[parts.length - 1];
    } else {
      const tokenRes = await fetch(
        `${config.endpoint}/auth/v1/token?grant_type=pkce`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: config.anonKey },
          body: JSON.stringify({ auth_code: callbackResult, code_verifier: codeVerifier }),
        }
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return { success: false, username: null, provider: null, message: `Authentication failed: ${err}` };
      }

      const tokenData = (await tokenRes.json()) as any;
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;
    }

    const userRes = await fetch(`${config.endpoint}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: config.anonKey },
    });
    const userData = (await userRes.json()) as any;
    const meta = userData.user_metadata || {};

    const username =
      meta.user_name || meta.preferred_username || meta.name ||
      meta.nickname || meta.email?.split("@")[0] || "unknown";

    saveCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + 3600 * 1000,
      provider,
      user: {
        id: userData.id,
        username,
        avatar_url: meta.avatar_url || null,
        provider_id: meta.provider_id || meta.sub || "",
      },
    });

    return { success: true, username, provider, message: `Logged in as ${username} (via ${provider}).` };
  } catch (err: any) {
    return { success: false, username: null, provider: null, message: err.message || "Login failed." };
  }
}

export interface LogoutResult {
  success: boolean;
  message: string;
}

export function logout(): LogoutResult {
  const existing = loadCredentials();
  if (!existing) {
    return { success: true, message: "Not currently logged in." };
  }
  clearCredentials();
  return { success: true, message: `Logged out (was: ${existing.user.username} via ${existing.provider}).` };
}

export async function submitToArena(args: {
  gene_id: string;
  fitness_value: number;
  safety_score: number;
  success_rate: number;
  latency_score: number;
  resource_efficiency: number;
}): Promise<ArenaSubmitResult> {
  if (!args.gene_id) throw new Error("gene_id is required");
  return arenaSubmitCloud(args.gene_id, {
    value: args.fitness_value,
    safety_score: args.safety_score,
    success_rate: args.success_rate,
    latency_score: args.latency_score,
    resource_efficiency: args.resource_efficiency,
  });
}

export async function installGeneFromCloud(args: {
  gene_id: string;
  project_root?: string;
}): Promise<InstallResult> {
  if (!args.gene_id) throw new Error("gene_id is required");
  return installGene(args.gene_id, args.project_root || process.cwd());
}

export async function compareGenes(args: {
  gene_ids: string[];
}): Promise<{
  comparison: Array<{
    gene_id: string;
    gene_name: string;
    domain: string;
    fidelity: string;
    fitness: number | null;
    safety: number | null;
    reputation_score: number | null;
    downloads: number;
  }>;
  recommendation: string;
}> {
  if (!args.gene_ids || args.gene_ids.length < 2) {
    throw new Error("At least 2 gene_ids required for comparison");
  }
  if (args.gene_ids.length > 5) {
    throw new Error("Maximum 5 genes can be compared at once");
  }

  const genes = await Promise.all(args.gene_ids.map((id) => getGene(id)));

  const comparison = genes.map((g) => ({
    gene_id: g.id,
    gene_name: g.name,
    domain: g.domain,
    fidelity: g.fidelity,
    fitness: g.reputation_score,
    safety: null as number | null,
    reputation_score: g.reputation_score,
    downloads: g.downloads,
  }));

  const sorted = [...comparison].sort(
    (a, b) => (b.reputation_score || 0) - (a.reputation_score || 0)
  );
  const best = sorted[0];

  return {
    comparison,
    recommendation: best
      ? `Based on available metrics, "${best.gene_name}" has the highest score (${best.reputation_score ?? "N/A"}). Use Arena rankings for authoritative F(g)-based comparison within a domain.`
      : "Insufficient data for recommendation.",
  };
}
