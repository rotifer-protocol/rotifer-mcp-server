import { loadCloudConfig } from "./cloud.js";
import { openBrowser } from "./open-browser.js";
import { normalizeCloudEndpoint } from "./validate-url.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  generateCodeVerifier,
  generateCodeChallenge,
  startOAuthCallbackServer,
} from "./auth.js";
import type { AuthProvider } from "./auth.js";

export const SUPPORTED_PROVIDERS: AuthProvider[] = ["github", "gitlab"];

export function isSupportedProvider(provider: string): provider is AuthProvider {
  return (SUPPORTED_PROVIDERS as string[]).includes(provider);
}

export async function runLogin(options: {
  provider?: string;
  endpoint?: string;
}): Promise<void> {
  console.log("Rotifer Cloud Login\n");

  const config = loadCloudConfig();
  let endpoint: string;
  try {
    endpoint = normalizeCloudEndpoint(options.endpoint || config.endpoint);
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
    return;
  }

  const existing = loadCredentials();
  if (existing) {
    console.log(`Already logged in as ${existing.user.username} (via ${existing.provider})`);
    console.log("Run 'rotifer-mcp-server logout' to switch accounts.");
    return;
  }

  const provider = options.provider || "github";
  if (!isSupportedProvider(provider)) {
    console.error(`Unsupported provider: '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
    process.exit(1);
    return;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const { port: callbackPort, waitForCallback } = await startOAuthCallbackServer();

  console.log(`Opening browser for ${provider} authorization...`);

  const authUrl =
    `${endpoint}/auth/v1/authorize?provider=${provider}` +
    `&redirect_to=http://localhost:${callbackPort}/callback` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  openBrowser(authUrl);

  console.log(`Waiting for authorization on port ${callbackPort} (timeout: 120s)...`);

  try {
    const authCode = await waitForCallback;

    console.log("Exchanging authorization code for token...");
    const tokenRes = await fetch(
      `${endpoint}/auth/v1/token?grant_type=pkce`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
        },
        body: JSON.stringify({
          auth_code: authCode,
          code_verifier: codeVerifier,
        }),
      }
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error(`Authentication failed: ${err}`);
      process.exit(1);
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken: string = tokenData.access_token;
    const refreshToken: string = tokenData.refresh_token;

    const userRes = await fetch(`${endpoint}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: config.anonKey,
      },
    });

    const userData = (await userRes.json()) as any;
    const meta = userData.user_metadata || {};

    const username =
      meta.user_name ||
      meta.preferred_username ||
      meta.name ||
      meta.nickname ||
      meta.email?.split("@")[0] ||
      "unknown";

    saveCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + 3600 * 1000,
      provider,
      user: {
        id: userData.id,
        username,
        avatar_url: meta.avatar_url || null,
        provider_id: meta.provider_id || meta.sub || "",
      },
    });

    console.log();
    console.log(`Logged in as ${username} (via ${provider})`);
    console.log(`Endpoint: ${endpoint}`);
    console.log("You can now use Rotifer Cloud features via MCP.");
  } catch (err: any) {
    console.error(err.message || "Login failed");
    process.exit(1);
  }
}

export function runLogout(): void {
  const existing = loadCredentials();
  if (!existing) {
    console.log("Not currently logged in.");
    return;
  }
  clearCredentials();
  console.log(`Logged out (was: ${existing.user.username} via ${existing.provider})`);
}
