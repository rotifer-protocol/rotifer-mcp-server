import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const DEFAULT_PORT = 3000;

export async function startHttpServer(opts?: { port?: number }) {
  const port = opts?.port ?? parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

  const httpServer = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "";
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url?.split("?")[0];

    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "streamable-http" }));
      return;
    }

    if (url === "/mcp" || url === "/") {
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createServer();
        res.on("close", () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("Transport error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use /mcp for MCP endpoint." }));
    }
  });

  httpServer.listen(port, () => {
    console.error(`Rotifer MCP Server (Streamable HTTP) listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.error("Shutting down...");
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
