// Waits until npm serves a package version, or fails at a fixed limit.
//
// The MCP Registry checks that the npm version exists, and a version published
// seconds earlier can still answer 404. This asks the same per-version URL.
//
// Usage: node wait-for-npm-version.mjs <package> <version>
// Exit codes: 0 visible, 1 not visible within the limit, 2 bad usage or settings.
//
// NPM_WAIT_TIMEOUT_SECONDS   how long to wait in total (default 300)
// NPM_WAIT_INTERVAL_SECONDS  pause between checks (default 10)
// NPM_REGISTRY_URL           registry to ask (default https://registry.npmjs.org)

const [name, version] = process.argv.slice(2);
if (!name || !version) {
  console.error("Usage: node wait-for-npm-version.mjs <package> <version>");
  process.exit(2);
}

function seconds(setting, fallback) {
  const raw = process.env[setting];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${setting} must be a number of seconds greater than 0.`);
    process.exit(2);
  }
  return value;
}

const timeoutMs = seconds("NPM_WAIT_TIMEOUT_SECONDS", 300) * 1000;
const intervalMs = seconds("NPM_WAIT_INTERVAL_SECONDS", 10) * 1000;
const registry = (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/+$/, "");
const url = `${registry}/${name.replace("/", "%2F")}/${version}`;

const deadline = Date.now() + timeoutMs;
const label = `${name}@${version}`;
let last = "no response";

for (;;) {
  const remaining = deadline - Date.now();
  try {
    // A stalled request must not carry the wait past its limit.
    const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(remaining, 1)) });
    last = `HTTP ${res.status}`;
    if (res.ok && (await res.json()).version === version) {
      console.log(`${label} is visible on npm.`);
      process.exit(0);
    }
  } catch (err) {
    // The limit cutting off the final check says nothing about npm, so keep
    // whatever npm last answered.
    if (err.name !== "TimeoutError" || last === "no response") last = err.message;
  }

  const left = deadline - Date.now();
  if (left <= 0) break;
  console.log(`${label} is not visible yet (${last}). Checking again.`);
  await new Promise((wake) => setTimeout(wake, Math.min(intervalMs, left)));
}

console.error(
  `${label} was not visible on npm after ${timeoutMs / 1000} seconds (last result: ${last}). ` +
    "Confirm that the publish step succeeded, then re-run this job.",
);
process.exit(1);
