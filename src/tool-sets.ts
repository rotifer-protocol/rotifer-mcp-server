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
 *   ROTIFER_MCP_TOOLS=evolve                       the preset
 *   ROTIFER_MCP_TOOLS=search_genes,get_gene_detail an exact pair
 *   ROTIFER_MCP_TOOLS=evolve,vg_scan               a preset plus one
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
 * Resolve the declared set, or null when every tool is allowed.
 *
 * Unknown names are ignored rather than fatal: a typo should cost you one tool,
 * not the whole server, and a set written for a newer version should still work
 * against an older one.
 */
export function resolveToolSet(declaration = process.env.ROTIFER_MCP_TOOLS): Set<string> | null {
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
    `  • add it:        ROTIFER_MCP_TOOLS="$ROTIFER_MCP_TOOLS,${name}"`,
    "  • or allow all:  unset ROTIFER_MCP_TOOLS",
  ];
  const cli = CLI_EQUIVALENT[name];
  if (cli) {
    lines.push(`  • or run it yourself:  ${cli}`);
  }
  return lines.join("\n");
}
