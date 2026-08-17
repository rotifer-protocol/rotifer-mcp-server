/**
 * Tool sets — let a caller declare which tools it actually needs.
 *
 * This server exposes thirty tools. A Skill that ranks and swaps Genes uses ten
 * of them, but installing that Skill puts `publish_gene`, `login`,
 * `arena_submit` and the rest within reach of whatever assistant loaded it.
 * That gap between "what this needs" and "what this can do" is the finding, and
 * the fix is to let the caller say which it wants.
 *
 * `ROTIFER_MCP_TOOLS` takes a preset name, or a comma-separated list of tool
 * names, or both mixed. Unset means every tool, so nothing changes for anyone
 * who does not opt in:
 *
 *   --tools=evolve                                 the preset
 *   --tools=search_genes,get_gene_detail           an exact pair
 *   ROTIFER_MCP_TOOLS=evolve,vg_scan               a preset plus one
 *
 * Both spellings exist because callers differ in what they can set: a shell
 * user reaches for the variable, while a manifest that launches this server
 * controls argv and nothing else. The flag wins when both are present.
 *
 * A list rather than a fixed profile flag on purpose: rotifer.ai's Web Studio
 * will want a different set than a marketplace Skill, and a Cursor user wants
 * all of them. Presets that turn out to be common can be added here; a caller
 * with an unusual need does not have to wait for one.
 */

/**
 * What the self-evolving-agent Skill's nine `/evolve` commands reach for, plus
 * rollback_gene — an upgrade that can be undone is the point of letting the
 * Skill upgrade at all.
 */
const EVOLVE = [
  "search_genes",
  "get_gene_detail",
  "get_arena_rankings",
  "compare_genes",
  "install_gene",
  "rollback_gene",
  "list_local_genes",
  "list_local_agents",
  "create_agent",
  "agent_run",
] as const;

/** Everything that only reads. Useful for a recommendation-only integration. */
const READONLY = [
  "search_genes",
  "get_gene_detail",
  "get_arena_rankings",
  "compare_genes",
  "get_gene_stats",
  "get_leaderboard",
  "get_developer_profile",
  "get_gene_reputation",
  "list_gene_versions",
  "list_local_genes",
  "list_local_agents",
  "suggest_domain",
  "auth_status",
  "doctor",
] as const;

export const PRESETS: Record<string, readonly string[]> = {
  evolve: EVOLVE,
  readonly: READONLY,
};

/** The CLI command that does the same job, for tools that have one. */
const CLI_EQUIVALENT: Record<string, string> = {
  publish_gene: "rotifer publish",
  compile_gene: "rotifer compile",
  run_gene: "rotifer run",
  test_gene: "rotifer test",
  wrap_gene: "rotifer wrap",
  init_gene: "rotifer init",
  scan_genes: "rotifer scan",
  arena_submit: "rotifer arena submit",
  vg_scan: "rotifer vg",
  login: "rotifer login",
  logout: "rotifer logout",
  install_gene: "rotifer install",
  get_gene_stats: "rotifer stats",
  list_gene_versions: "rotifer versions",
  get_gene_reputation: "rotifer reputation",
  doctor: "rotifer doctor",
};

/**
 * Resources are a second read surface, and a declared tool set has to cover it.
 *
 * Tools are not the only thing this server offers. It also serves resources —
 * `rotifer://genes/{id}/stats`, `rotifer://developers/{name}` and the rest —
 * which return the same data as tools of the same name, through a different
 * request type. Narrowing the tools while leaving those open means a caller
 * that asked for ten things still reaches `get_gene_stats`,
 * `get_developer_profile` and `get_leaderboard` by spelling them as URIs. The
 * declaration would again be narrower than the surface, which is the whole
 * defect this module exists to fix — third time in the same shape, after the
 * tool list itself and the sandbox escape hatches.
 *
 * Each resource is mapped to the tool that does its job, and travels with it.
 * `rotifer://version` maps to nothing: it is the server describing itself, like
 * `tools/list`, and answering "which version am I" is not a capability anyone
 * declares.
 *
 * Prompts are deliberately not gated. A prompt returns text and reaches
 * nothing — no query, no file, no process — so restricting one would remove no
 * authority. If a prompt ever does more than return text, it belongs here.
 */
const RESOURCE_TOOLS: Array<{ template: string; pattern: RegExp; tool: string | null }> = [
  { template: "rotifer://genes/{gene_id}/stats", pattern: /^rotifer:\/\/genes\/[^/]+\/stats$/, tool: "get_gene_stats" },
  { template: "rotifer://developers/{username}", pattern: /^rotifer:\/\/developers\/[^/]+$/, tool: "get_developer_profile" },
  { template: "rotifer://genes/{gene_id}", pattern: /^rotifer:\/\/genes\/[^/]+$/, tool: "get_gene_detail" },
  { template: "rotifer://leaderboard", pattern: /^rotifer:\/\/leaderboard$/, tool: "get_leaderboard" },
  { template: "rotifer://local/genes", pattern: /^rotifer:\/\/local\/genes$/, tool: "list_local_genes" },
  { template: "rotifer://local/agents", pattern: /^rotifer:\/\/local\/agents$/, tool: "list_local_agents" },
  { template: "rotifer://version", pattern: /^rotifer:\/\/version$/, tool: null },
];

/** The tool a concrete resource URI is equivalent to, or null when it needs none. */
export function resourceTool(uri: string): string | null {
  return RESOURCE_TOOLS.find((r) => r.pattern.test(uri))?.tool ?? null;
}

/**
 * Whether a resource may be listed or read under the declared set.
 *
 * An unrecognised URI is allowed through so the handler can answer with its own
 * "unknown resource" error, which says something more useful than this would.
 */
export function resourceAllowed(uri: string, allowed: Set<string> | null): boolean {
  if (!allowed) return true;
  const tool = resourceTool(uri);
  return tool === null || allowed.has(tool);
}

/** Same question for an entry in the template list, which is matched by name. */
export function resourceTemplateAllowed(template: string, allowed: Set<string> | null): boolean {
  if (!allowed) return true;
  const entry = RESOURCE_TOOLS.find((r) => r.template === template);
  return !entry || entry.tool === null || allowed.has(entry.tool);
}

/** Why a resource is unavailable, and how to get it — same shape as a refused tool. */
export function unavailableResourceMessage(uri: string, allowed: Set<string>): string {
  const tool = resourceTool(uri);
  return [
    `Resource '${uri}' is not in this server's declared tool set.`,
    `It returns what '${tool}' returns, and '${tool}' was not asked for.`,
    "",
    "This is a restriction, not a missing feature. To lift it:",
    `  • add it:        --tools=<current set>,${tool}  (or ROTIFER_MCP_TOOLS)`,
    "  • or allow all:  drop --tools / unset ROTIFER_MCP_TOOLS",
    ...(tool && CLI_EQUIVALENT[tool] ? [`  • or run it yourself:  ${CLI_EQUIVALENT[tool]}`] : []),
  ].join("\n");
}

/**
 * Options that switch off a safety property rather than choose a behaviour.
 *
 * Narrowing the tool set is not enough on its own. `agent_run` is in the
 * `evolve` preset because the Skill runs agents, and it takes `no_sandbox` —
 * a plain boolean that drops third-party Gene code out of the WASM sandbox and
 * into plain Node. Ten tools with an escape hatch in one of them is not ten
 * tools. `run_gene` carries the same option plus `trust_unsigned`, which does
 * it specifically for code installed from the marketplace.
 *
 * These are not removed. They are moved from "any caller can set this" to
 * "someone declared this at launch", which is the same rule the tool set
 * follows, and the person at the keyboard can always run the CLI themselves.
 * What changes is that an assistant can no longer decide to unsandbox on its
 * own.
 */
const ESCAPE_HATCHES: Record<string, { flag: string; tools: string[]; cli: string; what: string }> = {
  no_sandbox: {
    flag: "no-sandbox",
    tools: ["agent_run", "run_gene"],
    cli: "rotifer agent run <name> --no-sandbox   (or: rotifer run <gene> --no-sandbox)",
    what: "runs Gene code as plain Node.js instead of inside the WASM sandbox",
  },
  trust_unsigned: {
    flag: "trust-unsigned",
    tools: ["run_gene"],
    cli: "rotifer run <gene> --trust-unsigned",
    what: "allows unsandboxed Node.js execution of Genes installed from the marketplace",
  },
};

/** Escape hatches declared at launch, by option name. */
export function resolveAllowList(
  declaration = allowListFromArgv() ?? process.env.ROTIFER_MCP_ALLOW
): Set<string> {
  const raw = (declaration || "").trim();
  if (!raw) return new Set();

  const byFlag = new Map(Object.entries(ESCAPE_HATCHES).map(([option, spec]) => [spec.flag, option]));
  const allowed = new Set<string>();
  for (const token of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    // Accept either spelling — the flag as written on the command line, or the
    // option name as it appears in the tool schema.
    const option = byFlag.get(token) ?? (token in ESCAPE_HATCHES ? token : null);
    if (option) allowed.add(option);
  }
  return allowed;
}

export function allowListFromArgv(argv: readonly string[] = process.argv.slice(2)): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--allow=")) return arg.slice("--allow=".length);
    if (arg === "--allow") return argv[i + 1];
  }
  return undefined;
}

/**
 * Which declared-off escape hatches a call is trying to use.
 *
 * Only arguments that are actually truthy count: passing `no_sandbox: false`
 * is asking for the safe behaviour and must not be refused.
 */
export function blockedEscapeHatches(
  toolName: string,
  args: Record<string, unknown> | undefined,
  allowed: Set<string>
): string[] {
  if (!args) return [];
  return Object.entries(ESCAPE_HATCHES)
    .filter(([option, spec]) => spec.tools.includes(toolName) && args[option] === true && !allowed.has(option))
    .map(([option]) => option);
}

/** Why an escape hatch is unavailable, and how to get it — same shape as a refused tool. */
export function escapeHatchMessage(options: string[]): string {
  const lines: string[] = [];
  for (const option of options) {
    const spec = ESCAPE_HATCHES[option];
    lines.push(
      `'${option}' is not enabled on this server. It ${spec.what}.`,
      "",
      "This is a restriction, not a missing feature. To enable it:",
      `  • at launch:         --allow=${spec.flag}  (or ROTIFER_MCP_ALLOW=${spec.flag})`,
      `  • or run it yourself: ${spec.cli}`,
      ""
    );
  }
  lines.push("Retry without it to run inside the sandbox.");
  return lines.join("\n");
}

/**
 * Read `--tools=<set>` or `--tools <set>` from a launch command line.
 *
 * The environment variable alone is not enough. Callers that launch this server
 * from a manifest — a ClawHub Skill among them — control the argv and not the
 * environment: ClawHub's schema has an `env` field, but it declares which
 * variables a Skill *requires*, with no way to give one a value. A restriction
 * that the one caller it was built for cannot switch on would be a restriction
 * in name only.
 */
export function toolSetFromArgv(argv: readonly string[] = process.argv.slice(2)): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--tools=")) return arg.slice("--tools=".length);
    if (arg === "--tools") return argv[i + 1];
  }
  return undefined;
}

/**
 * Resolve the declared set, or null when every tool is allowed.
 *
 * The command line wins over the environment: it is the more specific of the
 * two, and it is what a manifest can actually set.
 *
 * Unknown names are ignored rather than fatal: a typo should cost you one tool,
 * not the whole server, and a set written for a newer version should still work
 * against an older one.
 */
export function resolveToolSet(
  declaration = toolSetFromArgv() ?? process.env.ROTIFER_MCP_TOOLS
): Set<string> | null {
  const raw = (declaration || "").trim();
  if (!raw) return null;

  const allowed = new Set<string>();
  for (const token of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    const preset = PRESETS[token.toLowerCase()];
    if (preset) preset.forEach((t) => allowed.add(t));
    else allowed.add(token);
  }
  // An empty or entirely-unrecognised declaration would silently produce a
  // server with no tools, which looks like a broken install. Fall back to all.
  return allowed.size ? allowed : null;
}

/**
 * Why a tool is unavailable, and what to do about it.
 *
 * A bare "not available" reads as "this thing is broken". The set is a
 * deliberate restriction, so the message says so, says how to lift it, and
 * points at the CLI when the CLI can do the job today.
 */
export function unavailableToolMessage(name: string, allowed: Set<string>): string {
  const lines = [
    `Tool '${name}' is not in this server's declared tool set.`,
    `Available here: ${[...allowed].sort().join(", ")}.`,
    "",
    "This is a restriction, not a missing feature. To lift it:",
    `  • add it:        --tools=<current set>,${name}  (or ROTIFER_MCP_TOOLS)`,
    "  • or allow all:  drop --tools / unset ROTIFER_MCP_TOOLS",
  ];
  const cli = CLI_EQUIVALENT[name];
  if (cli) {
    lines.push(`  • or run it yourself:  ${cli}`);
  }
  return lines.join("\n");
}
