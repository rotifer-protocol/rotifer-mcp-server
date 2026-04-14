import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn((_port: number, callback?: () => void) => callback?.()),
  close: vi.fn(),
  transportClose: vi.fn(),
  transportHandleRequest: vi.fn(),
  serverConnect: vi.fn(),
  serverClose: vi.fn(),
}));

const state = vi.hoisted(() => ({
  capturedHandler: undefined as undefined | ((req: any, res: any) => Promise<void>),
}));

vi.mock("node:http", () => ({
  default: {
    createServer: vi.fn((handler: (req: any, res: any) => Promise<void>) => {
      state.capturedHandler = handler;
      return {
        listen: mocks.listen,
        close: mocks.close,
      };
    }),
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    handleRequest = mocks.transportHandleRequest;

    close = mocks.transportClose;

    constructor(_options: unknown) {}
  },
}));

vi.mock("../../src/server.js", () => ({
  createServer: vi.fn(() => ({
    connect: mocks.serverConnect,
    close: mocks.serverClose,
  })),
}));

import { startHttpServer } from "../../src/http.js";

function createResponse() {
  const closeHandlers: Array<() => void> = [];
  return {
    headersSent: false,
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, callback: () => void) => {
      if (event === "close") {
        closeHandlers.push(callback);
      }
    }),
    emitClose() {
      for (const callback of closeHandlers) {
        callback();
      }
    },
  };
}

beforeEach(() => {
  state.capturedHandler = undefined;
  vi.clearAllMocks();
  vi.spyOn(process, "on").mockImplementation((() => process) as any);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("startHttpServer", () => {
  it("starts the HTTP server on the requested port", async () => {
    await startHttpServer({ port: 3456 });

    expect(mocks.listen).toHaveBeenCalledWith(3456, expect.any(Function));
    expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(process.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("handles CORS preflight requests", async () => {
    await startHttpServer({ port: 3000 });
    const response = createResponse();

    await state.capturedHandler!(
      {
        method: "OPTIONS",
        url: "/mcp",
        headers: { origin: "http://localhost:4321" },
      },
      response,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "http://localhost:4321",
    );
    expect(response.writeHead).toHaveBeenCalledWith(204);
    expect(response.end).toHaveBeenCalled();
  });

  it("serves the health endpoint", async () => {
    await startHttpServer({ port: 3000 });
    const response = createResponse();

    await state.capturedHandler!(
      {
        method: "GET",
        url: "/health",
        headers: { origin: "https://rotifer.dev" },
      },
      response,
    );

    expect(response.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "");
    expect(response.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ status: "ok", transport: "streamable-http" }),
    );
  });

  it("returns 404 for unknown routes", async () => {
    await startHttpServer({ port: 3000 });
    const response = createResponse();

    await state.capturedHandler!(
      {
        method: "GET",
        url: "/unknown",
        headers: { origin: "http://127.0.0.1:8787" },
      },
      response,
    );

    expect(response.writeHead).toHaveBeenCalledWith(404, {
      "Content-Type": "application/json",
    });
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Not found. Use /mcp for MCP endpoint." }),
    );
  });

  it("creates a transport for MCP requests and cleans up on close", async () => {
    mocks.serverConnect.mockResolvedValue(undefined);
    mocks.transportHandleRequest.mockResolvedValue(undefined);

    await startHttpServer({ port: 3000 });
    const response = createResponse();

    await state.capturedHandler!(
      {
        method: "POST",
        url: "/mcp",
        headers: { origin: "http://localhost:3000" },
      },
      response,
    );

    expect(mocks.serverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.transportHandleRequest).toHaveBeenCalledTimes(1);

    response.emitClose();
    expect(mocks.transportClose).toHaveBeenCalledTimes(1);
    expect(mocks.serverClose).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when MCP transport setup fails", async () => {
    mocks.serverConnect.mockRejectedValue(new Error("boom"));

    await startHttpServer({ port: 3000 });
    const response = createResponse();

    await state.capturedHandler!(
      {
        method: "POST",
        url: "/",
        headers: { origin: "http://localhost:3000" },
      },
      response,
    );

    expect(response.writeHead).toHaveBeenCalledWith(500, {
      "Content-Type": "application/json",
    });
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Internal server error" }),
    );
  });
});
