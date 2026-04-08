import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { searchGenes, getGeneDetail, arenaRankings, compareGenes, geneStats, leaderboard, developerProfile, listLocalGenes, listLocalAgents, submitToArena, installGeneFromCloud, createLocalAgent, agentRun, compileGene, runGene, initGene, scanGenes, wrapGene, testGene, publishGene, authStatus, login, logout, geneVersions, mcpStats, geneReputation, myReputation, domainSuggestion, vgScan } from "./tools.js";
import { getGeneStatsRpc, getReputationLeaderboard, getDeveloperProfile, getGene, logMcpCall } from "./cloud.js";
import { getPackageVersion, getVersionInfo, formatUpdateHint, type VersionInfo } from "./version.js";

const ICON_DATA_URI = "data:image/png;base64,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";

export function createServer(): Server {
  const version = getPackageVersion();
  const server = new Server(
    {
      name: "rotifer",
      version,
      icons: [{ src: ICON_DATA_URI, mimeType: "image/png" }],
    },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  let isVersionWarningShown = false;
  let cachedVersionInfo: VersionInfo | null = null;

  getVersionInfo()
    .then((info) => { cachedVersionInfo = info; })
    .catch(() => {});

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_genes",
        description:
          "Search the Rotifer Gene ecosystem. Returns a list of Genes matching the query, filterable by domain and fidelity.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            query: { type: "string", description: "Free-text search by gene name or description" },
            domain: { type: "string", description: "Filter by capability domain (e.g. search.web, code.format)" },
            fidelity: { type: "string", enum: ["Wrapped", "Hybrid", "Native", "Unknown"], description: "Filter by gene fidelity type" },
            sort: { type: "string", enum: ["relevance", "newest", "popular", "fitness"], description: "Sort order (default: relevance when query is given, newest otherwise)" },
            page: { type: "number", description: "Page number (default 1)" },
            per_page: { type: "number", description: "Results per page (default 20, max 50)" },
          },
        },
      },
      {
        name: "get_gene_detail",
        description:
          "Get detailed information about a specific Gene by its ID or content_hash, including phenotype, fitness, and metadata. At least one of gene_id or content_hash must be provided.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            gene_id: { type: "string", description: "Gene UUID (required if content_hash not provided)" },
            content_hash: { type: "string", description: "SHA-256 content hash of the gene's phenotype (alternative to gene_id)" },
          },
        },
      },
      {
        name: "get_arena_rankings",
        description:
          "Get Arena rankings for a domain with full 5-dimensional fitness metrics: fitness (F(g)), safety, success_rate, latency, and resource_efficiency. Use this to find the best Gene for a capability.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            domain: { type: "string", description: "Capability domain (e.g. search.web)" },
            page: { type: "number", description: "Page number (default 1)" },
            per_page: { type: "number", description: "Results per page (default 20)" },
          },
        },
      },
      {
        name: "compare_genes",
        description:
          "Compare two or more Genes by their F(g) fitness metrics. Returns side-by-side fitness breakdown.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
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
          additionalProperties: false,
          properties: {
            gene_id: { type: "string", description: "Gene UUID" },
          },
          required: ["gene_id"],
        },
      },
      {
        name: "get_leaderboard",
        description:
          "Get the creator reputation leaderboard. Shows top creators ranked by reputation score, including their published gene count, total downloads, and arena wins.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            limit: { type: "number", description: "Number of entries to return (default 20, max 100)" },
          },
        },
      },
      {
        name: "get_developer_profile",
        description:
          "Get a creator's public profile and reputation data by username.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            username: { type: "string", description: "Creator username" },
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
          additionalProperties: false,
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
          additionalProperties: false,
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
          additionalProperties: false,
          properties: {
            gene_id: { type: "string", description: "Gene UUID to install" },
            project_root: { type: "string", description: "Project root path (defaults to cwd)" },
            force: { type: "boolean", description: "Overwrite if gene already exists locally (default: false)" },
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
          additionalProperties: false,
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
          "Create a new Agent by composing one or more local Genes. The Agent is saved to .rotifer/agents/ in the project. Genes must exist locally (wrap them first with wrap_gene).",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            agent_name: { type: "string", description: "Agent name" },
            gene_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "Array of local gene names to compose (at least one required)" },
            composition: { type: "string", enum: ["Seq", "Par", "Cond", "Try", "TryPool"], description: "Composition strategy (default: Seq for multi-gene, Single for one gene)" },
            project_root: { type: "string", description: "Project root path (defaults to cwd)" },
            domain: { type: "string", description: "Domain tag for the agent (e.g. search.web). Metadata only, does not auto-select genes." },
            strategy: { type: "string", description: "Gene selection strategy (default: greedy)" },
            par_merge: { type: "string", enum: ["first", "concat", "merge"], description: "Merge strategy for Par composition (default: first)" },
          },
          required: ["agent_name", "gene_ids"],
        },
      },
      {
        name: "agent_run",
        description:
          "Run a local Agent by name. Executes via the Rotifer CLI (rotifer agent run <agent-name>). The Agent must exist in .rotifer/agents/. Returns stdout/stderr from the execution.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            agent_name: { type: "string", description: "Agent name (as given during create_agent)" },
            project_root: { type: "string", description: "Project root path" },
            input: { type: "string", description: "Input data to pass to the agent (JSON string)" },
            verbose: { type: "boolean", description: "Show intermediate results for each gene step" },
            no_sandbox: { type: "boolean", description: "Force Node.js execution, skip WASM sandbox" },
          },
          required: ["agent_name"],
        },
      },
      {
        name: "compile_gene",
        description:
          "Compile a local Gene to WASM via the Rotifer CLI (rotifer compile). The Gene must exist in the local genes/ directory. Returns compilation output.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            gene_name: { type: "string", description: "Gene name (directory name under genes/)" },
            project_root: { type: "string", description: "Project root path" },
            check: { type: "boolean", description: "Validate only, don't produce artifacts (default: false)" },
            wasm_path: { type: "string", description: "Path to a pre-compiled .wasm file to wrap as IR" },
            lang: { type: "string", enum: ["ts", "wasm"], description: "Force compilation mode (auto-detected by default)" },
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
          additionalProperties: false,
          properties: {
            gene_name: { type: "string", description: "Gene name (directory name under genes/)" },
            project_root: { type: "string", description: "Project root path" },
            input: { type: "string", description: "Input JSON data to pass to the gene" },
            verbose: { type: "boolean", description: "Show detailed execution output (default: false)" },
            no_sandbox: { type: "boolean", description: "Run without WASM sandbox, Node.js only (default: false)" },
            trust_unsigned: { type: "boolean", description: "Allow Node.js execution for Cloud-installed genes (default: false)" },
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
          additionalProperties: false,
          properties: {
            gene_name: { type: "string", description: "Gene name (will create genes/<gene_name>/ directory)" },
            project_root: { type: "string", description: "Project root path" },
            fidelity: { type: "string", enum: ["Wrapped", "Hybrid", "Native"], description: "Gene fidelity type (default: Wrapped)" },
            domain: { type: "string", description: "Default gene domain (default: general)" },
            no_genesis: { type: "boolean", description: "Skip genesis genes installation (default: false)" },
          },
          required: ["gene_name"],
        },
      },
      {
        name: "scan_genes",
        description:
          "Scan source files for candidate gene functions or local SKILL.md files that can be wrapped as Genes. Returns discovered candidates with metadata.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path to scan (defaults to current directory)" },
            project_root: { type: "string", description: "Project root path" },
            skills: { type: "boolean", description: "Scan for SKILL.md files instead of source functions (default: false)" },
            skills_path: { type: "string", description: "Directory to scan for skills (default: .cursor/skills)" },
          },
        },
      },
      {
        name: "wrap_gene",
        description:
          "Wrap a function or SKILL.md as a Rotifer Gene. Generates phenotype.json from the source. The target must exist in the project.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            gene_name: { type: "string", description: "Name of the function or skill to wrap" },
            project_root: { type: "string", description: "Project root path" },
            domain: { type: "string", description: "Gene functional domain (e.g. search.web, code.format)" },
            fidelity: { type: "string", enum: ["Wrapped", "Hybrid", "Native"], description: "Fidelity level (default: Wrapped)" },
            from_skill: { type: "string", description: "Create gene from a SKILL.md file (path to SKILL.md or its directory)" },
            from_clawhub: { type: "string", description: "Create gene from a ClawHub skill (slug, downloads and converts automatically)" },
          },
          required: ["gene_name"],
        },
      },
      {
        name: "test_gene",
        description:
          "Test a Gene in the sandbox. Validates phenotype schema, runs input/output tests, and checks compilation.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            gene_name: { type: "string", description: "Gene name to test" },
            project_root: { type: "string", description: "Project root path" },
            verbose: { type: "boolean", description: "Show detailed output (default: false)" },
            compliance: { type: "boolean", description: "Run structural compliance checks (default: false)" },
          },
          required: ["gene_name"],
        },
      },
      {
        name: "publish_gene",
        description:
          "Publish a Gene to Rotifer Cloud. Requires authentication (use login tool first). Validates, uploads, and optionally submits to Arena. Either gene_name or all=true must be provided.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            gene_name: { type: "string", description: "Gene name to publish (required unless all=true)" },
            project_root: { type: "string", description: "Project root path" },
            all: { type: "boolean", description: "Publish all local genes (default: false)" },
            skip_arena: { type: "boolean", description: "Skip automatic Arena submission after publish (default: false)" },
            description: { type: "string", description: "Gene description" },
            changelog: { type: "string", description: "Changelog entry for this version (max 500 chars)" },
            skip_security: { type: "boolean", description: "Skip pre-publish security checks (default: false)" },
          },
        },
      },
      {
        name: "list_gene_versions",
        description:
          "List the version history chain of a Gene by creator and name. Returns all published versions in chronological order with changelog entries and previous_version_id links.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            owner: { type: "string", description: "Gene creator's username" },
            gene_name: { type: "string", description: "Gene name" },
          },
          required: ["owner", "gene_name"],
        },
      },
      {
        name: "get_mcp_stats",
        description:
          "Get MCP Server call analytics for a given time period. Returns total calls, success rate, average latency, top tools, and top genes. Requires authentication.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
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
          additionalProperties: false,
          properties: {},
        },
      },
      {
        name: "login",
        description:
          "Log in to Rotifer Cloud. Opens the browser for OAuth authorization (GitHub or GitLab). After the user authorizes in the browser, credentials are saved locally. This must be done before using arena_submit or publish_gene.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            provider: { type: "string", enum: ["github", "gitlab"], description: "OAuth provider (default: github)" },
            endpoint: { type: "string", description: "Cloud endpoint URL (uses default if omitted)" },
          },
        },
      },
      {
        name: "logout",
        description:
          "Log out from Rotifer Cloud. Clears locally saved credentials.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {},
        },
      },
      {
        name: "get_gene_reputation",
        description:
          "Get detailed reputation breakdown for a Gene (Arena, Usage, Stability scores).",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            gene_id: { type: "string", description: "Gene ID" },
          },
          required: ["gene_id"],
        },
      },
      {
        name: "get_my_reputation",
        description:
          "Get the current logged-in creator's reputation and stats. Requires authentication.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {},
        },
      },
      {
        name: "suggest_domain",
        description:
          "Suggest top matching domains from the domain registry based on a description.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            description: { type: "string", description: "Description to match against domains" },
          },
          required: ["description"],
        },
      },
      {
        name: "vg_scan",
        description:
          "V(g) security scan — static analysis for Gene/Skill code safety. Returns a grade (A/B/C/D/?) and per-finding details with severity, file, line, and snippet.",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path to Gene or Skill directory to scan (default: current project root)" },
            gene_id: { type: "string", description: "Gene/Skill identifier for the report" },
            all: { type: "boolean", description: "Scan all code files, not just src/" },
            project_root: { type: "string", description: "Project root directory (auto-detected if omitted)" },
          },
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
    return (args.gene_id || args.gene_name || null) as string | null;
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startMs = Date.now();

    function mapPerPage(a: Record<string, unknown>): Record<string, unknown> {
      if ("per_page" in a) {
        const { per_page, ...rest } = a;
        return { ...rest, perPage: per_page };
      }
      return a;
    }

    try {
      let result;
      switch (name) {
        case "search_genes":
          result = await searchGenes(mapPerPage(args as any) as any); break;
        case "get_gene_detail":
          result = await getGeneDetail(args as any); break;
        case "get_arena_rankings":
          result = await arenaRankings(mapPerPage(args as any) as any); break;
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
        case "auth_status": {
          const s = authStatus();
          result = {
            is_logged_in: s.isLoggedIn,
            username: s.username,
            provider: s.provider,
            expires_in_minutes: s.expiresInMinutes,
          };
          break;
        }
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
        case "vg_scan":
          result = vgScan(args as any); break;
        default:
          logMcpCall({ tool_name: name, success: false, latency_ms: Date.now() - startMs });
          return { content: [{ type: "text", text: `Unknown tool: ${name}. Use ListTools to see available tools.` }], isError: true };
      }

      logMcpCall({
        tool_name: name,
        gene_id: extractGeneId(name, (args || {}) as Record<string, unknown>),
        success: true,
        latency_ms: Date.now() - startMs,
      });

      const content: Array<{ type: "text"; text: string }> = [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ];

      if (!isVersionWarningShown && cachedVersionInfo?.updateAvailable) {
        isVersionWarningShown = true;
        content.push({ type: "text", text: formatUpdateHint(cachedVersionInfo) });
      }

      return { content };
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
        name: "Creator Profile",
        description: "A creator's public profile and reputation data",
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
        description: "Top creators ranked by reputation score",
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
      {
        uriTemplate: "rotifer://version",
        name: "Version Info",
        description: "Current and latest version of Rotifer MCP Server, with update availability",
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

    if (uri === "rotifer://version") {
      const info = cachedVersionInfo || await getVersionInfo();
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(info, null, 2) }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}. Valid URI patterns: rotifer://genes/{gene_id}, rotifer://genes/{gene_id}/stats, rotifer://developers/{username}, rotifer://leaderboard, rotifer://local/genes, rotifer://local/agents, rotifer://version`);
  });

  // Prompt templates
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "rotifer-hello",
          description: "Interactive agent creation — choose a template and build an agent in seconds",
          arguments: [
            { name: "template", description: "Template ID (quality-advisor, uiux-diagnosis, content-analysis, code-security, doc-qa, web3-toolkit)", required: false },
            { name: "input", description: "JSON input for the template", required: false },
          ],
        },
        {
          name: "rotifer-guide",
          description: "Understand Rotifer Protocol — core concepts, Gene model, and how agents work",
        },
        {
          name: "rotifer-architect",
          description: "Design an Agent — select genes, choose composition, define pipeline",
          arguments: [
            { name: "task", description: "What the agent should accomplish", required: true },
          ],
        },
        {
          name: "rotifer-challenge",
          description: "Arena evaluation — submit a gene, compare with competitors, understand fitness scoring",
          arguments: [
            { name: "gene", description: "Gene name to evaluate", required: true },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case "rotifer-hello":
        return {
          description: "Interactive agent creation with Rotifer Protocol",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: [
                  "I want to create an agent using Rotifer Protocol.",
                  request.params.arguments?.template ? `Use the ${request.params.arguments.template} template.` : "Help me choose a template.",
                  request.params.arguments?.input ? `Use this input: ${request.params.arguments.input}` : "",
                  "",
                  "Available templates:",
                  "- quality-advisor: Gene library health diagnostic",
                  "- uiux-diagnosis: WCAG + Nielsen heuristic analysis",
                  "- content-analysis: Readability and virality scoring",
                  "- code-security: Vulnerability and credential scanning",
                  "- doc-qa: RAG pipeline with cited answers",
                  "- web3-toolkit: Smart contract audit pipeline",
                  "",
                  "Run `rotifer hello --template <id>` to execute.",
                ].filter(Boolean).join("\n"),
              },
            },
          ],
        };

      case "rotifer-guide":
        return {
          description: "Rotifer Protocol conceptual guide",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: [
                  "Explain Rotifer Protocol to me. Cover:",
                  "",
                  "1. **Gene Model**: Code as Gene — modular, fitness-evaluable logic units",
                  "2. **Three Fidelities**: Native (WASM sandbox), Hybrid (code + network), Wrapped (prompt-only)",
                  "3. **Agent = Genome**: Composition algebra (Seq, Par, Cond, Try, TryPool)",
                  "4. **Fitness Function**: F(g) = (S_r × log(1+C_util) × (1+R_rob)) / (L × R_cost)",
                  "5. **Arena**: Competitive evaluation via arena submit/watch",
                  "",
                  "Keep it practical — show CLI commands for each concept.",
                ].join("\n"),
              },
            },
          ],
        };

      case "rotifer-architect":
        return {
          description: "Design a Rotifer agent",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: [
                  `I want to build an agent that: ${request.params.arguments?.task || "(describe the task)"}`,
                  "",
                  "Help me:",
                  "1. Identify which genes I need (search with `rotifer search <keyword>`)",
                  "2. Choose a composition type (Seq for pipelines, Par for parallel, Try for fallback, TryPool for competitive)",
                  "3. Create the agent (`rotifer agent create <name> --genes <g1> <g2>`)",
                  "4. Test it (`rotifer agent run <name> --input '{...}'`)",
                  "",
                  "If no suitable genes exist, suggest creating a new one with `rotifer wrap <name>`.",
                ].join("\n"),
              },
            },
          ],
        };

      case "rotifer-challenge":
        return {
          description: "Arena evaluation for a gene",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: [
                  `Evaluate gene: ${request.params.arguments?.gene || "(gene name)"}`,
                  "",
                  "Steps:",
                  "1. Run `rotifer arena submit <gene>` to enter the Arena",
                  "2. Run `rotifer arena watch` to see live rankings",
                  "3. Run `rotifer compare <gene-a> <gene-b>` for head-to-head comparison",
                  "",
                  "Fitness is scored by: correctness, utility, robustness, cost efficiency.",
                  "Low-fitness genes get naturally selected out — improve or be replaced.",
                ].join("\n"),
              },
            },
          ],
        };

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });

  return server;
}
