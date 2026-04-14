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
