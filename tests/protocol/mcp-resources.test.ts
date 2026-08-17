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

describe("listResourceTemplates", { timeout: 10000 }, () => {
  it("returns exactly 7 resource templates", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.length).toBe(7);
  });

  it("includes all expected URI templates", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const uris = resourceTemplates.map((t) => t.uriTemplate);
    expect(uris).toContain("rotifer://genes/{gene_id}/stats");
    expect(uris).toContain("rotifer://developers/{username}");
    expect(uris).toContain("rotifer://genes/{gene_id}");
    expect(uris).toContain("rotifer://leaderboard");
    expect(uris).toContain("rotifer://local/genes");
    expect(uris).toContain("rotifer://version");
  });

  it("every template has name, description, and mimeType", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    for (const t of resourceTemplates) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.mimeType).toBe("application/json");
    }
  });
});

describe("readResource local resources", { timeout: 10000 }, () => {
  it("rotifer://local/genes returns local inventory", async () => {
    const result = await client.readResource({ uri: "rotifer://local/genes" });
    expect(result.contents.length).toBe(1);
    const data = JSON.parse(result.contents[0].text as string);
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.genes)).toBe(true);
  });

  it("unknown URI throws error", async () => {
    await expect(client.readResource({ uri: "rotifer://nonexistent/path" })).rejects.toThrow();
  });
});

// Resources are the second read surface. A declared tool set that narrowed the
// tools and left these open would still serve gene statistics, creator profiles
// and the leaderboard to a caller that asked for none of them — the same defect
// as the tool list itself had, one request type over.
describe("resources under a declared tool set", { timeout: 10000 }, () => {
  async function withToolSet<T>(declaration: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const previous = process.env.ROTIFER_MCP_TOOLS;
    process.env.ROTIFER_MCP_TOOLS = declaration;
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const c = new Client({ name: "test-client", version: "1.0.0" });
    await c.connect(clientTransport);
    try {
      return await fn(c);
    } finally {
      await c.close();
      await server.close();
      if (previous === undefined) delete process.env.ROTIFER_MCP_TOOLS;
      else process.env.ROTIFER_MCP_TOOLS = previous;
    }
  }

  it("drops the templates whose equivalent tool was not asked for", async () => {
    const uris = await withToolSet("evolve", async (c) =>
      (await c.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate),
    );

    // get_gene_stats, get_developer_profile and get_leaderboard are outside the preset.
    expect(uris).not.toContain("rotifer://genes/{gene_id}/stats");
    expect(uris).not.toContain("rotifer://developers/{username}");
    expect(uris).not.toContain("rotifer://leaderboard");

    // These map to tools the preset does include, and to no tool at all.
    expect(uris).toContain("rotifer://genes/{gene_id}");
    expect(uris).toContain("rotifer://local/genes");
    expect(uris).toContain("rotifer://local/agents");
    expect(uris).toContain("rotifer://version");
  });

  it("refuses to read one even when the caller names the URI directly", async () => {
    const message = await withToolSet("evolve", async (c) => {
      try {
        await c.readResource({ uri: "rotifer://developers/someone" });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(message).toBeTruthy();
    expect(message).toContain("get_developer_profile");
    expect(message).toContain("--tools=");
  });

  it("still serves a resource whose tool is in the set", async () => {
    const result = await withToolSet("evolve", async (c) =>
      c.readResource({ uri: "rotifer://local/genes" }),
    );
    expect(result.contents[0].uri).toBe("rotifer://local/genes");
  });

  it("serves everything when nothing is declared", async () => {
    const previous = process.env.ROTIFER_MCP_TOOLS;
    delete process.env.ROTIFER_MCP_TOOLS;
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.length).toBe(7);
    if (previous !== undefined) process.env.ROTIFER_MCP_TOOLS = previous;
  });
});
