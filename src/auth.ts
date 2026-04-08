import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";

const ROTIFER_HOME = join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  ".rotifer"
);

export type AuthProvider = "github" | "gitlab";

export interface CloudUser {
  id: string;
  username: string;
  avatar_url: string | null;
  provider_id: string;
}

export interface CloudCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  provider: AuthProvider;
  user: CloudUser;
}

function ensureRotiferHome(): void {
  if (!existsSync(ROTIFER_HOME)) {
    mkdirSync(ROTIFER_HOME, { recursive: true });
  }
}

function credentialsPath(): string {
  return join(ROTIFER_HOME, "credentials.json");
}

export function loadCredentials(): CloudCredentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;

  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as CloudCredentials;
    if (data.expires_at && Date.now() > data.expires_at) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: CloudCredentials): void {
  ensureRotiferHome();
  writeFileSync(credentialsPath(), JSON.stringify(creds, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  const path = credentialsPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Start a local OAuth callback server on a random port (127.0.0.1:0).
 * Returns the bound port immediately so the caller can construct the auth URL,
 * plus a promise that resolves when the callback arrives.
 */
export async function startOAuthCallbackServer(): Promise<{
  port: number;
  waitForCallback: Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (value: string) => void;
    let callbackReject: (reason: Error) => void;
    const waitForCallback = new Promise<string>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const server = createServer((req, res) => {
      const boundPort = (server.address() as { port: number })?.port || 0;
      const url = new URL(req.url || "/", `http://localhost:${boundPort}`);

      if (url.pathname === "/callback/token") {
        const token = url.searchParams.get("access_token");
        const refresh = url.searchParams.get("refresh_token");
        if (token) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Login successful!</h2>" +
              "<p>You can close this window and return to the terminal.</p>" +
              "</body></html>"
          );
          server.close();
          callbackResolve(`implicit:${token}:${refresh || ""}`);
          return;
        }
      }

      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Login successful!</h2>" +
            "<p>You can close this window and return to the terminal.</p>" +
            "</body></html>"
        );
        server.close();
        callbackResolve(code);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><script>
if (window.location.hash) {
  var params = new URLSearchParams(window.location.hash.substring(1));
  var token = params.get('access_token');
  var refresh = params.get('refresh_token');
  if (token) {
    window.location.href = '/callback/token?access_token=' + encodeURIComponent(token) + '&refresh_token=' + encodeURIComponent(refresh || '');
  } else {
    document.body.innerHTML = '<h2>Login failed</h2><p>No token received.</p>';
  }
} else {
  document.body.innerHTML = '<h2>Login failed</h2><p>Missing authorization data.</p>';
}
</script><noscript>Enable JavaScript to complete login.</noscript></body></html>`);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, waitForCallback });
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    setTimeout(() => {
      server.close();
      callbackReject(new Error("Login timed out after 120 seconds"));
    }, 120_000);
  });
}
