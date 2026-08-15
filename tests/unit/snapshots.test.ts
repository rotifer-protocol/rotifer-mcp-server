import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { snapshotGene, restoreGene, listSnapshots } from "../../src/snapshots.js";

// Real filesystem rather than mocks: what is being tested is that a directory
// genuinely survives being overwritten, and a mocked fs would happily pass
// while the real one lost the files.
let genesDir: string;

function installGene(name: string, marker: string, version?: string): string {
  const dir = join(genesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "phenotype.json"), JSON.stringify({ name, marker }));
  writeFileSync(join(dir, "index.ts"), `// ${marker}\n`);
  if (version) {
    writeFileSync(join(dir, ".cloud-manifest.json"), JSON.stringify({ version }));
  }
  return dir;
}

const markerOf = (dir: string): string =>
  JSON.parse(readFileSync(join(dir, "phenotype.json"), "utf-8")).marker;

beforeEach(() => {
  genesDir = join(mkdtempSync(join(tmpdir(), "rotifer-snap-")), "genes");
  mkdirSync(genesDir, { recursive: true });
});

afterEach(() => {
  rmSync(genesDir, { recursive: true, force: true });
});

describe("snapshotGene", () => {
  it("moves the installed copy aside and records what it was", () => {
    installGene("formatter", "v1", "1.0.0");

    const meta = snapshotGene(genesDir, "formatter", "gene-abc");

    expect(meta).toMatchObject({
      name: "formatter",
      replacedBy: "gene-abc",
      replacedVersion: "1.0.0",
    });
    expect(existsSync(join(genesDir, "formatter"))).toBe(false);
    expect(markerOf(join(genesDir, ".snapshots", "formatter"))).toBe("v1");
  });

  it("returns null when there is nothing installed to snapshot", () => {
    expect(snapshotGene(genesDir, "never-installed")).toBeNull();
  });

  it("records a null version when the copy has no cloud manifest", () => {
    installGene("handwritten", "v1");
    expect(snapshotGene(genesDir, "handwritten")?.replacedVersion).toBeNull();
  });

  it("keeps one snapshot per Gene — the second overwrite supersedes the first", () => {
    installGene("formatter", "v1");
    snapshotGene(genesDir, "formatter");

    installGene("formatter", "v2");
    snapshotGene(genesDir, "formatter");

    // v1 is two upgrades stale; offering to restore it would be wrong.
    expect(markerOf(join(genesDir, ".snapshots", "formatter"))).toBe("v2");
    expect(listSnapshots(genesDir)).toHaveLength(1);
  });

  it("does not disturb other Genes' snapshots", () => {
    installGene("alpha", "a1");
    installGene("beta", "b1");
    snapshotGene(genesDir, "alpha");
    snapshotGene(genesDir, "beta");

    expect(listSnapshots(genesDir).map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("restoreGene", () => {
  it("puts the replaced copy back over whatever replaced it", () => {
    installGene("formatter", "original");
    snapshotGene(genesDir, "formatter");
    installGene("formatter", "replacement");

    const result = restoreGene(genesDir, "formatter");

    expect(markerOf(join(genesDir, "formatter"))).toBe("original");
    expect(result.restoredTo).toBe(join(genesDir, "formatter"));
  });

  it("restores every file, not just the phenotype", () => {
    installGene("formatter", "original", "1.0.0");
    snapshotGene(genesDir, "formatter");
    installGene("formatter", "replacement", "2.0.0");

    restoreGene(genesDir, "formatter");

    const dir = join(genesDir, "formatter");
    expect(readFileSync(join(dir, "index.ts"), "utf-8")).toContain("original");
    expect(JSON.parse(readFileSync(join(dir, ".cloud-manifest.json"), "utf-8")).version).toBe("1.0.0");
  });

  it("consumes the snapshot, so a second rollback cannot discard the restored copy", () => {
    installGene("formatter", "original");
    snapshotGene(genesDir, "formatter");
    installGene("formatter", "replacement");

    restoreGene(genesDir, "formatter");

    expect(listSnapshots(genesDir)).toHaveLength(0);
    expect(() => restoreGene(genesDir, "formatter")).toThrow(/No snapshot/);
    expect(markerOf(join(genesDir, "formatter"))).toBe("original");
  });

  it("names what is available when asked for a Gene with no snapshot", () => {
    installGene("alpha", "a1");
    snapshotGene(genesDir, "alpha");

    expect(() => restoreGene(genesDir, "beta")).toThrow(/Available: alpha/);
  });

  it("says nothing has been overwritten when there are no snapshots at all", () => {
    expect(() => restoreGene(genesDir, "anything")).toThrow(/Nothing has been overwritten/);
  });

  it("works when the Gene directory was deleted after the snapshot was taken", () => {
    installGene("formatter", "original");
    snapshotGene(genesDir, "formatter");
    // no reinstall — the user simply removed it

    restoreGene(genesDir, "formatter");

    expect(markerOf(join(genesDir, "formatter"))).toBe("original");
  });
});

describe("listSnapshots", () => {
  it("is empty for a project that has never overwritten anything", () => {
    expect(listSnapshots(genesDir)).toEqual([]);
  });

  it("orders by replacement time, newest first", () => {
    installGene("older", "o");
    snapshotGene(genesDir, "older", null, () => new Date("2026-01-01T00:00:00Z"));
    installGene("newer", "n");
    snapshotGene(genesDir, "newer", null, () => new Date("2026-06-01T00:00:00Z"));

    expect(listSnapshots(genesDir).map((s) => s.name)).toEqual(["newer", "older"]);
  });

  it("still reports a snapshot whose metadata is unreadable", () => {
    installGene("formatter", "v1");
    snapshotGene(genesDir, "formatter");
    writeFileSync(join(genesDir, ".snapshots", "formatter.json"), "{ not json");

    // The directory is what makes it restorable; hiding it because a sidecar
    // is corrupt would strand recoverable files.
    expect(listSnapshots(genesDir).map((s) => s.name)).toEqual(["formatter"]);
    expect(() => restoreGene(genesDir, "formatter")).not.toThrow();
  });
});
