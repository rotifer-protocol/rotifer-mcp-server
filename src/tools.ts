import { listSnapshots, restoreGene, type RestoreResult, type SnapshotMeta } from "./snapshots.js";
import { resolveGenesDir, resolveProjectRoot, arenaSubmit, type ShellResult } from "./local.js";
import {
  listGenes,
  getGene,
  getGeneByContentHash,
  getArenaRankings,
  getGeneStatsRpc,
  getReputationLeaderboard,
  getDeveloperProfile,
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
  startOAuthCallbackServer,
} from "./auth.js";
import { openBrowser } from "./open-browser.js";
import { validateGeneName } from "./validate-gene-name.js";

const SORT_ALIAS: Record<string, string> = {
  popular: "downloads",
  fitness: "reputation",
};

export async function searchGenes(args: {
  query?: string;
  domain?: string;
  fidelity?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<GeneListResult> {
  const rpcSort = args.sort ? (SORT_ALIAS[args.sort] || args.sort) : undefined;
  return listGenes({
    query: args.query,
    domain: args.domain,
    fidelity: args.fidelity,
    sort: rpcSort,
    page: args.page || 1,
    perPage: Math.min(args.perPage || 20, 50),
  });
}

export async function getGeneDetail(args: { gene_id?: string; content_hash?: string }): Promise<Gene & { phenotype: Record<string, unknown> }> {
  if (args.content_hash) {
    return getGeneByContentHash(args.content_hash);
  }
  if (!args.gene_id) throw new Error("Either gene_id or content_hash is required. Use search_genes to find gene IDs.");
  return getGene(args.gene_id);
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

export async function geneStats(args: { gene_id: string }): Promise<GeneStats & { geneId: string }> {
  if (!args.gene_id) throw new Error("gene_id is required. Use search_genes to find gene IDs.");
  const stats = await getGeneStatsRpc(args.gene_id);
  return { geneId: args.gene_id, ...stats };
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
  if (!args.username) throw new Error("username is required. Use get_leaderboard to find creator usernames.");
  return getDeveloperProfile(args.username);
}

export { listLocalGenes, listLocalAgents, createLocalAgent, agentRun, compileGene, runGene, initGene, scanGenes, wrapGene, testGene, publishGene, vgScan, doctor } from "./local.js";

export async function mcpStats(args: {
  days?: number;
}): Promise<McpStatsResult> {
  return getMcpStatsCloud(args.days || 7);
}

export async function geneVersions(args: {
  owner: string;
  gene_name: string;
}): Promise<{ versions: GeneVersionEntry[]; count: number }> {
  if (!args.owner || !args.gene_name) throw new Error("owner and gene_name are required. Format: owner='username', gene_name='gene-name'.");
  validateGeneName(args.gene_name);
  const versions = await listGeneVersionsCloud(args.owner, args.gene_name);
  return { versions, count: versions.length };
}

// ── Reputation tools ──

export async function geneReputation(args: {
  gene_id: string;
}): Promise<GeneReputationResult> {
  if (!args.gene_id) throw new Error("gene_id is required. Use search_genes to find gene IDs.");
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
  isLoggedIn: boolean;
  username: string | null;
  provider: string | null;
  expiresInMinutes: number | null;
}

export function authStatus(): AuthStatusResult {
  const creds = loadCredentials();
  if (!creds) {
    return { isLoggedIn: false, username: null, provider: null, expiresInMinutes: null };
  }
  const remaining = Math.max(0, Math.round((creds.expires_at - Date.now()) / 60_000));
  return {
    isLoggedIn: true,
    username: creds.user.username,
    provider: creds.provider,
    expiresInMinutes: remaining,
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
  endpoint?: string;
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
  if (args.endpoint) config.endpoint = args.endpoint;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const { port: callbackPort, waitForCallback } = await startOAuthCallbackServer();

  const authUrl =
    `${config.endpoint}/auth/v1/authorize?provider=${provider}` +
    `&redirect_to=http://localhost:${callbackPort}/callback` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  openBrowser(authUrl);

  try {
    const callbackResult = await waitForCallback;

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

/**
 * Scores this tool used to accept from its caller. It no longer does — but a
 * caller holding an older tool description will still send them, and a bare
 * schema rejection would not tell it why. Named here so the refusal can.
 */
const CALLER_SUPPLIED_SCORES = [
  "fitness_value",
  "safety_score",
  "success_rate",
  "latency_score",
  "resource_efficiency",
] as const;

/**
 * Measure a local Gene and submit the measurement to the Arena.
 *
 * Until now this took five numbers from whoever called it and posted them as
 * fitness. Nothing ran; an assistant could name any score it liked and the
 * leaderboard would carry it (ADR-319 D3). The numbers now come from running
 * the Gene, which is why this takes a `gene_name` and not a `gene_id`: a score
 * can only be produced for a Gene that is here to be run.
 */
export function submitToArena(args: {
  gene_name?: string;
  project_root?: string;
  [key: string]: unknown;
}): ShellResult {
  const declared = CALLER_SUPPLIED_SCORES.filter((f) => args[f] !== undefined);
  if (declared.length > 0) {
    throw new Error(
      `arena_submit no longer accepts scores from the caller (received: ${declared.join(", ")}). ` +
        "A fitness score is a measurement, not a claim: it is now produced by running the Gene in " +
        "the sandbox, and the per-run evidence behind it is published alongside the score so anyone " +
        "can recompute it. Call arena_submit with { gene_name } instead — list_local_genes shows " +
        "what is available locally, install_gene fetches one that is not."
    );
  }

  if (!args.gene_name) {
    if (typeof args.gene_id === "string" && args.gene_id) {
      throw new Error(
        "arena_submit takes gene_name, not gene_id. The score comes from running the Gene, so it can " +
          "only be produced for one that exists locally: run install_gene with that gene_id first, then " +
          "call arena_submit with the name it was installed under."
      );
    }
    throw new Error("gene_name is required. Use list_local_genes to see locally installed Genes.");
  }

  validateGeneName(args.gene_name);
  return arenaSubmit({ gene_name: args.gene_name, project_root: args.project_root });
}

export async function installGeneFromCloud(args: {
  gene_id: string;
  project_root?: string;
  force?: boolean;
}): Promise<InstallResult> {
  if (!args.gene_id) throw new Error("gene_id is required. Use search_genes to find gene IDs.");
  return installGene(args.gene_id, args.project_root || process.cwd(), args.force);
}

/**
 * Undo the last overwrite of a Gene, or say what can be undone.
 *
 * Called without a name this lists what is restorable, because the useful
 * question after an upgrade goes wrong is "what did I replace" and there was
 * previously no way to ask it.
 */
export function rollbackGene(args: {
  gene_name?: string;
  project_root?: string;
}): { restored: RestoreResult | null; available: SnapshotMeta[] } {
  const genesDir = resolveGenesDirFor(args.project_root);
  if (!args.gene_name) {
    return { restored: null, available: listSnapshots(genesDir) };
  }
  const restored = restoreGene(genesDir, args.gene_name);
  return { restored, available: listSnapshots(genesDir) };
}

const resolveGenesDirFor = (hint?: string): string =>
  resolveGenesDir(resolveProjectRoot(hint));

export async function compareGenes(args: {
  gene_ids: string[];
}): Promise<{
  comparison: Array<{
    geneId: string;
    geneName: string;
    domain: string;
    fidelity: string;
    reputationScore: number | null;
    downloads: number;
  }>;
  recommendation: string;
}> {
  if (!args.gene_ids || args.gene_ids.length < 2) {
    throw new Error("At least 2 gene_ids required for comparison. Provide 2-5 gene UUIDs.");
  }
  if (args.gene_ids.length > 5) {
    throw new Error("Maximum 5 genes can be compared at once. Provide 2-5 gene UUIDs.");
  }

  const genes = await Promise.all(args.gene_ids.map((id) => getGene(id)));

  const comparison = genes.map((g) => ({
    geneId: g.id,
    geneName: g.name,
    domain: g.domain,
    fidelity: g.fidelity,
    reputationScore: g.reputationScore,
    downloads: g.downloads,
  }));

  const sorted = [...comparison].sort(
    (a, b) => (b.reputationScore || 0) - (a.reputationScore || 0)
  );
  const best = sorted[0];

  return {
    comparison,
    recommendation: best
      ? `Based on available metrics, "${best.geneName}" has the highest score (${best.reputationScore ?? "N/A"}). Use Arena rankings for authoritative F(g)-based comparison within a domain.`
      : "Insufficient data for recommendation.",
  };
}
