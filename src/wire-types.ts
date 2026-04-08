/**
 * Wire types: snake_case DTOs matching PostgREST / Supabase row shapes.
 * Application code should use the camelCase types from cloud.ts.
 * These types exist to make the boundary between database and app explicit.
 */

export interface GeneRow {
  id: string;
  name: string;
  domain: string;
  version: string;
  fidelity: string;
  description: string;
  phenotype: Record<string, unknown> | null;
  wasm_size: number | null;
  wasm_hash: string | null;
  content_hash: string | null;
  downloads: number | null;
  reputation_score: number | null;
  previous_version_id: string | null;
  changelog: string | null;
  published: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
  profiles?: { username: string } | null;
}

export interface SearchGeneRow {
  id: string;
  name: string;
  domain: string;
  version: string;
  fidelity: string;
  description: string;
  wasm_size: number | null;
  downloads: number | null;
  reputation_score: number | null;
  created_at: string;
  updated_at: string;
  owner_username: string | null;
  rank: number;
  previous_version_id?: string | null;
  changelog?: string | null;
}

export interface ArenaEntryRow {
  gene_id: string;
  domain: string;
  fitness_value: number;
  safety_score: number;
  success_rate: number;
  latency_score: number;
  resource_efficiency: number;
  total_calls: number;
  last_evaluated: string;
  genes?: {
    id: string;
    name: string;
    fidelity: string;
    profiles?: { username: string } | null;
  } | null;
}

export interface GeneStatsRpcResult {
  total: number | null;
  last_7d: number | null;
  last_30d: number | null;
  last_90d: number | null;
  error?: string;
}

export interface LeaderboardRow {
  user_id: string;
  username: string;
  avatar_url: string | null;
  score: number;
  genes_published: number;
  total_downloads: number | string;
  arena_wins: number;
}

export interface ProfileRow {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  developer_reputation?: DeveloperReputationRow | DeveloperReputationRow[] | null;
}

export interface DeveloperReputationRow {
  user_id: string;
  score: number;
  genes_published: number;
  total_downloads: number | string;
  arena_wins: number;
  community_bonus?: number;
}

export interface GeneReputationRow {
  gene_id: string;
  score: number;
  arena_score: number;
  usage_score: number;
  stability_score: number;
  epoch: number;
  computed_at: string;
  genes?: { name: string } | null;
}

export interface GeneVersionRow {
  id: string;
  version: string;
  changelog: string | null;
  previous_version_id: string | null;
  created_at: string;
  published?: boolean;
  owner_id?: string;
  profiles?: { username: string } | null;
}

export interface McpCallLogRow {
  tool_name: string;
  gene_id: string | null;
  success: boolean;
  latency_ms: number;
}

export interface DomainSuggestionRow {
  domain: string;
  description: string | null;
  gene_count: number;
}
