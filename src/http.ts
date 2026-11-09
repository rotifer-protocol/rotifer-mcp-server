import http from "node:http";
import { isIPv6 } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const DEFAULT_PORT = 3000;

/**
 * Loopback unless the operator asks otherwise (`serve --host`). This server
 * has no authentication of its own, and its tools act with the signed-in
 * user's Rotifer account, so it should not be reachable from other machines
 * by default. Before GHSA-46jr was fixed here it listened on every interface.
 */
export const DEFAULT_HOST = "127.0.0.1";

/**
 * MCP requests are small JSON-RPC messages; nothing this server accepts comes
 * near this. The SDK's own default is 4 MiB, and GHSA-46jr-4wx8-v453 is that a
 * single request within that default can exhaust server memory during
 * validation — the advisory is explicit that upgrading the SDK alone changes
 * nothing. A larger body is answered 413 before it is parsed.
 */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Loopback as it appears in a Host or Origin header. Always accepted. */
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/;

const ALLOWED_HOSTS_USAGE =
  "--allowed-hosts takes host names or IP addresses separated by commas, with no scheme, port, path or wildcard, " +
  "for example --allowed-hosts mcp.example.com,192.168.1.20";

function normalizeAllowedHost(entry: string): string {
  const name = entry.trim().toLowerCase();
  if (isIPv6(name)) return `[${name}]`;
  if (name.startsWith("[") && name.endsWith("]") && isIPv6(name.slice(1, -1))) return name;
  if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) return name;
  throw new Error(ALLOWED_HOSTS_USAGE);
}

/**
 * The names `serve` accepts besides loopback. Listening beyond this machine
 * without naming them is refused, because the server has no authentication and
 * would otherwise answer whatever name a client used to reach it.
 */
export function resolveAllowedHosts(host: string | undefined, allowedHosts: string | undefined): string[] {
  if (allowedHosts === undefined) {
    if (host !== undefined && !LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `--host ${host} also needs --allowed-hosts, naming the addresses clients will use to reach this server, ` +
          "for example --allowed-hosts mcp.example.com,192.168.1.20",
      );
    }
    return [];
  }
  return allowedHosts.split(",").map(normalizeAllowedHost);
}

function originAllowed(origin: string, allowed: ReadonlySet<string>): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && allowed.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Why an MCP request must be refused, or null to serve it. A web page can make
 * a browser reach this server under the page's own name by re-pointing that
 * name at 127.0.0.1 (DNS rebinding), so the listening address alone protects
 * nothing: the name the client used has to be one this server was told about.
 * Clients that are not browsers send no Origin, so only Host applies to them.
 */
export function refuseRequest(headers: http.IncomingHttpHeaders, allowed: ReadonlySet<string>): string | null {
  const hostname = HOST_HEADER.exec((headers.host ?? "").toLowerCase())?.[1];
  if (!hostname || !allowed.has(hostname)) {
    return "This server does not accept requests addressed to that Host. To reach it under another name, restart it with: rotifer-mcp-server serve --allowed-hosts <name>";
  }
  if (headers.origin !== undefined && !originAllowed(headers.origin, allowed)) {
    return "This server does not accept requests from that Origin. To allow a site, restart the server with: rotifer-mcp-server serve --allowed-hosts <name>";
  }
  return null;
}

export async function startHttpServer(opts?: { port?: number; host?: string; allowedHosts?: string[] }): Promise<http.Server> {
  const port = opts?.port ?? parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const host = opts?.host ?? DEFAULT_HOST;
  const allowed = new Set([...LOOPBACK_HOSTNAMES, ...(opts?.allowedHosts ?? [])]);

  const httpServer = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const allowedOrigin = originAllowed(origin, allowed) ? origin : "";
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
      const refusal = refuseRequest(req.headers, allowed);
      if (refusal) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: refusal }, id: null }));
        return;
      }
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
        });
        const server = createServer({ transport: "http" });
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

  httpServer.listen(port, host, () => {
    const shown = host.includes(":") ? `[${host}]` : host;
    console.error(`Rotifer MCP Server (Streamable HTTP) listening on http://${shown}:${port}/mcp`);
    if (!LOOPBACK_HOSTS.has(host)) {
      console.error(
        `Warning: listening on ${host}, so other machines can reach this server. ` +
          "It has no authentication, and its tools act with your signed-in Rotifer account.",
      );
    }
  });

  const shutdown = () => {
    console.error("Shutting down...");
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return httpServer;
}
