interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

function apiUrl(env: Env, path: string): string {
  return `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1${path}`;
}

function rpcUrl(env: Env, fnName: string): string {
  return `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fnName}`;
}

function headers(env: Env): Record<string, string> {
  return { "Content-Type": "application/json", apikey: env.SUPABASE_ANON_KEY };
}

async function handleApiResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    let msg: string;
    try { msg = JSON.parse(body).message || body; } catch { msg = body; }
    throw new Error(`Cloud API error (${res.status}): ${msg}`);
  }
  return res.json() as Promise<T>;
}

const TOOLS = [
  { name: "search_genes", description: "Search the Rotifer Gene ecosystem. Returns Genes matching the query, filterable by domain and fidelity.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Search query" }, domain: { type: "string", description: "Filter by domain" }, fidelity: { type: "string", description: "Filter: native/wrapped/hybrid" }, sort: { type: "string", description: "Sort: newest/popular/fitness/relevance" }, page: { type: "number", description: "Page (1-indexed)" }, per_page: { type: "number", description: "Results per page (max 50)" } } } },
  { name: "get_gene_detail", description: "Get detailed information about a Gene by ID, name, or content hash.", inputSchema: { type: "object", properties: { gene_id: { type: "string", description: "Gene UUID or name" }, content_hash: { type: "string", description: "64-char SHA-256 hash" } } } },
  { name: "arena_rankings", description: "Get Arena competitive rankings.", inputSchema: { type: "object", properties: { domain: { type: "string" }, page: { type: "number" }, per_page: { type: "number" } } } },
  { name: "gene_stats", description: "Get statistics for a Gene.", inputSchema: { type: "object", properties: { gene_id: { type: "string", description: "Gene UUID" } }, required: ["gene_id"] } },
  { name: "leaderboard", description: "Developer reputation leaderboard.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "developer_profile", description: "Get developer profile.", inputSchema: { type: "object", properties: { username: { type: "string" } }, required: ["username"] } },
  { name: "gene_versions", description: "List Gene version history.", inputSchema: { type: "object", properties: { owner: { type: "string" }, gene_name: { type: "string" } }, required: ["owner", "gene_name"] } },
  { name: "gene_reputation", description: "Gene reputation breakdown.", inputSchema: { type: "object", properties: { gene_id: { type: "string" } }, required: ["gene_id"] } },
  { name: "domain_suggestion", description: "AI domain suggestions for a Gene.", inputSchema: { type: "object", properties: { description: { type: "string" } }, required: ["description"] } },
  { name: "mcp_stats", description: "MCP server usage statistics.", inputSchema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "compare_genes", description: "Compare two Genes side-by-side.", inputSchema: { type: "object", properties: { gene_id_a: { type: "string" }, gene_id_b: { type: "string" } }, required: ["gene_id_a", "gene_id_b"] } },
] as const;

async function callTool(name: string, args: Record<string, any>, env: Env): Promise<string> {
  switch (name) {
    case "search_genes": {
      const limit = Math.min(args.per_page || 20, 50);
      const offset = ((args.page || 1) - 1) * limit;
      const sortAlias: Record<string, string> = { popular: "downloads", fitness: "reputation" };
      const res = await fetch(rpcUrl(env, "search_genes"), {
        method: "POST", headers: headers(env),
        body: JSON.stringify({ p_query: args.query || null, p_domain: args.domain || null, p_fidelity: args.fidelity || null, p_sort: args.sort ? (sortAlias[args.sort] || args.sort) : (args.query ? "relevance" : "newest"), p_limit: limit * 3, p_offset: 0 }),
      });
      const data = await handleApiResponse<any[]>(res);
      const genes = data.map(r => ({ id: r.id, name: r.name, owner: r.owner_username || "unknown", domain: r.domain, version: r.version, fidelity: r.fidelity, description: r.description, downloads: r.downloads || 0 }));
      return JSON.stringify({ genes: genes.slice(offset, offset + limit), total: genes.length, page: args.page || 1 });
    }
    case "get_gene_detail": {
      const params = new URLSearchParams({ select: "*, profiles(username)", published: "eq.true" });
      if (args.content_hash) params.set("content_hash", `eq.${args.content_hash}`);
      else if (args.gene_id) {
        if (/^[0-9a-f]{8}-/.test(args.gene_id)) params.set("id", `eq.${args.gene_id}`);
        else { params.set("name", `eq.${args.gene_id}`); params.set("order", "created_at.desc"); params.set("limit", "1"); }
      } else throw new Error("gene_id or content_hash required");
      const res = await fetch(apiUrl(env, `/genes?${params}`), { headers: headers(env) });
      const data = await handleApiResponse<any[]>(res);
      if (!data.length) throw new Error("Gene not found");
      const r = data[0];
      return JSON.stringify({ id: r.id, name: r.name, owner: r.profiles?.username || "unknown", domain: r.domain, version: r.version, fidelity: r.fidelity, description: r.description, phenotype: r.phenotype || {}, wasmSize: r.wasm_size || 0, downloads: r.downloads || 0, reputation: r.reputation_score, createdAt: r.created_at });
    }
    case "arena_rankings": {
      const limit = Math.min(args.per_page || 20, 50);
      const offset = ((args.page || 1) - 1) * limit;
      const params = new URLSearchParams({ select: "*, genes(name, domain, version, fidelity, profiles(username))", order: "elo_rating.desc", limit: String(limit), offset: String(offset) });
      if (args.domain) params.set("genes.domain", `eq.${args.domain}`);
      const res = await fetch(apiUrl(env, `/arena_entries?${params}`), { headers: headers(env) });
      const data = await handleApiResponse<any[]>(res);
      return JSON.stringify({ rankings: data.map((r, i) => ({ rank: offset + i + 1, geneId: r.gene_id, geneName: r.genes?.name, domain: r.genes?.domain, elo: r.elo_rating, wins: r.wins, losses: r.losses })), page: args.page || 1 });
    }
    case "gene_stats": {
      const res = await fetch(rpcUrl(env, "get_gene_detail"), { method: "POST", headers: headers(env), body: JSON.stringify({ p_gene_id: args.gene_id }) });
      return JSON.stringify(await handleApiResponse(res));
    }
    case "leaderboard": {
      const res = await fetch(rpcUrl(env, "compute_developer_reputation"), { method: "POST", headers: headers(env), body: JSON.stringify({}) });
      const data = await handleApiResponse<any[]>(res);
      return JSON.stringify({ developers: data.slice(0, args.limit || 20).map((r, i) => ({ rank: i + 1, username: r.username, reputation: r.total_reputation, genes: r.gene_count, downloads: r.total_downloads })) });
    }
    case "developer_profile": {
      const res = await fetch(rpcUrl(env, "compute_developer_reputation"), { method: "POST", headers: headers(env), body: JSON.stringify({}) });
      const data = await handleApiResponse<any[]>(res);
      const p = data.find(r => r.username === args.username);
      if (!p) throw new Error(`Developer '${args.username}' not found`);
      return JSON.stringify(p);
    }
    case "gene_versions": {
      const params = new URLSearchParams({ name: `eq.${args.gene_name}`, select: "id,version,created_at,changelog,content_hash,wasm_size,profiles(username)", order: "created_at.desc", published: "eq.true" });
      const res = await fetch(apiUrl(env, `/genes?${params}`), { headers: headers(env) });
      const data = await handleApiResponse<any[]>(res);
      const owned = data.filter(r => r.profiles?.username === args.owner);
      return JSON.stringify({ versions: owned.map(r => ({ id: r.id, version: r.version, createdAt: r.created_at, changelog: r.changelog })), count: owned.length });
    }
    case "gene_reputation": {
      const res = await fetch(rpcUrl(env, "compute_gene_reputation"), { method: "POST", headers: headers(env), body: JSON.stringify({ p_gene_id: args.gene_id }) });
      return JSON.stringify(await handleApiResponse(res));
    }
    case "domain_suggestion": {
      const res = await fetch(rpcUrl(env, "suggest_domain"), { method: "POST", headers: headers(env), body: JSON.stringify({ p_description: args.description }) });
      return JSON.stringify(await handleApiResponse(res));
    }
    case "mcp_stats": {
      const res = await fetch(rpcUrl(env, "get_mcp_stats"), { method: "POST", headers: headers(env), body: JSON.stringify({ p_days: args.days || 7 }) });
      return JSON.stringify(await handleApiResponse(res));
    }
    case "compare_genes": {
      const fetchGene = async (id: string) => {
        const params = new URLSearchParams({ select: "*, profiles(username)", published: "eq.true" });
        if (/^[0-9a-f]{8}-/.test(id)) params.set("id", `eq.${id}`);
        else { params.set("name", `eq.${id}`); params.set("order", "created_at.desc"); params.set("limit", "1"); }
        const res = await fetch(apiUrl(env, `/genes?${params}`), { headers: headers(env) });
        const data = await handleApiResponse<any[]>(res);
        if (!data.length) throw new Error(`Gene '${id}' not found`);
        return data[0];
      };
      const [a, b] = await Promise.all([fetchGene(args.gene_id_a), fetchGene(args.gene_id_b)]);
      return JSON.stringify({ geneA: { id: a.id, name: a.name, owner: a.profiles?.username, domain: a.domain, fidelity: a.fidelity, downloads: a.downloads, reputation: a.reputation_score }, geneB: { id: b.id, name: b.name, owner: b.profiles?.username, domain: b.domain, fidelity: b.fidelity, downloads: b.downloads, reputation: b.reputation_score } });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", transport: "streamable-http", tools: TOOLS.length, version: "0.8.7" }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return new Response(JSON.stringify({ serverInfo: { name: "rotifer", version: "0.8.7" }, tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    if ((url.pathname === "/mcp" || url.pathname === "/") && request.method === "POST") {
      try {
        const body = await request.json() as any;
        const { method, params, id } = body;

        if (method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "rotifer", version: "0.8.7" } } }, { headers: CORS });
        }

        if (method === "tools/list") {
          return Response.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } }, { headers: CORS });
        }

        if (method === "tools/call") {
          const { name, arguments: args } = params;
          try {
            const result = await callTool(name, args || {}, env);
            return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: result }] } }, { headers: CORS });
          } catch (e: any) {
            return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } }, { headers: CORS });
          }
        }

        if (method === "notifications/initialized" || method === "ping") {
          return new Response(null, { status: 202, headers: CORS });
        }

        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }, { headers: CORS });
      } catch (e: any) {
        return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
      }
    }

    return new Response("Rotifer MCP Server. POST /mcp for JSON-RPC.", { status: 404, headers: CORS });
  },
};
