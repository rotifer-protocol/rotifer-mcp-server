import { describe, it, expect } from "vitest";
import { resolveToolSet, unavailableToolMessage, PRESETS } from "../../src/tool-sets.js";

describe("resolveToolSet", () => {
  it("returns null when nothing is declared, so every tool stays available", () => {
    // This is the compatibility guarantee: an existing user who sets nothing
    // must see exactly what they saw before.
    expect(resolveToolSet(undefined)).toBeNull();
    expect(resolveToolSet("")).toBeNull();
    expect(resolveToolSet("   ")).toBeNull();
  });

  it("expands a preset name", () => {
    const set = resolveToolSet("evolve")!;
    expect(set.has("search_genes")).toBe(true);
    expect(set.has("install_gene")).toBe(true);
    expect(set.has("publish_gene")).toBe(false);
    expect(set.has("login")).toBe(false);
  });

  it("includes rollback_gene in evolve, because that preset may install", () => {
    const set = resolveToolSet("evolve")!;
    expect(set.has("install_gene")).toBe(true);
    expect(set.has("rollback_gene")).toBe(true);
  });

  it("accepts an explicit list", () => {
    const set = resolveToolSet("search_genes, get_gene_detail")!;
    expect([...set].sort()).toEqual(["get_gene_detail", "search_genes"]);
  });

  it("mixes a preset with extra tools", () => {
    const set = resolveToolSet("evolve,vg_scan")!;
    expect(set.has("vg_scan")).toBe(true);
    expect(set.has("search_genes")).toBe(true);
  });

  it("is case-insensitive on preset names but not on tool names", () => {
    expect(resolveToolSet("EVOLVE")!.has("search_genes")).toBe(true);
    expect(resolveToolSet("Search_Genes")!.has("Search_Genes")).toBe(true);
  });

  it("keeps a typo from costing more than the one tool it names", () => {
    const set = resolveToolSet("search_genes,serch_genes")!;
    expect(set.has("search_genes")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("tolerates stray separators", () => {
    expect([...resolveToolSet(",,search_genes,,")!]).toEqual(["search_genes"]);
  });

  it("readonly excludes everything that writes", () => {
    const set = resolveToolSet("readonly")!;
    for (const writer of ["install_gene", "create_agent", "publish_gene", "arena_submit", "wrap_gene", "init_gene"]) {
      expect(set.has(writer), `${writer} should not be in readonly`).toBe(false);
    }
  });

  it("every preset names only real tools", () => {
    // A preset with a typo would silently hand out fewer tools than intended.
    const KNOWN = new Set([
      "search_genes", "get_gene_detail", "get_arena_rankings", "compare_genes", "get_gene_stats",
      "get_leaderboard", "get_developer_profile", "list_local_genes", "list_local_agents",
      "install_gene", "rollback_gene", "arena_submit", "create_agent", "agent_run", "compile_gene",
      "run_gene", "init_gene", "scan_genes", "wrap_gene", "test_gene", "publish_gene", "auth_status",
      "login", "logout", "list_gene_versions", "get_mcp_stats", "get_gene_reputation",
      "get_my_reputation", "suggest_domain", "vg_scan", "doctor",
    ]);
    for (const [name, tools] of Object.entries(PRESETS)) {
      for (const tool of tools) {
        expect(KNOWN.has(tool), `preset '${name}' names unknown tool '${tool}'`).toBe(true);
      }
    }
  });
});

describe("unavailableToolMessage", () => {
  const allowed = new Set(["search_genes", "get_gene_detail"]);

  it("says the restriction is deliberate rather than broken", () => {
    const msg = unavailableToolMessage("publish_gene", allowed);
    expect(msg).toContain("not in this server's declared tool set");
    expect(msg).toContain("This is a restriction, not a missing feature");
  });

  it("lists what is available instead", () => {
    expect(unavailableToolMessage("publish_gene", allowed)).toContain("get_gene_detail, search_genes");
  });

  it("gives two ways to lift the restriction", () => {
    const msg = unavailableToolMessage("publish_gene", allowed);
    expect(msg).toContain('ROTIFER_MCP_TOOLS="$ROTIFER_MCP_TOOLS,publish_gene"');
    expect(msg).toContain("unset ROTIFER_MCP_TOOLS");
  });

  it("points at the CLI when one can do the same job", () => {
    expect(unavailableToolMessage("publish_gene", allowed)).toContain("rotifer publish");
    expect(unavailableToolMessage("compile_gene", allowed)).toContain("rotifer compile");
  });

  it("omits the CLI line for tools with no CLI equivalent", () => {
    const msg = unavailableToolMessage("get_my_reputation", allowed);
    expect(msg).not.toContain("run it yourself");
    // The other two ways out must still be there — a dead end is the failure
    // mode this message exists to avoid.
    expect(msg).toContain("unset ROTIFER_MCP_TOOLS");
  });
});
