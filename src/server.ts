import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { searchGenes, getGeneDetail, arenaRankings, compareGenes, geneStats, leaderboard, developerProfile, listLocalGenes, listLocalAgents, submitToArena, installGeneFromCloud, createLocalAgent, agentRun, compileGene, runGene, initGene, scanGenes, wrapGene, testGene, publishGene, authStatus, login, logout, geneVersions, mcpStats, geneReputation, myReputation, domainSuggestion } from "./tools.js";
import { getGeneStatsRpc, getReputationLeaderboard, getDeveloperProfile, getGene, logMcpCall } from "./cloud.js";

export function createServer(): Server {
  const server = new Server(
    { name: "rotifer", version: "0.8.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_genes",
        description:
          "Search the Rotifer Gene ecosystem. Returns a list of Genes matching the query, filterable by domain and fidelity.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Free-text search by gene name or description" },
            domain: { type: "string", description: "Filter by capability domain (e.g. search.web, code.format)" },
            fidelity: { type: "string", enum: ["Wrapped", "Hybrid", "Native", "Unknown"], description: "Filter by gene fidelity type" },
            sort: { type: "string", enum: ["relevance", "newest", "reputation", "downloads"], description: "Sort order (default: relevance when query is given, newest otherwise)" },
            page: { type: "number", description: "Page number (default 1)" },
            perPage: { type: "number", description: "Results per page (default 20, max 50)" },
          },
        },
      },
      {
        name: "get_gene_detail",
        description:
          "Get detailed information about a specific Gene by its ID, including phenotype, fitness, and metadata.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "Gene UUID" },
          },
          required: ["id"],
        },
      },
      {
        name: "get_arena_rankings",
        description:
          "Get Arena rankings for a domain with full 5-dimensional fitness metrics: fitness (F(g)), safety, success_rate, latency, and resource_efficiency. Use this to find the best Gene for a capability.",
        inputSchema: {
          type: "object" as const,
          properties: {
            domain: { type: "string", description: "Capability domain (e.g. search.web)" },
            page: { type: "number", description: "Page number (default 1)" },
            perPage: { type: "number", description: "Results per page (default 20)" },
          },
        },
      },
      {
        name: "compare_genes",
        description:
          "Compare two or more Genes by their F(g) fitness metrics. Returns side-by-side fitness breakdown.",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_ids: {
              type: "array",
              items: { type: "string" },
              description: "Array of Gene UUIDs to compare (2-5)",
              minItems: 2,
              maxItems: 5,
            },
          },
          required: ["gene_ids"],
        },
      },
      {
        name: "get_gene_stats",
        description:
          "Get download statistics for a Gene, broken down by time period (total, last 7 days, 30 days, 90 days).",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_id: { type: "string", description: "Gene UUID" },
          },
          required: ["gene_id"],
        },
      },
      {
        name: "get_leaderboard",
        description:
          "Get the developer reputation leaderboard. Shows top developers ranked by reputation score, including their published gene count, total downloads, and arena wins.",
        inputSchema: {
          type: "object" as const,
          properties: {
            limit: { type: "number", description: "Number of entries to return (default 20, max 100)" },
          },
        },
      },
      {
        name: "get_developer_profile",
        description:
          "Get a developer's public profile and reputation data by username.",
        inputSchema: {
          type: "object" as const,
          properties: {
            username: { type: "string", description: "Developer username" },
          },
          required: ["username"],
        },
      },
      {
        name: "list_local_genes",
        description:
          "List Genes installed in the local project workspace. Scans the genes/ directory for phenotype.json files and returns metadata, compile status, and cloud origin for each Gene.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project_root: { type: "string", description: "Project root path (defaults to current working directory)" },
            domain: { type: "string", description: "Filter by domain prefix (e.g. 'search' matches 'search.web')" },
            fidelity: { type: "string", enum: ["Wrapped", "Hybrid", "Native", "Unknown"], description: "Filter by fidelity type" },
          },
        },
      },
      {
        name: "list_local_agents",
        description:
          "List Agents registered in the local project workspace. Returns each Agent's name, state, genome composition, strategy, and reputation. Agents are local constructs that compose multiple Genes into pipelines.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project_root: { type: "string", description: "Project root path (defaults to current working directory)" },
            state: { type: "string", description: "Filter by agent state (e.g. 'Active', 'Inactive')" },
          },
        },
      },
      {
        name: "install_gene",
        description:
          "Install a Gene from the Rotifer Cloud Registry into the local project. Downloads phenotype and metadata. Requires a valid gene_id from search_genes or get_gene_detail.",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_id: { type: "string", description: "Gene UUID to install" },
            project_root: { type: "string", description: "Project root path (defaults to cwd)" },
          },
          required: ["gene_id"],
        },
      },
      {
        name: "arena_submit",
        description:
          "Submit a Gene to the Arena with fitness metrics. Requires authentication (rotifer login). Upserts the Gene's Arena entry with 5-dimensional fitness scores.",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_id: { type: "string", description: "Gene UUID to submit" },
            fitness_value: { type: "number", description: "Overall fitness score F(g) (0-1)" },
            safety_score: { type: "number", description: "Safety score (0-1)" },
            success_rate: { type: "number", description: "Success rate (0-1)" },
            latency_score: { type: "number", description: "Latency score (0-1, higher is better)" },
            resource_efficiency: { type: "number", description: "Resource efficiency score (0-1)" },
          },
          required: ["gene_id", "fitness_value", "safety_score", "success_rate", "latency_score", "resource_efficiency"],
        },
      },
      {
        name: "create_agent",
        description:
          "Create a new Agent by composing one or more local Genes. The Agent is saved to .rotifer/agents/ in the project. Genes must exist locally (wrap them first).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Agent name" },
            genes: { type: "array", items: { type: "string" }, description: "Array of local gene names to compose" },
            composition: { type: "string", enum: ["Seq", "Par", "Try"], description: "Composition strategy (default: Seq for multi-gene, Single for one gene)" },
            project_root: { type: "string", description: "Project root path (defaults to cwd)" },
          },
          required: ["name", "genes"],
        },
      },
      {
        name: "agent_run",
        description:
          "Run a local Agent by its ID. Executes via the Rotifer CLI (rotifer agent run). The Agent must exist in .rotifer/agents/. Returns stdout/stderr from the execution.",
        inputSchema: {
          type: "object" as const,
          properties: {
            agent_id: { type: "string", description: "Agent UUID" },
            project_root: { type: "string", description: "Project root path" },
            input: { type: "string", description: "Input data to pass to the agent" },
          },
          required: ["agent_id"],
        },
      },
      {
        name: "compile_gene",
        description:
          "Compile a local Gene to WASM via the Rotifer CLI (rotifer compile). The Gene must exist in the local genes/ directory. Returns compilation output.",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_name: { type: "string", description: "Gene name (directory name under genes/)" },
            project_root: { type: "string", description: "Project root path" },
          },
          required: ["gene_name"],
        },
      },
      {
        name: "run_gene",
        description:
          "Execute a local Gene via the Rotifer CLI (rotifer run). The Gene must exist in the local genes/ directory. Returns execution output.",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_name: { type: "string", description: "Gene name (directory name under genes/)" },
            project_root: { type: "string", description: "Project root path" },
            input: { type: "string", description: "Input data to pass to the gene" },
          },
          required: ["gene_name"],
        },
      },
      {
        name: "init_gene",
        description:
          "Initialize a new Rotifer Gene project. Creates a directory with phenotype.json template and starter files. Supports Wrapped, Hybrid, and Native fidelity types.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Gene name (will create genes/<name>/ directory)" },
            project_root: { type: "string", description: "Project root path" },
            fidelity: { type: "string", enum: ["Wrapped", "Hybrid", "Native"], description: "Gene fidelity type (default: Wrapped)" },
          },
          required: ["name"],
        },
      },
      {
        name: "scan_genes",
        description:
          "Scan source files for candidate gene functions or local SKILL.md files that can be wrapped as Genes. Returns discovered candidates with metadata.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "Path to scan (defaults to current directory)" },
            project_root: { type: "string", description: "Project root path" },
          },
        },
      },
      {
        name: "wrap_gene",
        description:
          "Wrap a function or SKILL.md as a Rotifer Gene. Generates phenotype.json from the source. The target must exist in the project.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Name of the function or skill to wrap" },
            project_root: { type: "string", description: "Project root path" },
          },
          required: ["name"],
        },
      },
      {
        name: "test_gene",
        description:
          "Test a Gene in the L2 sandbox. Validates phenotype schema, runs input/output tests, and checks compilation. If no name is given, tests all local genes.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Gene name to test (optional, tests all if omitted)" },
            project_root: { type: "string", description: "Project root path" },
          },
        },
      },
      {
        name: "publish_gene",
        description:
          "Publish a Gene to Rotifer Cloud. Requires authentication (use login tool first). Validates, uploads, and optionally submits to Arena. Use --all to publish all local genes.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Gene name to publish (optional if --all)" },
            project_root: { type: "string", description: "Project root path" },
            all: { type: "boolean", description: "Publish all local genes (default: false)" },
            skip_arena: { type: "boolean", description: "Skip automatic Arena submission after publish (default: false)" },
          },
        },
      },
      {
        name: "list_gene_versions",
        description:
          "List the version history chain of a Gene by owner and name. Returns all published versions in chronological order with changelog entries and previous_version_id links.",
        inputSchema: {
          type: "object" as const,
          properties: {
            owner: { type: "string", description: "Gene owner's username" },
            name: { type: "string", description: "Gene name" },
          },
          required: ["owner", "name"],
        },
      },
      {
        name: "get_mcp_stats",
        description:
          "Get MCP Server call analytics for a given time period. Returns total calls, success rate, average latency, top tools, and top genes. Requires authentication.",
        inputSchema: {
          type: "object" as const,
          properties: {
            days: { type: "number", description: "Time window in days (default 7)" },
          },
        },
      },
      {
        name: "auth_status",
        description:
          "Check current authentication status. Returns whether the user is logged in, their username, provider, and how many minutes until the token expires.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "login",
        description:
          "Log in to Rotifer Cloud. Opens the browser for OAuth authorization (GitHub or GitLab). After the user authorizes in the browser, credentials are saved locally. This must be done before using arena_submit or publish_gene.",
        inputSchema: {
          type: "object" as const,
          properties: {
            provider: { type: "string", enum: ["github", "gitlab"], description: "OAuth provider (default: github)" },
          },
        },
      },
      {
        name: "logout",
        description:
          "Log out from Rotifer Cloud. Clears locally saved credentials.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "get_gene_reputation",
        description:
          "Get detailed reputation breakdown for a Gene (Arena, Usage, Stability scores).",
        inputSchema: {
          type: "object" as const,
          properties: {
            gene_id: { type: "string", description: "Gene ID" },
          },
          required: ["gene_id"],
        },
      },
      {
        name: "get_my_reputation",
        description:
          "Get the current logged-in developer's reputation and stats. Requires authentication.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "suggest_domain",
        description:
          "Suggest top matching domains from the domain registry based on a description.",
        inputSchema: {
          type: "object" as const,
          properties: {
            description: { type: "string", description: "Description to match against domains" },
          },
          required: ["description"],
        },
      },
    ],
  }));

  const GENE_ID_TOOLS = new Set([
    "get_gene_detail", "get_gene_stats", "install_gene",
    "arena_submit", "compare_genes", "run_gene", "compile_gene",
    "get_gene_reputation",
  ]);

  function extractGeneId(toolName: string, args: Record<string, unknown>): string | null {
    if (!GENE_ID_TOOLS.has(toolName)) return null;
    return (args.gene_id || args.id || args.gene_name || null) as string | null;
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startMs = Date.now();

    try {
      let result;
      switch (name) {
        case "search_genes":
          result = await searchGenes(args as any); break;
        case "get_gene_detail":
          result = await getGeneDetail(args as any); break;
        case "get_arena_rankings":
          result = await arenaRankings(args as any); break;
        case "compare_genes":
          result = await compareGenes(args as any); break;
        case "get_gene_stats":
          result = await geneStats(args as any); break;
        case "get_leaderboard":
          result = await leaderboard(args as any); break;
        case "get_developer_profile":
          result = await developerProfile(args as any); break;
        case "list_local_genes":
          result = listLocalGenes(args as any); break;
        case "list_local_agents":
          result = listLocalAgents(args as any); break;
        case "install_gene":
          result = await installGeneFromCloud(args as any); break;
        case "arena_submit":
          result = await submitToArena(args as any); break;
        case "create_agent":
          result = createLocalAgent(args as any); break;
        case "agent_run":
          result = agentRun(args as any); break;
        case "compile_gene":
          result = compileGene(args as any); break;
        case "run_gene":
          result = runGene(args as any); break;
        case "init_gene":
          result = initGene(args as any); break;
        case "scan_genes":
          result = scanGenes(args as any); break;
        case "wrap_gene":
          result = wrapGene(args as any); break;
        case "test_gene":
          result = testGene(args as any); break;
        case "publish_gene":
          result = publishGene(args as any); break;
        case "list_gene_versions":
          result = await geneVersions(args as any); break;
        case "get_mcp_stats":
          result = await mcpStats(args as any); break;
        case "auth_status":
          result = authStatus(); break;
        case "login":
          result = await login(args as any); break;
        case "logout":
          result = logout(); break;
        case "get_gene_reputation":
          result = await geneReputation(args as any); break;
        case "get_my_reputation":
          result = await myReputation(); break;
        case "suggest_domain":
          result = await domainSuggestion(args as any); break;
        default:
          logMcpCall({ tool_name: name, success: false, latency_ms: Date.now() - startMs });
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }

      logMcpCall({
        tool_name: name,
        gene_id: extractGeneId(name, (args || {}) as Record<string, unknown>),
        success: true,
        latency_ms: Date.now() - startMs,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logMcpCall({
        tool_name: name,
        gene_id: extractGeneId(name, (args || {}) as Record<string, unknown>),
        success: false,
        latency_ms: Date.now() - startMs,
      });
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: "rotifer://genes/{gene_id}/stats",
        name: "Gene Download Statistics",
        description: "Download statistics for a Gene broken down by time period (total, 7d, 30d, 90d)",
        mimeType: "application/json",
      },
      {
        uriTemplate: "rotifer://developers/{username}",
        name: "Developer Profile",
        description: "A developer's public profile and reputation data",
        mimeType: "application/json",
      },
      {
        uriTemplate: "rotifer://genes/{gene_id}",
        name: "Gene Detail",
        description: "Full metadata and phenotype for a specific Gene",
        mimeType: "application/json",
      },
      {
        uriTemplate: "rotifer://leaderboard",
        name: "Reputation Leaderboard",
        description: "Top developers ranked by reputation score",
        mimeType: "application/json",
      },
      {
        uriTemplate: "rotifer://local/genes",
        name: "Local Gene Inventory",
        description: "All Genes installed in the current project workspace",
        mimeType: "application/json",
      },
      {
        uriTemplate: "rotifer://local/agents",
        name: "Local Agent Registry",
        description: "All Agents registered in the current project workspace",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    const geneStatsMatch = uri.match(/^rotifer:\/\/genes\/([^/]+)\/stats$/);
    if (geneStatsMatch) {
      const data = await getGeneStatsRpc(geneStatsMatch[1]);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    const geneDetailMatch = uri.match(/^rotifer:\/\/genes\/([^/]+)$/);
    if (geneDetailMatch) {
      const data = await getGene(geneDetailMatch[1]);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    const devMatch = uri.match(/^rotifer:\/\/developers\/([^/]+)$/);
    if (devMatch) {
      const data = await getDeveloperProfile(devMatch[1]);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (uri === "rotifer://leaderboard") {
      const data = await getReputationLeaderboard(20);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (uri === "rotifer://local/genes") {
      const data = listLocalGenes({});
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (uri === "rotifer://local/agents") {
      const data = listLocalAgents({});
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });

  return server;
}
