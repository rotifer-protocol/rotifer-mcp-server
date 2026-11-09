// CI-only, Windows-only. Walks the whole MCP sign-in on a real Windows host with
// no real account: the compiled server, over stdio, opens the real default
// browser, which talks to a stand-in authorization server on loopback.
//
// This shows the path from "open the browser" to "credentials saved" works and
// that the PKCE values survive it. It cannot show how the real Cloud or an OAuth
// provider behave.
//
// Usage: node windows-login-flow-check.mjs [dist-folder]
// Exit code 0 means every check passed; 1 means at least one did not.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.platform !== "win32") {
  console.error("SETUP INVALID: this check only means something on Windows.");
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..", "..");
const dist = resolve(process.argv[2] ?? join(repo, "dist"));
const entry = join(dist, "index.js");

const work = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "login-flow-check-"));
const home = join(work, "home");
mkdirSync(join(home, ".rotifer"), { recursive: true });

const issuedCode = `fake-code-${randomBytes(8).toString("hex")}`;
const FAKE_ACCESS = "fake-access-token";
const FAKE_REFRESH = "fake-refresh-token";

const seen = { authorize: null, token: null, userAuthorization: null };

function readBody(req) {
  return new Promise((done) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => done(body));
  });
}

const fake = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (value) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };

  if (url.pathname === "/auth/v1/authorize") {
    seen.authorize = Object.fromEntries(url.searchParams);
    const redirectTo = url.searchParams.get("redirect_to");
    if (!redirectTo) {
      res.writeHead(400);
      res.end("redirect_to is missing");
      return;
    }
    const target = new URL(redirectTo);
    target.searchParams.set("code", issuedCode);
    res.writeHead(302, { Location: target.href });
    res.end();
    return;
  }
  if (url.pathname === "/auth/v1/token") {
    seen.token = { grantType: url.searchParams.get("grant_type"), ...JSON.parse(await readBody(req)) };
    json({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, expires_in: 3600 });
    return;
  }
  if (url.pathname === "/auth/v1/user") {
    seen.userAuthorization = req.headers.authorization ?? null;
    json({ id: "windows-check", user_metadata: { user_name: "windows-check" } });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((ready) => fake.listen(0, "127.0.0.1", ready));
const endpoint = `http://127.0.0.1:${fake.address().port}`;

writeFileSync(join(home, ".rotifer", "cloud.json"), JSON.stringify({ endpoint, anonKey: "fake-anon-key" }));

const results = [];
function record(name, passed, detail) {
  results.push(passed);
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${!passed && detail ? ` - ${detail}` : ""}`);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...process.env, HOME: home, USERPROFILE: home, DO_NOT_TRACK: "1" },
  cwd: work,
  stderr: "ignore",
});
const client = new Client({ name: "windows-login-flow-check", version: "0.0.0" });
await client.connect(transport);

const call = client
  .callTool({ name: "login", arguments: {} }, undefined, { timeout: 100_000 })
  .catch((err) => ({ transportError: err.message }));
const outcome = await Promise.race([call, delay(100_000, { timedOut: true })]);

if (!seen.authorize) {
  // One look at whether a browser started at all, to tell "the browser never
  // navigated" from "the request went wrong".
  let browsers = "unknown";
  try {
    browsers = execFileSync("tasklist", ["/FI", "IMAGENAME eq msedge.exe", "/NH"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes("msedge")).length;
  } catch {}
  console.log(`DIAG  no authorize request reached the stand-in server; msedge processes running: ${browsers}`);
}

const authorize = seen.authorize ?? {};
const challengeFromVerifier = seen.token?.code_verifier
  ? createHash("sha256").update(seen.token.code_verifier).digest("base64url")
  : undefined;

let toolResult;
try {
  toolResult = JSON.parse(outcome.content[0].text);
} catch {}

const credentialsFile = join(home, ".rotifer", "credentials.json");
let saved;
if (existsSync(credentialsFile)) saved = JSON.parse(readFileSync(credentialsFile, "utf8"));

record("authorize request names the provider", authorize.provider === "github", `received: ${JSON.stringify(authorize)}`);
record("authorize request names the callback", authorize.redirect_to === "http://localhost:9876/callback", `received: ${authorize.redirect_to}`);
record("authorize request carries a PKCE challenge", Boolean(authorize.code_challenge), "no code_challenge");
record("authorize request asks for S256", authorize.code_challenge_method === "S256", `received: ${authorize.code_challenge_method}`);
record("token request is a PKCE exchange", seen.token?.grantType === "pkce", `received: ${seen.token?.grantType}`);
record("token request carries the issued code", seen.token?.auth_code === issuedCode, "code did not match");
record("code_verifier matches the challenge", Boolean(challengeFromVerifier) && challengeFromVerifier === authorize.code_challenge, "verifier does not hash to the challenge");
record("user request uses the exchanged token", seen.userAuthorization === `Bearer ${FAKE_ACCESS}`, "wrong or missing Authorization");
record("login reports success", toolResult?.success === true, outcome.timedOut ? "timed out" : `result: ${JSON.stringify(toolResult ?? outcome)}`);
record("credentials are saved under the temporary home", saved?.access_token === FAKE_ACCESS && saved?.refresh_token === FAKE_REFRESH, saved ? "saved tokens do not match" : "no credentials file");

await transport.close().catch(() => {});
fake.close();

const failed = results.filter((passed) => !passed).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
