import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type http from "node:http";

/**
 * `rotifer-mcp serve` over a real socket, not the mocked node:http of
 * tests/unit/http.test.ts: what a client on the network actually gets.
 *
 * GHSA-46jr-4wx8-v453 — one request within the SDK's 4 MiB default body
 * limit could exhaust server memory during validation, and the advisory says
 * upgrading the SDK alone changes nothing. So the bound is set here, and the
 * server listens on loopback unless told otherwise.
 */

let server: http.Server;
let base = "";

beforeAll(async () => {
  // startHttpServer installs SIGINT/SIGTERM handlers that exit the process;
  // keep them out of the test runner.
  vi.spyOn(process, "on").mockImplementation((() => process) as any);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { startHttpServer } = await import("../../src/http.js");
  server = await startHttpServer({ port: 0 });
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  vi.restoreAllMocks();
});

const post = (body: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body,
  });

/** A JSON-RPC initialize request padded to roughly `bytes`. */
function initializeOfSize(bytes: number): string {
  const message = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "limits-test", version: "1.0.0" },
      padding: "",
    },
  };
  message.params.padding = "x".repeat(Math.max(0, bytes - JSON.stringify(message).length));
  return JSON.stringify(message);
}

describe("rotifer-mcp serve over a real socket", () => {
  it("listens on 127.0.0.1 by default", () => {
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("refuses a body over 256 KiB with 413 and a JSON-RPC error, before parsing it", async () => {
    const res = await post(initializeOfSize(300 * 1024));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", error: { code: expect.any(Number) } });
    expect(String(body.error.message)).toMatch(/too large|exceeds|262144|256/i);
  });

  it("still refuses a body that would have passed the SDK's 4 MiB default", async () => {
    const res = await post(initializeOfSize(3 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it("accepts an ordinary request", async () => {
    const res = await post(initializeOfSize(2 * 1024));
    expect(res.status).toBe(200);
  });
});
