import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadCredentials } from "./auth.js";
import { telemetryOptedOutByEnv } from "./telemetry/consent.js";
import { validateGeneName } from "./validate-gene-name.js";
import { snapshotGene, type SnapshotMeta } from "./snapshots.js";
import type {
  GeneRow,
  SearchGeneRow,
  GeneStatsRpcResult,
  LeaderboardRow,
  ProfileRow,
  DeveloperReputationRow,
  GeneReputationRow,
  GeneVersionRow,
  McpCallLogRow,
  DomainSuggestionRow,
} from "./wire-types.js";

const ROTIFER_HOME = join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  ".rotifer"
);

interface CloudConfig {
  endpoint: string;
  anonKey: string;
}

let _cachedConfig: CloudConfig | null = null;

export function loadCloudConfig(): CloudConfig {
  if (_cachedConfig) return _cachedConfig;

  const configPath = join(ROTIFER_HOME, "cloud.json");
  if (existsSync(configPath)) {
    try {
      const file = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<CloudConfig>;
      _cachedConfig = {
        endpoint: file.endpoint || process.env.ROTIFER_CLOUD_ENDPOINT || "https://cloud.rotifer.dev",
        anonKey: file.anonKey || process.env.ROTIFER_CLOUD_ANON_KEY || "",
      };
      return _cachedConfig;
    } catch {
      // fall through
    }
  }
  _cachedConfig = {
    endpoint: process.env.ROTIFER_CLOUD_ENDPOINT || "https://cloud.rotifer.dev",
    anonKey: process.env.ROTIFER_CLOUD_ANON_KEY || "",
  };
  return _cachedConfig;
}

function apiUrl(path: string): string {
  const config = loadCloudConfig();
  return `${config.endpoint.replace(/\/+$/, "")}/rest/v1${path}`;
}

function rpcUrl(fnName: string): string {
  const config = loadCloudConfig();
  return `${config.endpoint.replace(/\/+$/, "")}/rest/v1/rpc/${fnName}`;
}

function headers(): Record<string, string> {
  const config = loadCloudConfig();
  return {
    "Content-Type": "application/json",
    apikey: config.anonKey,
  };
}

function authHeaders(): Record<string, string> {
  const creds = loadCredentials();
  const h = headers();
  if (creds) {
    h["Authorization"] = `Bearer ${creds.access_token}`;
  }
  return h;
}

function requireAuthHeaders(): Record<string, string> {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error("Authentication required. Run 'rotifer login' in terminal first.");
  }
  const h = headers();
  h["Authorization"] = `Bearer ${creds.access_token}`;
  return h;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    let msg: string;
    try {
      const parsed = JSON.parse(body);
      msg = parsed.message || parsed.error?.message || body;
    } catch {
      msg = body;
    }
    if (res.status === 0 || msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      throw new Error(
        `Cannot reach Rotifer Cloud API (${loadCloudConfig().endpoint}). ` +
        "The service may be temporarily unavailable. Check https://rotifer.dev for status."
      );
    }
    throw new Error(`Cloud API error (${res.status}): ${msg}`);
  }
  return res.json() as Promise<T>;
}

export interface Gene {
  id: string;
  name: string;
  owner: string;
  domain: string;
  version: string;
  fidelity: string;
  description: string;
  wasmSize: number;
  wasmHash?: string | null;
  wasmPath?: string | null;
  downloads: number;
  reputationScore: number | null;
  previousVersionId: string | null;
  changelog: string | null;
  createdAt: string;
  updatedAt: string;
  phenotype?: Record<string, unknown>;
}

export interface GeneListResult {
  genes: Gene[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export async function listGenes(options: {
  domain?: string;
  query?: string;
  fidelity?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<GeneListResult> {
  const limit = Math.max(1, Math.min(options.perPage || 20, 50));
  const page = Math.max(1, options.page || 1);
  const offset = (page - 1) * limit;

  // The search_genes RPC deduplicates versions server-side and returns the
  // exact total_count per row, so pagination is delegated to the server.
  const res = await fetch(rpcUrl("search_genes"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      p_query: options.query || null,
      p_domain: options.domain || null,
      p_fidelity: options.fidelity || null,
      p_sort: options.sort || (options.query ? "relevance" : "newest"),
      p_limit: limit,
      p_offset: offset,
    }),
  });

  const data = await handleResponse<SearchGeneRow[]>(res);

  const genes: Gene[] = data.map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner_username || "unknown",
    domain: row.domain,
    version: row.version,
    fidelity: row.fidelity,
    description: row.description,
    wasmSize: row.wasm_size || 0,
    downloads: row.downloads || 0,
    reputationScore: row.reputation_score ?? null,
    previousVersionId: row.previous_version_id ?? null,
    changelog: row.changelog ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const total = data.length > 0 ? Number(data[0].total_count ?? offset + data.length) : 0;

  return { genes, total, page, per_page: limit, has_more: offset + genes.length < total };
}

function mapGeneRow(row: GeneRow): Gene & { phenotype: Record<string, unknown> } {
  return {
    id: row.id,
    name: row.name,
    owner: row.profiles?.username || "unknown",
    domain: row.domain,
    version: row.version,
    fidelity: row.fidelity,
    description: row.description,
    phenotype: row.phenotype || {},
    wasmSize: row.wasm_size || 0,
    wasmHash: row.wasm_hash ?? null,
    wasmPath: row.wasm_path ?? null,
    downloads: row.downloads || 0,
    reputationScore: row.reputation_score ?? null,
    previousVersionId: row.previous_version_id ?? null,
    changelog: row.changelog ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/i;

export async function getGene(idOrName: string): Promise<Gene & { phenotype: Record<string, unknown> }> {
  if (CONTENT_HASH_RE.test(idOrName)) {
    return getGeneByContentHash(idOrName);
  }

  const params = new URLSearchParams();
  if (UUID_RE.test(idOrName)) {
    params.set("id", `eq.${idOrName}`);
  } else {
    params.set("name", `eq.${idOrName}`);
    params.set("order", "created_at.desc");
    params.set("limit", "1");
  }
  params.set("select", "*, profiles(username)");

  const creds = loadCredentials();
  const h = creds ? authHeaders() : headers();
  if (!creds) {
    params.set("published", "eq.true");
  }

  const res = await fetch(apiUrl(`/genes?${params}`), { headers: h });
  const data = await handleResponse<GeneRow[]>(res);
  if (data.length === 0) throw new Error(`Gene '${idOrName}' not found. Verify the UUID/name or use search_genes to find genes.`);
  const gene = mapGeneRow(data[0]);
  if (!data[0].published && creds && data[0].owner_id !== creds.user?.id) {
    throw new Error(`Gene '${idOrName}' not found. Verify the UUID/name or use search_genes to find genes.`);
  }
  return gene;
}

export async function getGeneByContentHash(hash: string): Promise<Gene & { phenotype: Record<string, unknown> }> {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("content_hash must be a 64-character hex string (SHA-256)");
  }
  const params = new URLSearchParams();
  params.set("content_hash", `eq.${hash}`);
  params.set("select", "*, profiles(username)");
  params.set("order", "created_at.desc");
  params.set("limit", "1");

  const creds = loadCredentials();
  const h = creds ? authHeaders() : headers();
  if (!creds) {
    params.set("published", "eq.true");
  }

  const res = await fetch(apiUrl(`/genes?${params}`), { headers: h });
  const data = await handleResponse<GeneRow[]>(res);
  if (data.length === 0) throw new Error(`Gene with content_hash '${hash}' not found. Verify the hash or use search_genes.`);
  if (!data[0].published && creds && data[0].owner_id !== creds.user?.id) {
    throw new Error(`Gene with content_hash '${hash}' not found. Verify the hash or use search_genes.`);
  }
  return mapGeneRow(data[0]);
}

export interface ArenaEntry {
  /**
   * Null where the row earned no rank. A tier of `not_evaluated` has no order
   * to report, and inventing one — by position in the array, as this tool used
   * to — hands the row back exactly the authority the tier took away.
   */
  rank: number | null;
  /** `verified` | `under_evaluation` | `not_evaluated`. */
  tier: string;
  geneId: string;
  geneName: string;
  geneVersion: string;
  owner: string;
  domain: string;
  fidelity: string;
  fitness: number;
  /** F(g) before the fidelity discount, so the discount is visible rather than baked in. */
  baseFitness: number | null;
  fidelityDiscount: number | null;
  safety: number;
  successRate: number | null;
  latencyScore: number | null;
  resourceEfficiency: number | null;
  /** How the number was arrived at: `sandbox`, `binding_runtime`, `estimated`, ... */
  evaluationMethod: string | null;
  /** Sample size behind the number. */
  evaluationN: number | null;
  uniqueCallers: number;
  /** Why this row was disqualified, when it was. */
  invalidationReason: string | null;
  /** How many versions of this gene sit on the board behind the one shown. */
  versionsOnBoard: number;
  reputationScore: number | null;
  totalCalls: number;
  lastEvaluated: string;
}

export interface ArenaRankingsResult {
  rankings: ArenaEntry[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
  domain: string | null;
}

/** One row of `get_arena_leaderboard`, straight off the wire. */
interface LeaderboardRpcRow {
  tier: string;
  tier_rank: number | null;
  gene_id: string;
  gene_name: string;
  gene_version: string;
  owner_username: string;
  domain: string;
  fidelity: string;
  fitness_value: number;
  base_fitness: number | null;
  fidelity_discount: number | null;
  safety_score: number;
  evaluation_method: string | null;
  evaluation_n: number | null;
  unique_callers: number;
  invalidation_reason: string | null;
  total_calls: number | string;
  last_evaluated: string;
  versions_on_board: number | string;
}

/** The three per-entry dimensions `get_arena_leaderboard` does not carry. */
interface ArenaMetricsRow {
  gene_id: string;
  success_rate: number | null;
  latency_score: number | null;
  resource_efficiency: number | null;
}

/**
 * The per-entry dimensions, fetched for rows the leaderboard already picked.
 *
 * This does select `arena_entries` directly — the pattern the function above
 * exists to stop using — and it is safe here only because the ids come from the
 * leaderboard. It cannot surface a row the leaderboard withheld; it can only
 * decorate one the leaderboard already chose to show. Do not lift this query
 * out and rank what it returns.
 *
 * A failure here costs three optional fields, not the rankings, so it degrades
 * to nulls rather than taking the whole call down with it.
 */
async function fetchArenaMetrics(geneIds: string[]): Promise<Map<string, ArenaMetricsRow>> {
  const byGene = new Map<string, ArenaMetricsRow>();
  if (geneIds.length === 0) return byGene;

  const params = new URLSearchParams();
  params.set("select", "gene_id,success_rate,latency_score,resource_efficiency");
  params.set("gene_id", `in.(${geneIds.join(",")})`);

  try {
    const res = await fetch(apiUrl(`/arena_entries?${params}`), { headers: headers() });
    if (!res.ok) return byGene;
    for (const row of (await res.json()) as ArenaMetricsRow[]) {
      byGene.set(row.gene_id, row);
    }
  } catch {
    // Leave the map empty; the caller fills nulls.
  }
  return byGene;
}

/**
 * Arena rankings for a domain.
 *
 * Goes through `get_arena_leaderboard` rather than selecting `arena_entries`
 * directly. A direct select cannot see any of what makes a ranking mean
 * something: it ranked every row alike, never consulted `invalidated_at`, and
 * showed several versions of one gene as several competitors.
 *
 * That was not theoretical. The CLI and the websites moved to this function
 * when the Arena invalidation criteria shipped; this server did not, and went
 * on serving the disqualified rows. Asked for `sim.particle` it answered with
 * three entries at fitness 1.000 last evaluated five months earlier — every one
 * of them disqualified, because the artifact behind the score is one the
 * runtime refuses to execute. The tool that returned them describes itself as
 * the way to find the best Gene for a capability.
 */
export async function getArenaRankings(options: {
  domain?: string;
  page?: number;
  perPage?: number;
}): Promise<ArenaRankingsResult> {
  const limit = Math.min(options.perPage || 20, 50);
  const offset = ((options.page || 1) - 1) * limit;

  const res = await fetch(rpcUrl("get_arena_leaderboard"), {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json", Prefer: "count=exact" },
    body: JSON.stringify({
      p_domain: options.domain ?? null,
      p_limit: limit,
      p_offset: offset,
    }),
  });

  const total = parseInt(res.headers.get("content-range")?.split("/")[1] || "0", 10);
  const data = await handleResponse<LeaderboardRpcRow[]>(res);
  const metrics = await fetchArenaMetrics(data.map((row) => row.gene_id));

  const rankings: ArenaEntry[] = data.map((row) => {
    const m = metrics.get(row.gene_id);
    return {
      rank: row.tier_rank === null ? null : Number(row.tier_rank),
      tier: row.tier,
      geneId: row.gene_id,
      geneName: row.gene_name,
      geneVersion: row.gene_version,
      owner: row.owner_username,
      domain: row.domain,
      fidelity: row.fidelity,
      fitness: row.fitness_value,
      baseFitness: row.base_fitness,
      fidelityDiscount: row.fidelity_discount,
      safety: row.safety_score,
      successRate: m?.success_rate ?? null,
      latencyScore: m?.latency_score ?? null,
      resourceEfficiency: m?.resource_efficiency ?? null,
      evaluationMethod: row.evaluation_method,
      evaluationN: row.evaluation_n,
      uniqueCallers: Number(row.unique_callers) || 0,
      invalidationReason: row.invalidation_reason,
      versionsOnBoard: Number(row.versions_on_board) || 1,
      reputationScore: null,
      totalCalls: Number(row.total_calls) || 0,
      lastEvaluated: row.last_evaluated,
    };
  });

  const page = options.page || 1;
  return { rankings, total, page, per_page: limit, has_more: offset + limit < total, domain: options.domain || null };
}

// --- Gene Stats ---

export interface GeneStats {
  total: number;
  last7d: number;
  last30d: number;
  last90d: number;
}

export async function getGeneStatsRpc(geneId: string): Promise<GeneStats> {
  const res = await fetch(rpcUrl("get_gene_stats"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_gene_id: geneId }),
  });
  const data = await handleResponse<GeneStatsRpcResult>(res);
  if (data.error) throw new Error(data.error);
  return {
    total: data.total ?? 0,
    last7d: data.last_7d ?? 0,
    last30d: data.last_30d ?? 0,
    last90d: data.last_90d ?? 0,
  };
}

// --- Reputation Leaderboard ---

export interface LeaderboardEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  score: number;
  genesPublished: number;
  totalDownloads: number;
  arenaWins: number;
}

export async function getReputationLeaderboard(
  limit: number = 20
): Promise<LeaderboardEntry[]> {
  const res = await fetch(rpcUrl("get_reputation_leaderboard"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_limit: Math.min(limit, 100) }),
  });
  const data = await handleResponse<LeaderboardRow[]>(res);
  return data.map((row) => ({
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url ?? null,
    score: row.score,
    genesPublished: row.genes_published,
    totalDownloads: Number(row.total_downloads),
    arenaWins: row.arena_wins,
  }));
}

// --- Developer Profile ---

export interface DeveloperProfile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  reputation: {
    score: number;
    genesPublished: number;
    totalDownloads: number;
    arenaWins: number;
  } | null;
}

export async function getDeveloperProfile(
  username: string
): Promise<DeveloperProfile> {
  const params = new URLSearchParams();
  params.set("username", `eq.${username}`);
  params.set(
    "select",
    "id,username,avatar_url,created_at,developer_reputation(score,genes_published,total_downloads,arena_wins)"
  );

  const res = await fetch(apiUrl(`/profiles?${params}`), {
    headers: headers(),
  });
  const data = await handleResponse<ProfileRow[]>(res);
  if (data.length === 0) throw new Error(`Creator '${username}' not found. Use get_leaderboard to find creator usernames.`);

  const row = data[0];
  const rep = Array.isArray(row.developer_reputation)
    ? row.developer_reputation[0]
    : row.developer_reputation;
  return {
    userId: row.id,
    username: row.username,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
    reputation: rep
      ? {
          score: rep.score,
          genesPublished: rep.genes_published,
          totalDownloads: Number(rep.total_downloads),
          arenaWins: rep.arena_wins,
        }
      : null,
  };
}

// ── Version chain ──

export interface GeneVersionEntry {
  id: string;
  version: string;
  changelog: string | null;
  previousVersionId: string | null;
  createdAt: string;
}

export async function listGeneVersions(
  ownerName: string,
  geneName: string
): Promise<GeneVersionEntry[]> {
  const params = new URLSearchParams();
  params.set("name", `eq.${geneName}`);
  params.set("select", "id,version,changelog,previous_version_id,created_at,published,owner_id,profiles(username)");
  params.set("order", "created_at.asc");

  const creds = loadCredentials();
  const h = creds ? authHeaders() : headers();
  if (!creds) {
    params.set("published", "eq.true");
  }

  const res = await fetch(apiUrl(`/genes?${params}`), { headers: h });
  const data = await handleResponse<GeneVersionRow[]>(res);

  const userId = creds?.user?.id;
  return data
    .filter((row) => (row.profiles?.username || "").toLowerCase() === ownerName.toLowerCase())
    .filter((row) => row.published || (userId && row.owner_id === userId))
    .map((row) => ({
      id: row.id,
      version: row.version,
      changelog: row.changelog ?? null,
      previousVersionId: row.previous_version_id ?? null,
      createdAt: row.created_at,
    }));
}

// ── Phase 3: Write operations ──

// The Arena write path used to live here: `arenaSubmitCloud()` took five
// numbers from its caller and POSTed them as fitness. Nothing in that path ran
// a Gene, so any caller could name its own score. It is gone rather than merely
// unused — leaving a working "post arbitrary fitness" function in the tree is
// how the hole gets re-wired by the next change (ADR-319 D3, plan 2.4).
// Submitting now means measuring: `submitToArena()` shells out to the CLI,
// which runs the Gene and publishes the per-run evidence with the score.

// ── Gene Reputation ──

export interface GeneReputationResult {
  geneId: string;
  geneName: string;
  score: number;
  arenaScore: number;
  usageScore: number;
  stabilityScore: number;
  epoch: number;
  computedAt: string;
}

export async function getGeneReputation(geneId: string): Promise<GeneReputationResult> {
  const params = new URLSearchParams();
  params.set("gene_id", `eq.${geneId}`);
  params.set("select", "score,arena_score,usage_score,stability_score,epoch,computed_at,genes(name)");
  params.set("order", "computed_at.desc");
  params.set("limit", "1");

  const res = await fetch(apiUrl(`/gene_reputation?${params}`), { headers: headers() });
  const data = await handleResponse<GeneReputationRow[]>(res);

  if (data.length === 0) {
    const rpcRes = await fetch(rpcUrl("compute_gene_reputation"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_gene_id: geneId }),
    });
    const score = await handleResponse<number>(rpcRes);
    return {
      geneId,
      geneName: geneId,
      score,
      arenaScore: 0,
      usageScore: 0,
      stabilityScore: 0,
      epoch: 1,
      computedAt: new Date().toISOString(),
    };
  }

  const row = data[0];
  return {
    geneId,
    geneName: row.genes?.name || geneId,
    score: row.score,
    arenaScore: row.arena_score,
    usageScore: row.usage_score,
    stabilityScore: row.stability_score,
    epoch: row.epoch,
    computedAt: row.computed_at,
  };
}

// ── Developer Self Reputation ──

export interface MyReputationResult {
  username: string;
  score: number;
  genesPublished: number;
  totalDownloads: number;
  arenaWins: number;
  communityBonus: number;
}

export async function getMyReputation(): Promise<MyReputationResult> {
  const creds = loadCredentials();
  if (!creds) throw new Error("Not logged in. Use the login tool first.");

  const params = new URLSearchParams();
  params.set("user_id", `eq.${creds.user.id}`);

  const res = await fetch(apiUrl(`/developer_reputation?${params}`), {
    headers: requireAuthHeaders(),
  });
  const data = await handleResponse<DeveloperReputationRow[]>(res);

  if (data.length === 0) {
    return {
      username: creds.user.username,
      score: 0,
      genesPublished: 0,
      totalDownloads: 0,
      arenaWins: 0,
      communityBonus: 0,
    };
  }

  const row = data[0];
  return {
    username: creds.user.username,
    score: row.score,
    genesPublished: row.genes_published,
    totalDownloads: Number(row.total_downloads),
    arenaWins: row.arena_wins,
    communityBonus: row.community_bonus ?? 0,
  };
}

// ── Domain Suggestion ──

export interface DomainSuggestion {
  domain: string;
  description: string | null;
  geneCount: number;
}

export async function suggestDomain(description: string): Promise<DomainSuggestion[]> {
  const res = await fetch(rpcUrl("suggest_domain"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_description: description }),
  });
  const data = await handleResponse<DomainSuggestionRow[]>(res);
  return data.map((row) => ({
    domain: row.domain,
    description: row.description ?? null,
    geneCount: row.gene_count,
  }));
}

// ── MCP Call Logging (fire-and-forget) ──

/**
 * Whether this process may report usage.
 *
 * Two rules, in order:
 *
 *   1. `ROTIFER_TELEMETRY=0` (or `false`/`off`) turns it off outright.
 *   2. Otherwise it is on only when someone is signed in.
 *
 * Rule 2 is the one that changed. Reporting used to happen for everybody,
 * including people who had never signed in and so had never been in a position
 * to be told about it — the anon key is enough to write the row. Someone who
 * signs in has an account, a session and somewhere to be told what is
 * collected; someone who only ran `npx` has none of those.
 */
export function telemetryEnabled(caller: string | null): boolean {
  if (telemetryOptedOut()) return false;
  return caller !== null && caller !== "";
}

/**
 * Whether the user has switched reporting off, on its own.
 *
 * Split out from `telemetryEnabled` because not everything this server sends
 * is about a signed-in user: the install counter below carries a Gene id and no
 * identity, so signing in is not what makes it fire. The opt-out still has to
 * cover it. It is documented without qualification — "set this and nothing is
 * reported" — and an opt-out that leaves one request behind is the same defect
 * as no opt-out at all, only harder to notice.
 */
/**
 * Delegates to the shared check (telemetry/consent.js) so this and the
 * anonymous heartbeat (ADR-329) can never drift apart on what "off" means.
 * ADR-329's decision is explicit that ROTIFER_TELEMETRY=0 turns off both.
 */
export function telemetryOptedOut(): boolean {
  return telemetryOptedOutByEnv();
}

export function logMcpCall(entry: {
  tool_name: string;
  gene_id?: string | null;
  success: boolean;
  latency_ms: number;
  caller?: string | null;
}): void {
  const body = {
    tool_name: entry.tool_name,
    gene_id: entry.gene_id || null,
    success: entry.success,
    latency_ms: entry.latency_ms,
    caller: entry.caller || null,
  };

  if (!telemetryEnabled(body.caller)) return;

  fetch(rpcUrl("log_mcp_call"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      p_tool_name: body.tool_name,
      p_gene_id: body.gene_id,
      p_success: body.success,
      p_latency_ms: body.latency_ms,
      p_caller: body.caller,
    }),
  }).catch(() => {});
}

/**
 * Reports still in flight. Emptied as each settles; see flushInvocationReports.
 *
 * Scoped to logGeneInvocation specifically — not logMcpCall, not the
 * heartbeat in telemetry/heartbeat.ts. Those are dispensable ops signals
 * (heartbeat.ts's own file comment: "a dropped heartbeat ... will show up
 * again tomorrow if the machine is still in use"). This one feeds the §33.4
 * anti-manipulation ledger — the CLI's equivalent (recordGeneInvocation in
 * playground's cloud/invocation.ts) already tracks in-flight requests for
 * exactly this reason, and this file did not.
 */
const inFlight = new Set<Promise<void>>();

/**
 * Longest a caller will wait for reports to settle before giving up anyway.
 * Matches playground's cloud/invocation.ts FLUSH_TIMEOUT_MS and the reasoning
 * behind it: 2000ms was the original value here, measured wrong — 10 real
 * requests to cloud.rotifer.dev this same session showed TLS handshake alone
 * ranging ~0.4s–2.0s and total request time up to 2.57s. Starting at the
 * already-corrected figure rather than rediscovering the same mistake.
 */
export const FLUSH_TIMEOUT_MS = 8000;

/**
 * Wait for any in-flight invocation reports to settle, or give up after
 * FLUSH_TIMEOUT_MS. Call this before the process actually exits (see
 * index.ts's SIGINT/SIGTERM handlers) — a long-lived MCP server does not
 * need this (an unawaited open request keeps Node's event loop alive on its
 * own, the same way playground's CLI does when it simply returns), but an
 * explicit kill() bypasses that entirely and was the exact repro: a
 * diagnostic script that called run_gene and killed the process right after
 * getting the response found nothing had been written, silently, with
 * ROTIFER_DEBUG producing no output either — confirmed by hand, 2026-08-30.
 */
export async function flushInvocationReports(timeoutMs: number = FLUSH_TIMEOUT_MS): Promise<void> {
  if (inFlight.size === 0) return;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  await Promise.race([Promise.allSettled([...inFlight]).then(() => undefined), deadline]);
  if (timer) clearTimeout(timer);
}

/**
 * Record a gene invocation for §33.4 anti-manipulation metrics.
 * Fire-and-forget — a failed report never fails the tool call — but tracked
 * in `inFlight` so a caller about to exit can give it a chance to land
 * first, and logged to stderr under ROTIFER_DEBUG rather than swallowed
 * outright: a silently-eaten error is how this exact gap went unnoticed
 * (ADR-322's own history), and this function had no debug output at all
 * where the CLI's equivalent always did.
 *
 * Its caller already only reaches this when signed in, so the opt-out is what
 * this check adds: someone who sets ROTIFER_TELEMETRY=0 means all of it, not
 * just the part they were shown.
 */
export function logGeneInvocation(
  geneId: string,
  callerAgentId: string,
  channel?: string | null,
): void {
  if (!telemetryEnabled(callerAgentId)) return;

  // v2 carries the channel; the original entry point stays for registries that
  // have not applied playground migration 20260830000000 yet. Both share one
  // idempotency guard server-side, so the pair of reports a single `run_gene`
  // still produces (ADR-322 D2 is open) collapses to one row even though the
  // two reports now arrive at different functions.
  const isUseV2 = typeof channel === "string" && channel.length > 0;
  const rpc = isUseV2 ? "log_gene_invocation_v2" : "log_gene_invocation";

  // flushInvocationReports() giving up after FLUSH_TIMEOUT_MS only stops the
  // *caller* from waiting — it does not by itself end this fetch. Without the
  // abort, a stalled endpoint would hang whatever is waiting on the flush for
  // however long the OS's own TCP timeout takes, not just FLUSH_TIMEOUT_MS
  // (same bug, already found and fixed on the CLI side this session — see
  // heartbeat.ts's regression test there for the mechanism).
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  abortTimer.unref?.();

  const settled: Promise<void> = fetch(rpcUrl(rpc), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(
      isUseV2
        ? {
            p_gene_id: geneId,
            p_caller_agent_id: callerAgentId,
            p_client_channel: channel,
          }
        : {
            p_gene_id: geneId,
            p_caller_agent_id: callerAgentId,
          },
    ),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok && process.env.ROTIFER_DEBUG) {
        process.stderr.write(`[rotifer-mcp] ${rpc} failed (${res.status})\n`);
      }
    })
    .catch((err: unknown) => {
      if (process.env.ROTIFER_DEBUG) {
        process.stderr.write(`[rotifer-mcp] ${rpc} error: ${(err as Error)?.message ?? err}\n`);
      }
    })
    .finally(() => {
      clearTimeout(abortTimer);
      inFlight.delete(settled);
    });

  inFlight.add(settled);
}

export interface McpStatsResult {
  period: string;
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  topTools: Array<{ toolName: string; count: number }>;
  topGenes: Array<{ geneId: string; count: number }>;
}

export async function getMcpStats(days: number = 7): Promise<McpStatsResult> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const params = new URLSearchParams();
  params.set("created_at", `gte.${since}`);
  params.set("select", "tool_name,gene_id,success,latency_ms");
  params.set("limit", "10000");

  const res = await fetch(apiUrl(`/mcp_call_log?${params}`), {
    headers: requireAuthHeaders(),
  });
  const data = await handleResponse<McpCallLogRow[]>(res);

  const total = data.length;
  const successCount = data.filter((r) => r.success).length;
  const avgLatency = total > 0
    ? Math.round(data.reduce((s, r) => s + r.latency_ms, 0) / total)
    : 0;

  const toolCounts = new Map<string, number>();
  const geneCounts = new Map<string, number>();
  for (const row of data) {
    toolCounts.set(row.tool_name, (toolCounts.get(row.tool_name) || 0) + 1);
    if (row.gene_id) {
      geneCounts.set(row.gene_id, (geneCounts.get(row.gene_id) || 0) + 1);
    }
  }

  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([toolName, count]) => ({ toolName, count }));

  const topGenes = [...geneCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([geneId, count]) => ({ geneId, count }));

  return {
    period: `${days}d`,
    totalCalls: total,
    successRate: total > 0 ? +(successCount / total).toFixed(4) : 0,
    avgLatencyMs: avgLatency,
    topTools,
    topGenes,
  };
}

export interface InstallResult {
  geneId: string;
  name: string;
  domain: string;
  fidelity: string;
  installedTo: string;
  wasmDownloaded: boolean;
  wasmSize: number | null;
  /** Set when this install overwrote an existing Gene, which is now restorable. */
  snapshot: SnapshotMeta | null;
}

export async function installGene(
  geneId: string,
  projectRoot: string,
  shouldForce?: boolean
): Promise<InstallResult> {
  const gene = await getGene(geneId);
  validateGeneName(gene.name);

  const configPath = join(projectRoot, "rotifer.json");
  let genesDir = "genes";
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      genesDir = config.genes_dir || "genes";
    } catch { /* use default */ }
  }

  const genesRoot = join(projectRoot, genesDir);
  const geneDir = join(genesRoot, gene.name);

  if (existsSync(geneDir) && !shouldForce) {
    throw new Error(`Gene '${gene.name}' already exists at ${geneDir}. Use force=true to overwrite.`);
  }

  // Move the old copy aside before writing over it. This is what makes force
  // reversible; if it cannot be done, the install does not happen, because an
  // overwrite the caller believes is undoable and is not would be worse than
  // no install at all.
  let snapshot: SnapshotMeta | null = null;
  if (existsSync(geneDir) && shouldForce) {
    snapshot = snapshotGene(genesRoot, gene.name, geneId);
  }

  mkdirSync(geneDir, { recursive: true });

  writeFileSync(
    join(geneDir, "phenotype.json"),
    JSON.stringify(gene.phenotype || {}, null, 2) + "\n"
  );

  let didDownloadWasm = false;
  let wasmSize: number | null = null;
  if (gene.wasmPath) {
    const config = loadCloudConfig();
    const wasmUrl = `${config.endpoint.replace(/\/+$/, "")}/storage/v1/object/public/gene-wasm/${gene.wasmPath}`;
    const res = await fetch(wasmUrl);
    if (!res.ok) {
      throw new Error(`Failed to download WASM (${res.status}) from ${wasmUrl}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (gene.wasmSize && bytes.length !== gene.wasmSize) {
      throw new Error(
        `WASM size mismatch: expected ${gene.wasmSize} bytes, got ${bytes.length}. ` +
        "The stored artifact may be corrupted; not installing it."
      );
    }
    if (gene.wasmHash) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== gene.wasmHash) {
        throw new Error(
          `WASM hash mismatch: expected ${gene.wasmHash}, got ${digest}. ` +
          "The stored artifact may be corrupted or tampered with; not installing it."
        );
      }
    }
    writeFileSync(join(geneDir, "gene.ir.wasm"), bytes);
    didDownloadWasm = true;
    wasmSize = bytes.length;
  }

  writeFileSync(
    join(geneDir, ".cloud-manifest.json"),
    JSON.stringify(
      {
        cloud_id: gene.id,
        owner: gene.owner,
        version: gene.version,
        installed_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  // Bump the Gene's public install counter. Unlike the usage records above,
  // this carries no identity — a Gene id and the public anon key — so being
  // signed in is not what turns it on, and it has always fired for everyone.
  // That was never written down, which made "signed out, nothing is reported"
  // false for anyone who installed something. Both halves are fixed: the
  // sentence now says what this is, and the documented opt-out stops it.
  if (!telemetryOptedOut()) {
    try {
      await fetch(rpcUrl("track_download"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ p_gene_id: geneId }),
      });
    } catch { /* non-fatal */ }
  }

  return {
    geneId: gene.id,
    name: gene.name,
    domain: gene.domain,
    fidelity: gene.fidelity,
    installedTo: geneDir,
    wasmDownloaded: didDownloadWasm,
    wasmSize,
    snapshot,
  };
}
