/**
 * Snapshots — the undo that installing a Gene never had.
 *
 * Installing over an existing Gene was, until this module, the only
 * irreversible thing this server could do: `install_gene` took `force`, and
 * nothing in the CLI or the tool surface could put back what it replaced.
 *
 * So an overwrite now moves the old directory aside first. One snapshot per
 * Gene, replaced by the next overwrite of that same Gene and consumed by a
 * rollback: this undoes the last upgrade, which is the thing people actually
 * want back. Keeping a deeper history would be a different feature, and
 * `list_gene_versions` already answers "what versions exist" from the registry.
 *
 * Snapshots live in `<genesDir>/.snapshots/`, beside the Genes they shadow, so
 * they travel with the project and a rollback run in that project finds them.
 * `listLocalGenes` only counts directories containing `phenotype.json`, which
 * `.snapshots` does not have at its top level, so nothing starts reporting
 * snapshots as installed Genes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOT_DIR = ".snapshots";

export interface SnapshotMeta {
  /** Gene name, which is also the directory name under .snapshots/ */
  name: string;
  /** ISO timestamp of the overwrite that created this snapshot */
  replacedAt: string;
  /** Gene id that overwrote it, when the caller knows one */
  replacedBy: string | null;
  /** Version recorded in the replaced copy's .cloud-manifest.json, when it had one */
  replacedVersion: string | null;
}

const snapshotRoot = (genesDir: string): string => join(genesDir, SNAPSHOT_DIR);
const snapshotPath = (genesDir: string, name: string): string => join(snapshotRoot(genesDir), name);
const metaPath = (genesDir: string, name: string): string => join(snapshotRoot(genesDir), `${name}.json`);

function readVersion(geneDir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(geneDir, ".cloud-manifest.json"), "utf-8"));
    return typeof manifest?.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * Move an installed Gene aside so an overwrite can be undone.
 *
 * Returns the snapshot metadata, or null when there was nothing to snapshot.
 * Throws if the snapshot cannot be written — a silent failure here would leave
 * the caller believing an overwrite is reversible when it is not, which is
 * worse than refusing to install.
 */
export function snapshotGene(
  genesDir: string,
  name: string,
  replacedBy: string | null = null,
  now: () => Date = () => new Date()
): SnapshotMeta | null {
  const geneDir = join(genesDir, name);
  if (!existsSync(geneDir)) return null;

  const target = snapshotPath(genesDir, name);
  mkdirSync(snapshotRoot(genesDir), { recursive: true });
  // One per Gene: the previous snapshot has already been superseded by the
  // copy we are about to replace, so keeping it would offer to restore
  // something two upgrades stale.
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });

  const meta: SnapshotMeta = {
    name,
    replacedAt: now().toISOString(),
    replacedBy,
    replacedVersion: readVersion(geneDir),
  };

  renameSync(geneDir, target);
  writeFileSync(metaPath(genesDir, name), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

/** Every Gene that can currently be rolled back, newest replacement first. */
export function listSnapshots(genesDir: string): SnapshotMeta[] {
  const root = snapshotRoot(genesDir);
  if (!existsSync(root)) return [];

  let entries: string[];
  try {
    entries = readdirSync(root).filter((e) => {
      try {
        return statSync(join(root, e)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }

  return entries
    .map((name) => {
      try {
        return JSON.parse(readFileSync(metaPath(genesDir, name), "utf-8")) as SnapshotMeta;
      } catch {
        // A snapshot directory whose metadata is unreadable is still
        // restorable; report it rather than hiding it.
        return { name, replacedAt: "", replacedBy: null, replacedVersion: null };
      }
    })
    .sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
}

export interface RestoreResult {
  name: string;
  restoredTo: string;
  replacedAt: string;
  replacedVersion: string | null;
}

/**
 * Put a snapshot back, discarding whatever currently occupies the Gene's
 * directory. The snapshot is consumed: rollback undoes one step, and leaving
 * it in place would let a second rollback silently discard the copy the first
 * one restored.
 */
export function restoreGene(genesDir: string, name: string): RestoreResult {
  const source = snapshotPath(genesDir, name);
  if (!existsSync(source)) {
    const available = listSnapshots(genesDir).map((s) => s.name);
    throw new Error(
      available.length
        ? `No snapshot for '${name}'. Available: ${available.join(", ")}.`
        : `No snapshot for '${name}'. Nothing has been overwritten in this project.`
    );
  }

  const meta = listSnapshots(genesDir).find((s) => s.name === name);
  const geneDir = join(genesDir, name);
  if (existsSync(geneDir)) rmSync(geneDir, { recursive: true, force: true });

  renameSync(source, geneDir);
  rmSync(metaPath(genesDir, name), { force: true });

  return {
    name,
    restoredTo: geneDir,
    replacedAt: meta?.replacedAt ?? "",
    replacedVersion: meta?.replacedVersion ?? null,
  };
}
