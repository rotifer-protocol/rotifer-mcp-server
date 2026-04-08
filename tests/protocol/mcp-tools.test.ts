import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

let client: Client;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterAll(async () => {
  await cleanup?.();
});

describe("listTools", { timeout: 10000 }, () => {
  it("returns exactly 29 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(29);
  });

  it("includes all expected tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_genes");
    expect(names).toContain("get_gene_detail");
    expect(names).toContain("get_arena_rankings");
    expect(names).toContain("compare_genes");
    expect(names).toContain("get_gene_stats");
    expect(names).toContain("get_leaderboard");
    expect(names).toContain("get_developer_profile");
    expect(names).toContain("list_local_genes");
    expect(names).toContain("list_local_agents");
    expect(names).toContain("install_gene");
    expect(names).toContain("arena_submit");
    expect(names).toContain("create_agent");
    expect(names).toContain("agent_run");
    expect(names).toContain("compile_gene");
    expect(names).toContain("run_gene");
    expect(names).toContain("init_gene");
    expect(names).toContain("scan_genes");
    expect(names).toContain("wrap_gene");
    expect(names).toContain("test_gene");
    expect(names).toContain("publish_gene");
    expect(names).toContain("auth_status");
    expect(names).toContain("login");
    expect(names).toContain("logout");
    expect(names).toContain("get_gene_reputation");
    expect(names).toContain("get_my_reputation");
    expect(names).toContain("suggest_domain");
    expect(names).toContain("vg_scan");
  });

  it("every tool has description and inputSchema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("callTool", { timeout: 15000 }, () => {
  it("search_genes returns valid JSON", async () => {
    const result = await client.callTool({ name: "search_genes", arguments: { per_page: 2 } });
    expect(result.isError).toBeFalsy();
    const content = result.content as any[];
    expect(content[0].type).toBe("text");
    const data = JSON.parse(content[0].text);
    expect(data.genes).toBeDefined();
    expect(data.total).toBeDefined();
  });

  it("get_gene_detail returns gene data", async () => {
    const searchResult = await client.callTool({ name: "search_genes", arguments: { per_page: 1 } });
    const searchData = JSON.parse((searchResult.content as any[])[0].text);
    const geneId = searchData.genes[0].id;

    const result = await client.callTool({ name: "get_gene_detail", arguments: { gene_id: geneId } });
    expect(result.isError).toBeFalsy();
    const gene = JSON.parse((result.content as any[])[0].text);
    expect(gene.id).toBe(geneId);
    expect(gene.phenotype).toBeDefined();
  });

  it("get_arena_rankings returns rankings array", async () => {
    const result = await client.callTool({ name: "get_arena_rankings", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as any[])[0].text);
    expect(Array.isArray(data.rankings)).toBe(true);
  });

  it("get_gene_stats returns time-bucketed stats", async () => {
    const searchResult = await client.callTool({ name: "search_genes", arguments: { per_page: 1 } });
    const geneId = JSON.parse((searchResult.content as any[])[0].text).genes[0].id;

    const result = await client.callTool({ name: "get_gene_stats", arguments: { gene_id: geneId } });
    expect(result.isError).toBeFalsy();
    const stats = JSON.parse((result.content as any[])[0].text);
    expect(typeof stats.total).toBe("number");
    expect(typeof stats.last7d).toBe("number");
  });

  it("get_leaderboard returns developers", async () => {
    const result = await client.callTool({ name: "get_leaderboard", arguments: { limit: 5 } });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as any[])[0].text);
    expect(Array.isArray(data.developers)).toBe(true);
  });

  it("get_developer_profile returns profile data", async () => {
    const searchResult = await client.callTool({ name: "search_genes", arguments: { per_page: 1 } });
    const owner = JSON.parse((searchResult.content as any[])[0].text).genes[0].owner;

    const result = await client.callTool({ name: "get_developer_profile", arguments: { username: owner } });
    expect(result.isError).toBeFalsy();
    const profile = JSON.parse((result.content as any[])[0].text);
    expect(profile.username).toBe(owner);
  });

  it("list_local_genes returns gene inventory", async () => {
    const result = await client.callTool({ name: "list_local_genes", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as any[])[0].text);
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.genes)).toBe(true);
  });

  it("list_local_agents returns agent registry", async () => {
    const result = await client.callTool({ name: "list_local_agents", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as any[])[0].text);
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it("auth_status returns login state", async () => {
    const result = await client.callTool({ name: "auth_status", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as any[])[0].text);
    expect(typeof data.is_logged_in).toBe("boolean");
  });

  it("returns isError for invalid gene detail", async () => {
    const result = await client.callTool({
      name: "get_gene_detail",
      arguments: { gene_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    expect(text).toContain("Error");
  });

  it("vg_scan returns security scan result or CLI error", async () => {
    const result = await client.callTool({ name: "vg_scan", arguments: {} });
    const text = (result.content as any[])[0].text;
    if (result.isError) {
      expect(text).toContain("Error");
    } else {
      const data = JSON.parse(text);
      expect(data.grade).toBeDefined();
      expect(["A", "B", "C", "D", "?"]).toContain(data.grade);
      expect(Array.isArray(data.findings)).toBe(true);
      expect(typeof data.stats.files_scanned).toBe("number");
    }
  });

  it("returns isError for unknown tool", async () => {
    const result = await client.callTool({ name: "nonexistent_tool", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    expect(text).toContain("Unknown tool");
    expect(text).toContain("ListTools");
  });
});
