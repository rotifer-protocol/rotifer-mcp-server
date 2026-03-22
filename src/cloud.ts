import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCredentials } from "./auth.js";

const ROTIFER_HOME = join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  ".rotifer"
);

interface CloudConfig {
  endpoint: string;
  anonKey: string;
}

const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaGJtcHVxbGFtaHhibWFoY2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjUxMTQsImV4cCI6MjA4NzQwMTExNH0.t77n7TZ2jV04lya2sWuv4AYAcXnsc49jcfVIJr0heYQ";

let _cachedConfig: CloudConfig | null = null;

export function loadCloudConfig(): CloudConfig {
  if (_cachedConfig) return _cachedConfig;

  const configPath = join(ROTIFER_HOME, "cloud.json");
  if (existsSync(configPath)) {
    try {
      const file = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<CloudConfig>;
      _cachedConfig = {
        endpoint: file.endpoint || process.env.ROTIFER_CLOUD_ENDPOINT || "https://cloud.rotifer.dev",
        anonKey: file.anonKey || process.env.ROTIFER_CLOUD_ANON_KEY || DEFAULT_ANON_KEY,
      };
      return _cachedConfig;
    } catch {
      // fall through
    }
  }
  _cachedConfig = {
    endpoint: process.env.ROTIFER_CLOUD_ENDPOINT || "https://cloud.rotifer.dev",
    anonKey: process.env.ROTIFER_CLOUD_ANON_KEY || DEFAULT_ANON_KEY,
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
  wasm_size: number;
  downloads: number;
  reputation_score: number | null;
  previous_version_id: string | null;
  changelog: string | null;
  created_at: string;
  updated_at: string;
  phenotype?: Record<string, unknown>;
}

export interface GeneListResult {
  genes: Gene[];
  total: number;
  page: number;
  per_page: number;
}

function deduplicateLatestVersion(genes: Gene[]): Gene[] {
  const map = new Map<string, Gene>();
  for (const g of genes) {
    const key = `${g.owner}\0${g.name}`;
    const existing = map.get(key);
    if (!existing || new Date(g.created_at) > new Date(existing.created_at)) {
      map.set(key, g);
    }
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
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

  const data = await handleResponse<any[]>(res);

  const allGenes: Gene[] = data.map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner_username || "unknown",
    domain: row.domain,
    version: row.version,
    fidelity: row.fidelity,
    description: row.description,
    wasm_size: row.wasm_size || 0,
    downloads: row.downloads || 0,
    reputation_score: row.reputation_score ?? null,
    previous_version_id: row.previous_version_id ?? null,
    changelog: row.changelog ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const deduped = deduplicateLatestVersion(allGenes);
  const paged = deduped.slice(offset, offset + limit);

  return { genes: paged, total: deduped.length, page, per_page: limit };
}

export async function getGene(id: string): Promise<Gene & { phenotype: Record<string, unknown> }> {
  const params = new URLSearchParams();
  params.set("id", `eq.${id}`);
  params.set("select", "*, profiles(username)");

  const res = await fetch(apiUrl(`/genes?${params}`), { headers: headers() });
  const data = await handleResponse<any[]>(res);
  if (data.length === 0) throw new Error(`Gene '${id}' not found`);

  const row = data[0];
  return {
    id: row.id,
    name: row.name,
    owner: row.profiles?.username || "unknown",
    domain: row.domain,
    version: row.version,
    fidelity: row.fidelity,
    description: row.description,
    phenotype: row.phenotype || {},
    wasm_size: row.wasm_size || 0,
    downloads: row.downloads || 0,
    reputation_score: row.reputation_score ?? null,
    previous_version_id: row.previous_version_id ?? null,
    changelog: row.changelog ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ArenaEntry {
  rank: number;
  gene_id: string;
  gene_name: string;
  owner: string;
  domain: string;
  fidelity: string;
  fitness: number;
  safety: number;
  success_rate: number;
  latency_score: number;
  resource_efficiency: number;
  reputation_score: number | null;
  total_calls: number;
  last_evaluated: string;
}

export interface ArenaRankingsResult {
  rankings: ArenaEntry[];
  total: number;
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
  const data = await handleResponse<any[]>(res);

  const rankings: ArenaEntry[] = data.map((row, i) => ({
    rank: offset + i + 1,
    gene_id: row.gene_id,
    gene_name: row.genes?.name || "unknown",
    owner: row.genes?.profiles?.username || "unknown",
    domain: row.domain,
    fidelity: row.genes?.fidelity || "Unknown",
    fitness: row.fitness_value,
    safety: row.safety_score,
    success_rate: row.success_rate,
    latency_score: row.latency_score,
    resource_efficiency: row.resource_efficiency,
    total_calls: Number(row.total_calls) || 0,
    reputation_score: null,
    last_evaluated: row.last_evaluated,
  }));

  return { rankings, total, domain: options.domain || null };
}

// --- Gene Stats ---

export interface GeneStats {
  total: number;
  last_7d: number;
  last_30d: number;
  last_90d: number;
}

export async function getGeneStatsRpc(geneId: string): Promise<GeneStats> {
  const res = await fetch(rpcUrl("get_gene_stats"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_gene_id: geneId }),
  });
  const data = await handleResponse<GeneStats & { error?: string }>(res);
  if (data.error) throw new Error(data.error);
  return {
    total: data.total ?? 0,
    last_7d: data.last_7d ?? 0,
    last_30d: data.last_30d ?? 0,
    last_90d: data.last_90d ?? 0,
  };
}

// --- Reputation Leaderboard ---

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar_url: string | null;
  score: number;
  genes_published: number;
  total_downloads: number;
  arena_wins: number;
}

export async function getReputationLeaderboard(
  limit: number = 20
): Promise<LeaderboardEntry[]> {
  const res = await fetch(rpcUrl("get_reputation_leaderboard"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_limit: Math.min(limit, 100) }),
  });
  return handleResponse<LeaderboardEntry[]>(res);
}

// --- Developer Profile ---

export interface DeveloperProfile {
  user_id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  reputation: {
    score: number;
    genes_published: number;
    total_downloads: number;
    arena_wins: number;
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
  const data = await handleResponse<any[]>(res);
  if (data.length === 0) throw new Error(`Developer '${username}' not found`);

  const row = data[0];
  const rep = row.developer_reputation?.[0] || row.developer_reputation;
  return {
    user_id: row.id,
    username: row.username,
    avatar_url: row.avatar_url || null,
    created_at: row.created_at,
    reputation: rep
      ? {
          score: rep.score,
          genes_published: rep.genes_published,
          total_downloads: Number(rep.total_downloads),
          arena_wins: rep.arena_wins,
        }
      : null,
  };
}

// ── Version chain ──

export interface GeneVersionEntry {
  id: string;
  version: string;
  changelog: string | null;
  previous_version_id: string | null;
  created_at: string;
}

export async function listGeneVersions(
  ownerName: string,
  geneName: string
): Promise<GeneVersionEntry[]> {
  const params = new URLSearchParams();
  params.set("name", `eq.${geneName}`);
  params.set("published", "eq.true");
  params.set("select", "id,version,changelog,previous_version_id,created_at,profiles(username)");
  params.set("order", "created_at.asc");

  const res = await fetch(apiUrl(`/genes?${params}`), { headers: headers() });
  const data = await handleResponse<any[]>(res);

  return data
    .filter((row) => (row.profiles?.username || "").toLowerCase() === ownerName.toLowerCase())
    .map((row) => ({
      id: row.id,
      version: row.version,
      changelog: row.changelog ?? null,
      previous_version_id: row.previous_version_id ?? null,
      created_at: row.created_at,
    }));
}

// ── Phase 3: Write operations ──

export interface ArenaSubmitResult {
  gene_id: string;
  domain: string;
  fitness_value: number;
  safety_score: number;
  success_rate: number;
  latency_score: number;
  resource_efficiency: number;
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
    total_calls: 0,
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

  const data = await handleResponse<any[]>(res);
  const row = data[0];
  return {
    gene_id: row.gene_id,
    domain: row.domain,
    fitness_value: row.fitness_value,
    safety_score: row.safety_score,
    success_rate: row.success_rate,
    latency_score: row.latency_score,
    resource_efficiency: row.resource_efficiency,
  };
}

// ── Gene Reputation ──

export interface GeneReputationResult {
  gene_id: string;
  gene_name: string;
  score: number;
  arena_score: number;
  usage_score: number;
  stability_score: number;
  epoch: number;
  computed_at: string;
}

export async function getGeneReputation(geneId: string): Promise<GeneReputationResult> {
  const params = new URLSearchParams();
  params.set("gene_id", `eq.${geneId}`);
  params.set("select", "score,arena_score,usage_score,stability_score,epoch,computed_at,genes(name)");
  params.set("order", "computed_at.desc");
  params.set("limit", "1");

  const res = await fetch(apiUrl(`/gene_reputation?${params}`), { headers: headers() });
  const data = await handleResponse<any[]>(res);

  if (data.length === 0) {
    const rpcRes = await fetch(rpcUrl("compute_gene_reputation"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_gene_id: geneId }),
    });
    const score = await handleResponse<number>(rpcRes);
    return {
      gene_id: geneId,
      gene_name: geneId,
      score,
      arena_score: 0,
      usage_score: 0,
      stability_score: 0,
      epoch: 1,
      computed_at: new Date().toISOString(),
    };
  }

  const row = data[0];
  return {
    gene_id: geneId,
    gene_name: row.genes?.name || geneId,
    score: row.score,
    arena_score: row.arena_score,
    usage_score: row.usage_score,
    stability_score: row.stability_score,
    epoch: row.epoch,
    computed_at: row.computed_at,
  };
}

// ── Developer Self Reputation ──

export interface MyReputationResult {
  username: string;
  score: number;
  genes_published: number;
  total_downloads: number;
  arena_wins: number;
  community_bonus: number;
}

export async function getMyReputation(): Promise<MyReputationResult> {
  const creds = loadCredentials();
  if (!creds) throw new Error("Not logged in. Use the login tool first.");

  const params = new URLSearchParams();
  params.set("user_id", `eq.${creds.user.id}`);

  const res = await fetch(apiUrl(`/developer_reputation?${params}`), {
    headers: requireAuthHeaders(),
  });
  const data = await handleResponse<any[]>(res);

  if (data.length === 0) {
    return {
      username: creds.user.username,
      score: 0,
      genes_published: 0,
      total_downloads: 0,
      arena_wins: 0,
      community_bonus: 0,
    };
  }

  const row = data[0];
  return {
    username: creds.user.username,
    score: row.score,
    genes_published: row.genes_published,
    total_downloads: Number(row.total_downloads),
    arena_wins: row.arena_wins,
    community_bonus: row.community_bonus ?? 0,
  };
}

// ── Domain Suggestion ──

export interface DomainSuggestion {
  domain: string;
  description: string | null;
  gene_count: number;
}

export async function suggestDomain(description: string): Promise<DomainSuggestion[]> {
  const res = await fetch(rpcUrl("suggest_domain"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_description: description }),
  });
  return handleResponse<DomainSuggestion[]>(res);
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
  total_calls: number;
  success_rate: number;
  avg_latency_ms: number;
  top_tools: Array<{ tool_name: string; count: number }>;
  top_genes: Array<{ gene_id: string; count: number }>;
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
  const data = await handleResponse<Array<{
    tool_name: string;
    gene_id: string | null;
    success: boolean;
    latency_ms: number;
  }>>(res);

  const totalCalls = data.length;
  const successCount = data.filter((r) => r.success).length;
  const avgLatency = totalCalls > 0
    ? Math.round(data.reduce((s, r) => s + r.latency_ms, 0) / totalCalls)
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
    .map(([tool_name, count]) => ({ tool_name, count }));

  const topGenes = [...geneCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([gene_id, count]) => ({ gene_id, count }));

  return {
    period: `${days}d`,
    total_calls: totalCalls,
    success_rate: totalCalls > 0 ? +(successCount / totalCalls).toFixed(4) : 0,
    avg_latency_ms: avgLatency,
    top_tools: topTools,
    top_genes: topGenes,
  };
}

export interface InstallResult {
  gene_id: string;
  name: string;
  domain: string;
  fidelity: string;
  installed_to: string;
}

export async function installGene(
  geneId: string,
  projectRoot: string
): Promise<InstallResult> {
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");

  const gene = await getGene(geneId);

  const configPath = join(projectRoot, "rotifer.json");
  let genesDir = "genes";
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      genesDir = config.genes_dir || "genes";
    } catch { /* use default */ }
  }

  const geneDir = join(projectRoot, genesDir, gene.name);
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
    gene_id: gene.id,
    name: gene.name,
    domain: gene.domain,
    fidelity: gene.fidelity,
    installed_to: geneDir,
  };
}
