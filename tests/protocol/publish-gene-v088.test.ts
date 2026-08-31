import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

/**
 * publishGene (and runGene, agentRun, etc.) are re-exported from local.js
 * through tools.js and shell out to the real `rotifer` CLI via spawnSync —
 * `which rotifer`, falling back to `npx -y @rotifer/playground` when it
 * isn't on PATH. Nothing here mocked that, so "no args" and "invalid gene
 * name" below were racing a REAL subprocess (spawnSync's own 120s timeout)
 * against this suite's 15s testTimeout — a real network fetch (a cold npx
 * cache, a slow registry, contention from other test files' own real
 * subprocesses running concurrently) had a genuine chance of losing that
 * race, surfacing as a timeout rather than an assertion failure. Confirmed
 * by hand, 2026-08-31: this is the shape of two of this file's reported
 * flaky cases. Mocked the same way tests/integration/call-log-outcome.test.ts
 * already mocks runGene, so every call in this file is now fully in-process.
 */
vi.mock("../../src/local.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/local.js")>("../../src/local.js");
  return {
    ...actual,
    publishGene: vi.fn(() => ({
      success: true,
      exitCode: 0,
      stdout: "mock publish output",
      stderr: "",
    })),
  };
});

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

describe("publish_gene tool — v0.8.8 default behavior + V(g) gate", { timeout: 10000 }, () => {
  it("publish_gene tool exists in tool list", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("publish_gene");
  });

  it("publish_gene description mentions Cloud Registry as default destination", async () => {
    const { tools } = await client.listTools();
    const publishTool = tools.find((t) => t.name === "publish_gene");
    expect(publishTool).toBeDefined();
    expect(publishTool!.description.toLowerCase()).toMatch(/cloud/);
  });

  it("publish_gene inputSchema includes skip_security option", async () => {
    const { tools } = await client.listTools();
    const publishTool = tools.find((t) => t.name === "publish_gene");
    expect(publishTool).toBeDefined();
    const props = publishTool!.inputSchema.properties as Record<string, any>;
    expect(props).toHaveProperty("skip_security");
    expect(props.skip_security.type).toBe("boolean");
  });

  it("publish_gene calling with no args returns content (not crash)", async () => {
    const result = await client.callTool({
      name: "publish_gene",
      arguments: {},
    });
    const text = (result.content as any[])[0]?.text || "";
    expect(text).toBeTruthy();
  });

  it("publish_gene calling with invalid gene name returns error content", async () => {
    const result = await client.callTool({
      name: "publish_gene",
      arguments: { gene_name: "nonexistent-gene-xyz-test" },
    });
    const text = (result.content as any[])[0]?.text || "";
    expect(text).toBeTruthy();
  });

  it("vg_scan tool exists for pre-publish security checks", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("vg_scan");
  });

  it("vg_scan description mentions security scanning", async () => {
    const { tools } = await client.listTools();
    const vgTool = tools.find((t) => t.name === "vg_scan");
    expect(vgTool).toBeDefined();
    expect(vgTool!.description.toLowerCase()).toMatch(/security|scan|v\(g\)|vulnerability/);
  });
});
