// CI-only, Windows-only. Mocked unit tests cannot show what cmd.exe or the
// shell's URL handling does to a URL, so this drives the compiled server
// through real process spawns on a real Windows host.
//
// A private URL scheme, registered for this user only, records the exact URL it
// receives. The only side effect of a failure is a marker file in a temp folder.
//
// Usage: node windows-open-browser-check.mjs [dist-folder]
// Exit code 0 means every case passed; 1 means at least one did not.
import { execFile, execFileSync, spawn } from "node:child_process";
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
const dist = resolve(process.argv[2] ?? join(repo, "dist"));
const entry = join(dist, "index.js");
const { buildOpenCommand, openBrowser } = await import(pathToFileURL(join(dist, "open-browser.js")).href);

const work = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "open-browser-check-"));
// Markers are named relative to this folder so the text in the URL has no path
// separators, which a URL check could reject for an unrelated reason.
process.chdir(work);

const captureFile = join(work, "captured-urls.txt");
const recorder = join(work, "recorder.cjs");
writeFileSync(
  recorder,
  `require("node:fs").appendFileSync(${JSON.stringify(captureFile)}, process.argv[2] + "\\n");\n`,
);

function reg(...args) {
  execFileSync("reg", args, { stdio: "ignore" });
}

const CHECK_SCHEME = "rotifer-open-check";
reg("add", `HKCU\\Software\\Classes\\${CHECK_SCHEME}`, "/v", "URL Protocol", "/d", "", "/f");
reg(
  "add",
  `HKCU\\Software\\Classes\\${CHECK_SCHEME}\\shell\\open\\command`,
  "/ve",
  "/d",
  `"${process.execPath}" "${recorder}" "%1"`,
  "/f",
);

const home = join(work, "home");
const childEnv = { ...process.env, HOME: home, USERPROFILE: home, DO_NOT_TRACK: "1" };
const marker = (name) => join(work, `marker-${name}`);
const inject = (name) => `echo.x>marker-${name}`;

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

async function waitForCapture(needle, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const line = captured().find((l) => l.includes(needle));
    if (line) return line;
    await delay(250);
  }
  return undefined;
}

const results = [];
function record(name, passed, detail) {
  results.push(passed);
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

// 1. The URL handler must receive a URL whole, ampersands included.
{
  const url = `${CHECK_SCHEME}://check/authorize?provider=github&redirect_to=x&code_challenge=abc`;
  const { bin, args } = buildOpenCommand(url, process.platform);
  execFile(bin, args);
  const got = await waitForCapture(`${CHECK_SCHEME}:`, 30_000);
  record("URL handler receives the whole URL", got === url, got === url ? "" : `received: ${got ?? "nothing"}`);
}

// 2. A URL that is valid but carries shell metacharacters in its query.
{
  const m = marker("query");
  openBrowser(`https://example.invalid/?a=1&${inject("query")}`);
  const hit = await appeared(m, 10_000);
  record("metacharacters in a URL do not run as commands", !hit, hit ? "marker file was created" : "");
}

// 3. The command-line entry. The endpoint is a valid URL, so it gets all the way to the spawn.
{
  const m = marker("cli");
  const child = spawn(process.execPath, [entry, "login", "--endpoint", `https://example.invalid/&${inject("cli")}&`], {
    env: childEnv,
    cwd: work,
    stdio: "ignore",
  });
  const hit = await appeared(m, 12_000);
  child.kill();
  record("login --endpoint cannot run a command", !hit, hit ? "marker file was created" : "");
}

// 4. The MCP tool, over real stdio, with the argument an assistant could be tricked into sending.
{
  const m = marker("mcp");
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: childEnv, cwd: work, stderr: "ignore" });
  const client = new Client({ name: "windows-open-browser-check", version: "0.0.0" });
  await client.connect(transport);
  const call = client
    .callTool({ name: "login", arguments: { endpoint: `https://example.invalid/&${inject("mcp")}&` } }, undefined, { timeout: 15_000 })
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
