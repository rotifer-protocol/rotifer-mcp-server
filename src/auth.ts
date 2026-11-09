import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { renderCallbackPage } from "./callback-page.js";

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
  const data = loadStoredCredentials();
  if (!data) return null;
  if (data.expires_at && Date.now() > data.expires_at) return null;
  return data;
}

/**
 * The credentials file as stored, expired or not. Only for renewing an
 * expired session (cloud.ts `credentialsForReporting`); everything else wants
 * `loadCredentials`, which treats an expired session as signed out.
 */
export function loadStoredCredentials(): CloudCredentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CloudCredentials;
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
 * Fixed loopback port for the OAuth callback server.
 *
 * Must exactly match a Supabase Auth "Redirect URLs" allow-list entry
 * (`http://localhost:9876/callback`). A random port cannot be used here:
 * Supabase does not honor a port wildcard in the allow-list, so an unlisted
 * `redirect_to` is silently dropped and the browser is bounced to the Site URL
 * (the website) instead of returning the token to this local server.
 */
const OAUTH_CALLBACK_PORT = 9876;

/**
 * Start the local OAuth callback server. Defaults to the fixed, allow-listed
 * loopback port (127.0.0.1:9876) so the OAuth `redirect_to` matches Supabase's
 * Redirect URLs allow-list; pass `0` (e.g. in tests) for a random ephemeral
 * port to avoid cross-test port contention. Returns the bound port plus a
 * promise that resolves when the callback arrives.
 */
export async function startOAuthCallbackServer(
  port: number = OAUTH_CALLBACK_PORT,
): Promise<{
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

      // Only a PKCE code ends the login: it is worthless without this process's
      // code_verifier. A token handed to this port is never accepted, because any
      // page open in the user's browser can make that request.
      const code = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCallbackPage(url.searchParams));
      if (code) {
        server.close();
        clearTimeout(timeLimit);
        callbackResolve(code);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, waitForCallback });
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    const timeLimit = setTimeout(() => {
      server.close();
      callbackReject(new Error("Login timed out after 120 seconds"));
    }, 120_000);
  });
}
