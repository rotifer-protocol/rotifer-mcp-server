// CI-only, Windows-only. Mocked unit tests cannot show what cmd.exe or the
// shell association does to a URL, so this drives the compiled server through
// real process spawns on a real Windows host.
//
// The default browser is replaced, for this user only, by a small recorder, so
// the check sees the exact URL a browser would have received and no browser
// starts. The only side effect of a failure is a marker file in a temp folder.
//
// Exit code 0 means every case passed; 1 means at least one did not.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.platform !== "win32") {
  console.error("SETUP INVALID: this check only means something on Windows.");
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..", "..");
const entry = join(repo, "dist", "index.js");
const { openBrowser } = await import(pathToFileURL(join(repo, "dist", "open-browser.js")).href);

const work = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "open-browser-check-"));
if (/\s/.test(work)) {
  // An argument with a space gets quoted by Node, which would hide the problem.
  console.error("SETUP INVALID: the working folder must not contain spaces.");
  process.exit(1);
}

const captureFile = join(work, "captured-urls.txt");
const recorder = join(work, "recorder.cjs");
writeFileSync(
  recorder,
  `require("node:fs").appendFileSync(${JSON.stringify(captureFile)}, process.argv[2] + "\\n");\n`,
);

function reg(...args) {
  execFileSync("reg", args, { stdio: "ignore" });
}

for (const scheme of ["http", "https"]) {
  try {
    reg("delete", `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`, "/f");
  } catch {
    // No per-user choice on this image, which is what the override needs anyway.
  }
  reg(
    "add",
    `HKCU\\Software\\Classes\\${scheme}\\shell\\open\\command`,
    "/ve",
    "/d",
    `"${process.execPath}" "${recorder}" "%1"`,
    "/f",
  );
}

const home = join(work, "home");
const childEnv = { ...process.env, HOME: home, USERPROFILE: home, DO_NOT_TRACK: "1" };
const marker = (name) => join(work, `marker-${name}`);
const inject = (path) => `echo.x>${path}`;

async function appeared(path, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(path)) return true;
    await delay(250);
  }
  return existsSync(path);
}

function captured() {
  return existsSync(captureFile) ? readFileSync(captureFile, "utf8").trim().split("\n") : [];
}

const results = [];
function record(name, passed, detail) {
  results.push(passed);
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

// 1. An ordinary authorization URL has to reach the browser whole.
{
  const url =
    "https://example.invalid/auth/v1/authorize?provider=github" +
    "&redirect_to=http://localhost:9876/callback&code_challenge=abc&code_challenge_method=S256";
  openBrowser(url);
  const end = Date.now() + 30_000;
  while (Date.now() < end && !captured().length) await delay(250);
  const got = captured()[0];
  record("authorization URL reaches the browser intact", got === url, got === url ? "" : `received: ${got ?? "nothing"}`);
}

// 2. A URL that is valid but carries shell metacharacters in its query.
{
  const m = marker("query");
  try {
    openBrowser(`https://example.invalid/?a=1&${inject(m)}`);
  } catch (err) {
    console.log(`note: openBrowser refused the URL: ${err.message}`);
  }
  const hit = await appeared(m, 10_000);
  record("metacharacters in a URL do not run as commands", !hit, hit ? "marker file was created" : "");
}

// 3. The command-line entry.
{
  const m = marker("cli");
  const child = spawn(process.execPath, [entry, "login", "--endpoint", `https://example.invalid/&${inject(m)}&`], {
    env: childEnv,
    stdio: "ignore",
  });
  const hit = await appeared(m, 12_000);
  child.kill();
  record("login --endpoint cannot run a command", !hit, hit ? "marker file was created" : "");
}

// 4. The MCP tool, over real stdio, with the argument an assistant could be tricked into sending.
{
  const m = marker("mcp");
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: childEnv, stderr: "ignore" });
  const client = new Client({ name: "windows-open-browser-check", version: "0.0.0" });
  await client.connect(transport);
  const call = client
    .callTool({ name: "login", arguments: { endpoint: `https://example.invalid/&${inject(m)}&` } }, undefined, { timeout: 15_000 })
    .catch((err) => ({ transportError: err.message }));
  const hit = await appeared(m, 12_000);
  const outcome = await Promise.race([call, delay(3_000, { pending: true })]);
  await transport.close().catch(() => {});
  record("MCP login cannot run a command", !hit, hit ? "marker file was created" : "");
  record("MCP login refuses an endpoint argument", outcome.isError === true, outcome.isError === true ? "" : "call was not refused");
}

const failed = results.filter((passed) => !passed).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
