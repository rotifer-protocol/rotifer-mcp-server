import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadCredentials } from "./auth.js";
import { validateGeneName } from "./validate-gene-name.js";
import type {
  GeneRow,
  SearchGeneRow,
  ArenaEntryRow,
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

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".");
  const pb = b.replace(/^v/, "").split(".");
  for (let i = 0; i < 3; i++) {
    const na = parseInt(pa[i] || "0", 10);
    const nb = parseInt(pb[i] || "0", 10);
    if (na !== nb) return na - nb;
  }
  const preA = a.includes("-") ? a.split("-").slice(1).join("-") : "";
  const preB = b.includes("-") ? b.split("-").slice(1).join("-") : "";
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  return preA.localeCompare(preB);
}

function deduplicateLatestVersion(genes: Gene[]): Gene[] {
  const map = new Map<string, Gene>();
  for (const g of genes) {
    const key = `${g.owner}\0${g.name}`;
    const existing = map.get(key);
    if (!existing || compareSemver(g.version, existing.version) > 0) {
      map.set(key, g);
    }
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
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

  const fetchLimit = limit * 3;

  const res = await fetch(rpcUrl("search_genes"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      p_query: options.query || null,
      p_domain: options.domain || null,
      p_fidelity: options.fidelity || null,
      p_sort: options.sort || (options.query ? "relevance" : "newest"),
      p_limit: fetchLimit,
      p_offset: 0,
    }),
  });

  const data = await handleResponse<SearchGeneRow[]>(res);

  const allGenes: Gene[] = data.map((row) => ({
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

  const deduped = deduplicateLatestVersion(allGenes);
  const paged = deduped.slice(offset, offset + limit);

  return { genes: paged, total: deduped.length, page, per_page: limit, has_more: offset + limit < deduped.length };
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
  rank: number;
  geneId: string;
  geneName: string;
  owner: string;
  domain: string;
  fidelity: string;
  fitness: number;
  safety: number;
  successRate: number;
  latencyScore: number;
  resourceEfficiency: number;
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

export async function getArenaRankings(options: {
  domain?: string;
  page?: number;
  perPage?: number;
}): Promise<ArenaRankingsResult> {
  const limit = Math.min(options.perPage || 20, 50);
  const offset = ((options.page || 1) - 1) * limit;

  const params = new URLSearchParams();
  params.set(
    "select",
    "gene_id,domain,fitness_value,safety_score,success_rate,latency_score,resource_efficiency,total_calls,last_evaluated,genes(id,name,fidelity,profiles(username))"
  );
  if (options.domain) params.set("domain", `eq.${options.domain}`);
  params.set("order", "fitness_value.desc");
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const res = await fetch(apiUrl(`/arena_entries?${params}`), {
    headers: { ...headers(), Prefer: "count=exact" },
  });

  const total = parseInt(res.headers.get("content-range")?.split("/")[1] || "0", 10);
  const data = await handleResponse<ArenaEntryRow[]>(res);

  const rankings: ArenaEntry[] = data.map((row, i) => ({
    rank: offset + i + 1,
    geneId: row.gene_id,
    geneName: row.genes?.name || "unknown",
    owner: row.genes?.profiles?.username || "unknown",
    domain: row.domain,
    fidelity: row.genes?.fidelity || "Unknown",
    fitness: row.fitness_value,
    safety: row.safety_score,
    successRate: row.success_rate,
    latencyScore: row.latency_score,
    resourceEfficiency: row.resource_efficiency,
    totalCalls: Number(row.total_calls) || 0,
    reputationScore: null,
    lastEvaluated: row.last_evaluated,
  }));

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

export interface ArenaSubmitResult {
  geneId: string;
  domain: string;
  fitnessValue: number;
  safetyScore: number;
  successRate: number;
  latencyScore: number;
  resourceEfficiency: number;
}

export async function arenaSubmitCloud(
  geneId: string,
  fitness: {
    value: number;
    safety_score: number;
    success_rate: number;
    latency_score: number;
    resource_efficiency: number;
  }
): Promise<ArenaSubmitResult> {
  const gene = await getGene(geneId);

  const body = {
    gene_id: geneId,
    domain: gene.domain,
    fitness_value: fitness.value,
    safety_score: fitness.safety_score,
    success_rate: fitness.success_rate,
    latency_score: fitness.latency_score,
    resource_efficiency: fitness.resource_efficiency,
    last_evaluated: new Date().toISOString(),
  };

  const res = await fetch(apiUrl("/arena_entries"), {
    method: "POST",
    headers: {
      ...requireAuthHeaders(),
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  const data = await handleResponse<ArenaEntryRow[]>(res);
  const row = data[0];
  return {
    geneId: row.gene_id,
    domain: row.domain,
    fitnessValue: row.fitness_value,
    safetyScore: row.safety_score,
    successRate: row.success_rate,
    latencyScore: row.latency_score,
    resourceEfficiency: row.resource_efficiency,
  };
}

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

  const geneDir = join(projectRoot, genesDir, gene.name);

  if (existsSync(geneDir) && !shouldForce) {
    throw new Error(`Gene '${gene.name}' already exists at ${geneDir}. Use force=true to overwrite.`);
  }

  mkdirSync(geneDir, { recursive: true });

  writeFileSync(
    join(geneDir, "phenotype.json"),
    JSON.stringify(gene.phenotype || {}, null, 2) + "\n"
  );

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

  // Track download
  try {
    await fetch(rpcUrl("track_download"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_gene_id: geneId }),
    });
  } catch { /* non-fatal */ }

  return {
    geneId: gene.id,
    name: gene.name,
    domain: gene.domain,
    fidelity: gene.fidelity,
    installedTo: geneDir,
  };
}
