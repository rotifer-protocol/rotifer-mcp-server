import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { searchGenes } from "../../src/tools.js";

const hasCloudKey = !!process.env.ROTIFER_CLOUD_ANON_KEY;
const describeCloud = hasCloudKey ? describe : describe.skip;

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

describeCloud("readResource", { timeout: 15000 }, () => {
  it("rotifer://leaderboard returns JSON content", async () => {
    const result = await client.readResource({ uri: "rotifer://leaderboard" });
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe("application/json");
    const data = JSON.parse(result.contents[0].text as string);
    expect(Array.isArray(data)).toBe(true);
  });

  it("rotifer://local/genes returns local inventory", async () => {
    const result = await client.readResource({ uri: "rotifer://local/genes" });
    expect(result.contents.length).toBe(1);
    const data = JSON.parse(result.contents[0].text as string);
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.genes)).toBe(true);
  });

  it("rotifer://genes/{id} returns gene detail", async () => {
    const search = await searchGenes({ perPage: 1 });
    const geneId = search.genes[0].id;
    const result = await client.readResource({ uri: `rotifer://genes/${geneId}` });
    const data = JSON.parse(result.contents[0].text as string);
    expect(data.id).toBe(geneId);
    expect(data.phenotype).toBeDefined();
  });

  it("rotifer://genes/{id}/stats returns download stats", async () => {
    const search = await searchGenes({ perPage: 1 });
    const geneId = search.genes[0].id;
    const result = await client.readResource({ uri: `rotifer://genes/${geneId}/stats` });
    const data = JSON.parse(result.contents[0].text as string);
    expect(typeof data.total).toBe("number");
    expect(typeof data.last7d).toBe("number");
  });

  it("rotifer://developers/{username} returns profile", async () => {
    const search = await searchGenes({ perPage: 1 });
    const owner = search.genes[0].owner;
    const result = await client.readResource({ uri: `rotifer://developers/${owner}` });
    const data = JSON.parse(result.contents[0].text as string);
    expect(data.username).toBe(owner);
  });

  it("unknown URI throws error", async () => {
    await expect(
      client.readResource({ uri: "rotifer://nonexistent/path" })
    ).rejects.toThrow();
  });
});
