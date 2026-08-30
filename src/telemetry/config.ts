/**
 * Storage and consent state for the anonymous usage heartbeat (ADR-329).
 *
 * Lives in ~/.rotifer/telemetry.json, shared in practice with
 * rotifer-playground on the same machine: both processes read and write this
 * file, so a machine_id minted by one is picked up by the other rather than
 * each inventing its own. The on-disk shape (enabled / machine_id /
 * consent_source / first_run_notice_shown / updated_at) is copied field-for-
 * field from playground's src/telemetry/config.ts — keep the two in sync, or
 * one process's write starts looking like corruption to the other's reader.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { telemetryOptedOutByEnv, telemetryExplicitlyOnByEnv } from "./consent.js";

const ROTIFER_HOME = join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  ".rotifer",
);
const TELEMETRY_CONFIG_FILE = "telemetry.json";

// mcp-server has no equivalent of playground's utils/private-fs.ts — this is
// that module's two functions, copied rather than imported (again: separate
// npm packages). Kept deliberately this small; if a third file in this
// package ever needs the same thing, promote it to its own module then.
function ensurePrivateDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(dirPath, 0o700);
  } catch {
    // Best-effort hardening on existing directories.
  }
}

function tightenPrivateFile(filePath: string, mode: number = 0o600): void {
  try {
    chmodSync(filePath, mode);
  } catch {
    // Best-effort hardening on files that were just created or updated.
  }
}

export type ConsentSource = "installer" | "cli" | "default-notice";

export interface HeartbeatConfig {
  /** The user's stored choice. Irrelevant when an env var overrides it. */
  enabled: boolean;
  /** Random UUIDv4, minted once. Never derived from hardware, paths, or identity. */
  machine_id: string;
  consent_source: ConsentSource;
  /** Gates the one-time notice — see heartbeat.ts's maybeNoticeText(). */
  first_run_notice_shown: boolean;
  updated_at: string;
}

function telemetryConfigPath(): string {
  return join(ROTIFER_HOME, TELEMETRY_CONFIG_FILE);
}

function readStoredConfig(): HeartbeatConfig | null {
  const p = telemetryConfigPath();
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as Partial<HeartbeatConfig>;
    if (typeof parsed.machine_id !== "string" || !parsed.machine_id) return null;
    return {
      enabled: parsed.enabled !== false,
      machine_id: parsed.machine_id,
      consent_source: parsed.consent_source ?? "default-notice",
      first_run_notice_shown: parsed.first_run_notice_shown === true,
      updated_at: parsed.updated_at ?? new Date(0).toISOString(),
    };
  } catch {
    // Corrupt file: treated as absent, a fresh machine_id is minted. Losing
    // continuity once is an acceptable cost; refusing to run telemetry at
    // all until a human fixes the file is not — this is opt-out telemetry.
    return null;
  }
}

function writeStoredConfig(config: HeartbeatConfig): void {
  ensurePrivateDir(ROTIFER_HOME);
  const p = telemetryConfigPath();
  writeFileSync(p, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  tightenPrivateFile(p);
}

/**
 * Reads the stored config, minting one (with a fresh machine_id) on first
 * ever call. Cheap and idempotent — no reason to cache across calls within a
 * process; a concurrent `rotifer telemetry off` run from the CLI on the same
 * machine should be picked up by the next tool call, not shadowed by a stale
 * in-memory copy held by a long-lived MCP server process.
 */
export function loadOrInitHeartbeatConfig(): HeartbeatConfig {
  const existing = readStoredConfig();
  if (existing) return existing;

  const fresh: HeartbeatConfig = {
    enabled: true,
    machine_id: randomUUID(),
    consent_source: "default-notice",
    first_run_notice_shown: false,
    updated_at: new Date().toISOString(),
  };
  writeStoredConfig(fresh);
  return fresh;
}

/**
 * Persists that the notice has now been shown — separated from printing/
 * returning it (heartbeat.ts) so the persistence, which must happen exactly
 * once and survive even if the network call that follows fails, is not
 * tangled up with how the notice reaches the user.
 */
export function markFirstRunNoticeShown(config: HeartbeatConfig): void {
  if (config.first_run_notice_shown) return;
  writeStoredConfig({ ...config, first_run_notice_shown: true, updated_at: new Date().toISOString() });
}

export type HeartbeatDecision =
  | "off-env"
  | "on-env"
  | "off-stored"
  | "on-stored"
  | "on-default";

/**
 * Resolution order, mirrored in TELEMETRY.md and kept in sync deliberately:
 *   DO_NOT_TRACK / ROTIFER_TELEMETRY (env, either direction) > stored choice
 *   > default on.
 *
 * The heartbeat's default is the opposite of the signed-in invocation
 * report's (default-off) on purpose — see migration 20260830010000's header
 * in rotifer-playground: this table carries no per-row accountability to
 * protect, and default-off here would just reproduce the blind spot
 * ADR-329 exists to close.
 */
export function resolveHeartbeatDecision(
  config: HeartbeatConfig,
  env: NodeJS.ProcessEnv = process.env,
): HeartbeatDecision {
  if (telemetryOptedOutByEnv(env)) return "off-env";
  if (telemetryExplicitlyOnByEnv(env)) return "on-env";
  if (!config.enabled) return "off-stored";
  return config.consent_source === "default-notice" ? "on-default" : "on-stored";
}

export function heartbeatDecisionEnabled(d: HeartbeatDecision): boolean {
  return d === "on-env" || d === "on-stored" || d === "on-default";
}
