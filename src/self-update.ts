import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareSemver,
  fetchLatestVersion,
  getConfigDir,
  getPackageVersion,
} from "./version.js";

/**
 * `rotifer-mcp-server self-update` — a CLI subcommand, deliberately NOT an MCP
 * tool.
 *
 * The server already tells you when it is behind (index.ts writes a notice to
 * stderr on startup); what it could not do was act on that. This closes the
 * gap the same way `login` / `logout` do — a human runs it.
 *
 * Exposing it as a tool was considered and rejected. A tool is something the
 * model decides to call, and this one would run `npm install -g`: an
 * unsandboxed global write triggered by model output rather than by the person
 * whose machine it is. It could not even report success honestly — installing
 * new files on disk does not replace the *running* server process, and the
 * host (Claude Code, Cursor) keeps talking to the old one until it is
 * restarted. So the model would report "updated" while continuing to serve the
 * old code.
 */

export const PACKAGE_NAME = "@rotifer/mcp-server";
const REGISTRY_URL = "https://registry.npmjs.org";
const PROVENANCE_TIMEOUT_MS = 10_000;

export function detectPackageManager(): string {
  const userAgent = process.env.npm_config_user_agent || "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bun";
  return "npm";
}

export function getInstallCommand(pm: string, version: string): [string, string[]] {
  const spec = `${PACKAGE_NAME}@${version}`;
  switch (pm) {
    case "pnpm": return ["pnpm", ["add", "-g", spec]];
    case "yarn": return ["yarn", ["global", "add", spec]];
    case "bun": return ["bun", ["add", "-g", spec]];
    default: return ["npm", ["install", "-g", spec]];
  }
}

/**
 * True when this process was launched by `npx @rotifer/mcp-server`, which is
 * what the README's setup snippet tells hosts to do.
 *
 * It matters because npx re-resolves an unpinned name against the registry on
 * every launch — verified: with 0.17.0 already sitting in the npx cache, a bare
 * `npx @rotifer/mcp-server --version` still ran 0.18.0. Those users have
 * nothing to update, and a global install would only shadow the fresh copy
 * with a stale one.
 */
export function isRunViaNpx(): boolean {
  const execPath = process.env.npm_execpath || "";
  return execPath.includes("npx") || process.env.npm_command === "exec";
}

/**
 * Whether npm has an attestation for this exact version — the same gate the
 * CLI's `self-update` applies. Both packages publish with `--provenance` from
 * CI (OIDC Trusted Publishing), so a version without one is not a version this
 * project released, and we refuse to install it unattended.
 */
export async function verifyProvenance(version: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVENANCE_TIMEOUT_MS);
    const res = await fetch(
      `${REGISTRY_URL}/${encodeURIComponent(PACKAGE_NAME)}/${encodeURIComponent(version)}`,
      { headers: { accept: "application/json" }, signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json() as { dist?: { attestations?: unknown } };
    return !!data.dist?.attestations;
  } catch {
    return false;
  }
}

/**
 * Rollback bookkeeping lives in ~/.config/rotifer/config.json under
 * `last-versions`, the same map @rotifer/playground's `self-update` writes —
 * the two packages have always shared this directory (see getConfigDir), and
 * sharing the map means either command can roll the other's upgrade back.
 * Unknown keys are preserved on write so neither tool clobbers the other's
 * settings.
 */
function getUserConfigFile(): string {
  return join(getConfigDir(), "config.json");
}

export function readLastVersion(): string | null {
  try {
    const f = getUserConfigFile();
    if (!existsSync(f)) return null;
    const config = JSON.parse(readFileSync(f, "utf-8")) as {
      "last-versions"?: Record<string, string>;
    };
    return config["last-versions"]?.[PACKAGE_NAME] ?? null;
  } catch {
    return null;
  }
}

export function recordLastVersion(version: string): void {
  try {
    const f = getUserConfigFile();
    const config: Record<string, unknown> = existsSync(f)
      ? JSON.parse(readFileSync(f, "utf-8"))
      : {};
    const map = (config["last-versions"] ?? {}) as Record<string, string>;
    config["last-versions"] = { ...map, [PACKAGE_NAME]: version };
    mkdirSync(getConfigDir(), { recursive: true });
    writeFileSync(f, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // Losing the rollback breadcrumb must not fail an otherwise good update.
  }
}

export function doesNeedSudo(pm: string): boolean {
  if (pm !== "npm" || process.platform === "win32") return false;
  try {
    const prefix = execFileSync("npm", ["config", "get", "prefix"], {
      encoding: "utf-8",
    }).trim();
    // Statically imported, not `require`d: this package is ESM ("type":
    // "module"), where `require` is not defined at all. A `require` here throws
    // a ReferenceError that the catch below swallows into "sudo needed", so
    // every update would refuse to run with a permissions error that was not
    // real. (@rotifer/playground gets away with the same line only because it
    // compiles to CJS.)
    accessSync(prefix, constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

export interface SelfUpdateOptions {
  isRollback?: boolean;
}

export async function runSelfUpdate(options: SelfUpdateOptions = {}): Promise<void> {
  const current = getPackageVersion();
  const pm = detectPackageManager();

  if (options.isRollback) {
    const previous = readLastVersion();
    if (!previous) {
      console.error("No previous version recorded. Cannot roll back.");
      console.error("Run 'rotifer-mcp-server self-update' at least once first.");
      process.exit(1);
      return;
    }
    const [cmd, args] = getInstallCommand(pm, previous);
    console.log(`Rolling back ${PACKAGE_NAME} to ${previous}...`);
    execFileSync(cmd, args, { stdio: "inherit" });
    console.log(`Rolled back to ${previous}. Restart your MCP host to load it.`);
    return;
  }

  console.log(`${PACKAGE_NAME} ${current}`);

  if (isRunViaNpx()) {
    console.log(
      "Launched through npx, which resolves the latest published version on " +
      "every run — there is nothing to update.",
    );
    console.log(
      "Installing globally would only pin an older copy in front of it. If you " +
      "want a pinned install instead, run: " +
      `${pm} install -g ${PACKAGE_NAME}@latest`,
    );
    return;
  }

  console.log("Checking for updates...");
  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error("Could not reach the npm registry. Try again later.");
    process.exit(1);
    return;
  }

  if (compareSemver(latest, current) <= 0) {
    console.log("Already up to date.");
    return;
  }

  console.log(`Update available: ${current} -> ${latest}`);

  console.log("Verifying provenance...");
  const hasProvenance = await verifyProvenance(latest);
  if (!hasProvenance) {
    console.error(`No provenance attestation for ${PACKAGE_NAME}@${latest}.`);
    console.error(`Refusing to install it unattended. To override: ${pm} install -g ${PACKAGE_NAME}@${latest}`);
    process.exit(1);
    return;
  }
  console.log("Provenance verified.");

  const [cmd, args] = getInstallCommand(pm, latest);

  if (doesNeedSudo(pm)) {
    console.error("Global install requires elevated permissions.");
    console.error(`Run manually: sudo ${cmd} ${args.join(" ")}`);
    process.exit(1);
    return;
  }

  try {
    console.log(`Installing ${PACKAGE_NAME}@${latest}...`);
    execFileSync(cmd, args, { stdio: "inherit" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Update failed: ${msg}`);
    console.error(`Try manually: ${cmd} ${args.join(" ")}`);
    process.exit(1);
    return;
  }

  recordLastVersion(current);
  console.log(`Updated to ${latest}.`);
  // The point people miss: the files changed, the running server did not.
  console.log(
    "Restart your MCP host (Claude Code, Cursor, ...) — a running server keeps " +
    "serving the old code until it is restarted.",
  );
  console.log(`To undo: rotifer-mcp-server self-update --rollback  (back to ${current})`);
}
