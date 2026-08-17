import { describe, it, expect } from "vitest";
import {
  resolveToolSet, unavailableToolMessage, toolSetFromArgv, PRESETS,
  resolveAllowList, allowListFromArgv, blockedEscapeHatches, escapeHatchMessage,
} from "../../src/tool-sets.js";

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

  it("gives both ways to lift the restriction, since callers differ in what they can set", () => {
    const msg = unavailableToolMessage("publish_gene", allowed);
    expect(msg).toContain("--tools=");
    expect(msg).toContain("ROTIFER_MCP_TOOLS");
    expect(msg).toContain("drop --tools");
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
    expect(msg).toContain("--tools=");
  });
});

describe("toolSetFromArgv", () => {
  // A ClawHub manifest can set argv and cannot set an environment variable —
  // its `env` field declares which variables a Skill requires, not their
  // values. Without this the restriction would be unreachable from the one
  // caller it was written for.
  it("reads --tools=value", () => {
    expect(toolSetFromArgv(["--tools=evolve"])).toBe("evolve");
  });

  it("reads --tools value", () => {
    expect(toolSetFromArgv(["--tools", "evolve"])).toBe("evolve");
  });

  it("reads a list", () => {
    expect(toolSetFromArgv(["--tools=search_genes,get_gene_detail"])).toBe("search_genes,get_gene_detail");
  });

  it("ignores unrelated arguments", () => {
    expect(toolSetFromArgv(["--serve", "--port", "3000"])).toBeUndefined();
    expect(toolSetFromArgv([])).toBeUndefined();
  });

  it("does not mistake --tools-something for --tools", () => {
    expect(toolSetFromArgv(["--tools-verbose"])).toBeUndefined();
  });

  it("survives --tools with nothing after it", () => {
    expect(toolSetFromArgv(["--tools"])).toBeUndefined();
  });

  it("finds the flag anywhere in the line", () => {
    expect(toolSetFromArgv(["--serve", "--tools=readonly", "--port", "3000"])).toBe("readonly");
  });
});

describe("flag and environment together", () => {
  it("prefers the flag, which is the more specific of the two", () => {
    const previous = process.env.ROTIFER_MCP_TOOLS;
    process.env.ROTIFER_MCP_TOOLS = "readonly";
    try {
      // Simulates resolveToolSet's own default argument.
      const declared = toolSetFromArgv(["--tools=evolve"]) ?? process.env.ROTIFER_MCP_TOOLS;
      expect(resolveToolSet(declared)!.has("install_gene")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ROTIFER_MCP_TOOLS;
      else process.env.ROTIFER_MCP_TOOLS = previous;
    }
  });
});

describe("escape hatches", () => {
  // Narrowing the tool set does not help if a tool inside it can switch off
  // the sandbox. agent_run is in the evolve preset and takes no_sandbox.
  it("blocks no_sandbox on agent_run when nothing was declared", () => {
    expect(blockedEscapeHatches("agent_run", { agent_name: "a", no_sandbox: true }, new Set())).toEqual(["no_sandbox"]);
  });

  it("blocks both hatches on run_gene", () => {
    const blocked = blockedEscapeHatches("run_gene", { no_sandbox: true, trust_unsigned: true }, new Set());
    expect(blocked.sort()).toEqual(["no_sandbox", "trust_unsigned"]);
  });

  it("allows what was declared", () => {
    expect(blockedEscapeHatches("agent_run", { no_sandbox: true }, resolveAllowList("no-sandbox"))).toEqual([]);
  });

  it("accepts the option name as well as the flag spelling", () => {
    expect(resolveAllowList("no_sandbox").has("no_sandbox")).toBe(true);
    expect(resolveAllowList("no-sandbox").has("no_sandbox")).toBe(true);
  });

  it("declaring one hatch does not enable the other", () => {
    const allowed = resolveAllowList("no-sandbox");
    expect(blockedEscapeHatches("run_gene", { trust_unsigned: true }, allowed)).toEqual(["trust_unsigned"]);
  });

  it("does not refuse a call that asks for the safe behaviour", () => {
    // no_sandbox: false is a request to stay sandboxed. Refusing it would be
    // absurd, and an `in args` check rather than a truthiness check would.
    expect(blockedEscapeHatches("agent_run", { no_sandbox: false }, new Set())).toEqual([]);
    expect(blockedEscapeHatches("agent_run", { agent_name: "a" }, new Set())).toEqual([]);
    expect(blockedEscapeHatches("agent_run", undefined, new Set())).toEqual([]);
  });

  it("ignores the option on tools that do not have it", () => {
    expect(blockedEscapeHatches("search_genes", { no_sandbox: true }, new Set())).toEqual([]);
  });

  it("ignores an unknown name in the allow list rather than enabling something", () => {
    expect(resolveAllowList("no-sandbox,nonsense").size).toBe(1);
    expect(resolveAllowList("").size).toBe(0);
  });

  it("explains what the option does, how to enable it, and how to do it yourself", () => {
    const msg = escapeHatchMessage(["no_sandbox"]);
    expect(msg).toContain("instead of inside the WASM sandbox");
    expect(msg).toContain("--allow=no-sandbox");
    expect(msg).toContain("ROTIFER_MCP_ALLOW=no-sandbox");
    expect(msg).toContain("rotifer agent run");
    expect(msg).toContain("Retry without it");
  });

  it("reads --allow from the command line", () => {
    expect(allowListFromArgv(["--allow=no-sandbox"])).toBe("no-sandbox");
    expect(allowListFromArgv(["--allow", "no-sandbox"])).toBe("no-sandbox");
    expect(allowListFromArgv(["--allow-something"])).toBeUndefined();
    expect(allowListFromArgv([])).toBeUndefined();
  });
});

describe("resources travel with their tools", () => {
  it("maps each resource URI to the tool that does its job", async () => {
    const { resourceTool } = await import("../../src/tool-sets.js");

    expect(resourceTool("rotifer://genes/abc/stats")).toBe("get_gene_stats");
    expect(resourceTool("rotifer://genes/abc")).toBe("get_gene_detail");
    expect(resourceTool("rotifer://developers/someone")).toBe("get_developer_profile");
    expect(resourceTool("rotifer://leaderboard")).toBe("get_leaderboard");
    expect(resourceTool("rotifer://local/genes")).toBe("list_local_genes");
  });

  it("maps version to no tool, because describing itself is not a capability", async () => {
    const { resourceTool, resourceAllowed } = await import("../../src/tool-sets.js");

    expect(resourceTool("rotifer://version")).toBeNull();
    expect(resourceAllowed("rotifer://version", new Set(["search_genes"]))).toBe(true);
  });

  it("does not confuse a Gene's detail URI with its stats URI", async () => {
    const { resourceTool } = await import("../../src/tool-sets.js");

    // The detail pattern must not swallow the stats path, or narrowing the set
    // would leave statistics readable under the wrong name.
    expect(resourceTool("rotifer://genes/abc/stats")).not.toBe("get_gene_detail");
  });

  it("allows everything when no set is declared", async () => {
    const { resourceAllowed, resourceTemplateAllowed } = await import("../../src/tool-sets.js");

    expect(resourceAllowed("rotifer://developers/someone", null)).toBe(true);
    expect(resourceTemplateAllowed("rotifer://leaderboard", null)).toBe(true);
  });

  it("lets an unrecognised URI through so the handler can say it is unknown", async () => {
    const { resourceAllowed } = await import("../../src/tool-sets.js");

    expect(resourceAllowed("rotifer://nonsense", new Set(["search_genes"]))).toBe(true);
  });

  it("says which tool a refused resource belongs to, and how to ask for it", async () => {
    const { unavailableResourceMessage } = await import("../../src/tool-sets.js");
    const message = unavailableResourceMessage("rotifer://genes/abc/stats", new Set(["search_genes"]));

    expect(message).toContain("get_gene_stats");
    expect(message).toContain("--tools=");
    expect(message).toContain("rotifer stats");
  });
});
