import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../../src/open-browser.js", () => ({ openBrowser: vi.fn() }));

vi.mock("../../src/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth.js")>()),
  loadCredentials: vi.fn().mockReturnValue(null),
  startOAuthCallbackServer: vi.fn().mockRejectedValue(new Error("login must not start")),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { startOAuthCallbackServer } from "../../src/auth.js";
import { openBrowser } from "../../src/open-browser.js";
import { loadCloudConfig } from "../../src/cloud.js";

let client: Client;
let cleanup: () => Promise<void>;
let configuredEndpoint: string;

beforeAll(async () => {
  configuredEndpoint = loadCloudConfig().endpoint;
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

beforeEach(() => {
  vi.mocked(startOAuthCallbackServer).mockClear();
  vi.mocked(openBrowser).mockClear();
});

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
}

describe("login over MCP", () => {
  it("does not advertise an endpoint parameter", async () => {
    const { tools } = await client.listTools();
    const login = tools.find((t) => t.name === "login")!;
    expect(Object.keys(login.inputSchema.properties ?? {})).toEqual(["provider"]);
  });

  it("refuses an endpoint argument and says where to set one instead", async () => {
    const result = await client.callTool({ name: "login", arguments: { endpoint: "https://cloud.example" } });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("cloud.json");
    expect(text).toContain("ROTIFER_CLOUD_ENDPOINT");
    expect(text).toContain("login --endpoint");
    expect(startOAuthCallbackServer).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("leaves the process-wide Cloud config cache unchanged", async () => {
    await client.callTool({ name: "login", arguments: { endpoint: "https://cloud.example" } });
    expect(loadCloudConfig().endpoint).toBe(configuredEndpoint);
    expect(loadCloudConfig().endpoint).not.toBe("https://cloud.example");
  });

  it("refuses an endpoint argument even when it is empty", async () => {
    const result = await client.callTool({ name: "login", arguments: { endpoint: "" } });
    expect(result.isError).toBe(true);
    expect(startOAuthCallbackServer).not.toHaveBeenCalled();
  });

  it("refuses a provider outside the declared list at run time", async () => {
    const result = await client.callTool({ name: "login", arguments: { provider: "github&x=1" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("github, gitlab");
    expect(startOAuthCallbackServer).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
