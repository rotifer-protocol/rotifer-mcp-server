import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getConfigDir(): string {
  return process.env.ROTIFER_CONFIG_DIR || join(homedir(), ".config", "rotifer");
}

function getCacheFile(): string {
  return join(getConfigDir(), "update-check.json");
}
const REGISTRY_URL = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 5000;
const PKG_NAME = "@rotifer/mcp-server";

interface UpdateCache {
  [pkg: string]: { lastCheck: number; latest: string };
}

export function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
  return pkg.version;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function readCache(): UpdateCache {
  try {
    const f = getCacheFile();
    if (existsSync(f)) {
      return JSON.parse(readFileSync(f, "utf-8"));
    }
  } catch { /* corrupt */ }
  return {};
}

function writeCache(cache: UpdateCache): void {
  try {
    mkdirSync(getConfigDir(), { recursive: true });
    writeFileSync(getCacheFile(), JSON.stringify(cache, null, 2));
  } catch { /* non-critical */ }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${REGISTRY_URL}/${encodeURIComponent(PKG_NAME)}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const current = getPackageVersion();

  if (process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.ROTIFER_NO_UPDATE_CHECK) {
    return { current, latest: null, updateAvailable: false };
  }

  try {
    const cache = readCache();
    const entry = cache[PKG_NAME];

    let latest: string | null = null;

    if (entry && Date.now() - entry.lastCheck < CHECK_INTERVAL_MS) {
      latest = entry.latest;
    } else {
      latest = await fetchLatestVersion();
      if (latest) {
        cache[PKG_NAME] = { lastCheck: Date.now(), latest };
        writeCache(cache);
      }
    }

    if (!latest) return { current, latest: null, updateAvailable: false };

    return {
      current,
      latest,
      updateAvailable: compareSemver(latest, current) > 0,
    };
  } catch {
    return { current, latest: null, updateAvailable: false };
  }
}

export function formatUpdateHint(info: VersionInfo): string {
  return `[System] Rotifer MCP Server ${info.current} → ${info.latest} update available. ` +
    `Update with: npm i -g @rotifer/mcp-server@latest`;
}
