import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { isIPv6 } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const DEFAULT_PORT = 3000;

/**
 * Loopback unless the operator asks otherwise (`serve --host`). Its tools act
 * with the signed-in user's Rotifer account, so it should not be reachable from
 * other machines by default, and `serve` refuses to be without an access token.
 * Before GHSA-46jr was fixed here it listened on every interface.
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

/** Read once at launch and then removed, so spawned CLIs and genes never inherit it. */
export const ACCESS_TOKEN_ENV = "ROTIFER_MCP_HTTP_TOKEN";

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
 * without naming them is refused, because the server would otherwise answer
 * whatever name a client used to reach it.
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

function readTokenFile(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`--token-file ${path} cannot be read (${(err as NodeJS.ErrnoException).code}). Check the path and its permissions.`);
  }
  // `echo x > file` ends the file with a newline that is not part of the token.
  const token = text.replace(/[\r\n]+$/, "");
  if (!token) {
    throw new Error(`--token-file ${path} is empty. Put a token in it, for example: openssl rand -hex 32 > ${path}`);
  }
  return token;
}

/**
 * The token HTTP clients must present, or undefined for none. Required when
 * other machines can reach the server. Never taken from the command line,
 * because other programs on the machine can read that.
 */
export function resolveAccessToken(
  host: string | undefined,
  tokenFile: string | undefined,
  envToken: string | undefined,
): string | undefined {
  if (tokenFile !== undefined && envToken !== undefined) {
    throw new Error(`Both --token-file and ${ACCESS_TOKEN_ENV} are set. Use only one of them.`);
  }
  if (tokenFile !== undefined) return readTokenFile(tokenFile);
  if (envToken === "") {
    throw new Error(`${ACCESS_TOKEN_ENV} is set but empty. Set it to a token, for example the output of: openssl rand -hex 32`);
  }
  if (envToken === undefined && host !== undefined && !LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `--host ${host} also needs an access token, because other machines can reach it. ` +
        `Create one with: openssl rand -hex 32 > mcp-token, then add --token-file mcp-token or set ${ACCESS_TOKEN_ENV}`,
    );
  }
  return envToken;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Compares fixed-length digests, so timing reveals neither the token nor its length. */
function tokenAccepted(authorization: string | undefined, token: string): boolean {
  const presented = /^bearer +(.+)$/i.exec(authorization ?? "")?.[1];
  return presented !== undefined && timingSafeEqual(sha256(presented), sha256(token));
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

export async function startHttpServer(opts?: {
  port?: number;
  host?: string;
  allowedHosts?: string[];
  accessToken?: string;
}): Promise<http.Server> {
  const port = opts?.port ?? parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const host = opts?.host ?? DEFAULT_HOST;
  const allowed = new Set([...LOOPBACK_HOSTNAMES, ...(opts?.allowedHosts ?? [])]);
  const accessToken = opts?.accessToken;

  const reject = (res: http.ServerResponse, status: number, message: string, headers: http.OutgoingHttpHeaders = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
  };

  const httpServer = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const allowedOrigin = originAllowed(origin, allowed) ? origin : "";
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    // A browser's preflight cannot carry Authorization, so it is exempt from the
    // token. It answers with CORS headers only and never reaches the MCP handler.
    if (req.method === "OPTIONS") {
      const refusal = refuseRequest(req.headers, allowed);
      if (refusal) {
        reject(res, 403, refusal);
        return;
      }
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

    const refusal = refuseRequest(req.headers, allowed);
    if (refusal) {
      reject(res, 403, refusal);
      return;
    }

    if (accessToken !== undefined && !tokenAccepted(req.headers.authorization, accessToken)) {
      reject(res, 401, "This server requires its access token. Send it in the header: Authorization: Bearer <token>", {
        "WWW-Authenticate": "Bearer",
      });
      return;
    }

    if (url === "/mcp" || url === "/") {
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
          "Anyone with the access token acts as your signed-in Rotifer account, and this server does not encrypt traffic: " +
          "put it behind an HTTPS reverse proxy or tunnel.",
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
