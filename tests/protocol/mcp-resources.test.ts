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
