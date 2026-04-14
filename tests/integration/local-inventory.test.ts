import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { listLocalGenes } from "../../src/tools.js";
import { PLAYGROUND_ROOT } from "../support/external-deps.js";

const hasPlayground = PLAYGROUND_ROOT !== null && existsSync(join(PLAYGROUND_ROOT, "genes"));

describe.skipIf(!hasPlayground)("list_local_genes", () => {
  it("scans playground genes", () => {
    const result = listLocalGenes({ project_root: PLAYGROUND_ROOT! });
    expect(result.total).toBeGreaterThan(0);
    expect(result.genes.length).toBe(result.total);
  });

  it("every gene has required fields", () => {
    const result = listLocalGenes({ project_root: PLAYGROUND_ROOT! });
    for (const gene of result.genes) {
      expect(gene.name).toBeTruthy();
      expect(gene.domain).toBeTruthy();
      expect(typeof gene.fidelity).toBe("string");
      expect(typeof gene.hasWasm).toBe("boolean");
      expect(typeof gene.hasSource).toBe("boolean");
    }
  });

  it("filters by domain", () => {
    const result = listLocalGenes({ project_root: PLAYGROUND_ROOT!, domain: "code" });
    expect(result.total).toBeGreaterThan(0);
    for (const gene of result.genes) {
      expect(gene.domain === "code" || gene.domain.startsWith("code.")).toBe(true);
    }
  });

  it("filters by fidelity", () => {
    const result = listLocalGenes({
      project_root: PLAYGROUND_ROOT!,
      fidelity: "Native",
    });
    for (const gene of result.genes) {
      expect(gene.fidelity).toBe("Native");
    }
  });

  it("results are sorted", () => {
    const result = listLocalGenes({ project_root: PLAYGROUND_ROOT! });
    for (let i = 1; i < result.genes.length; i += 1) {
      const previous = result.genes[i - 1];
      const current = result.genes[i];
      const compare =
        previous.domain.localeCompare(current.domain) ||
        previous.name.localeCompare(current.name);
      expect(compare).toBeLessThanOrEqual(0);
    }
  });

  it("returns empty for nonexistent path", () => {
    const result = listLocalGenes({ project_root: "/tmp/rotifer_test_nonexistent_xyz" });
    expect(result.total).toBe(0);
  });

  it("handles combined filters", () => {
    const allGenes = listLocalGenes({ project_root: PLAYGROUND_ROOT! });
    const filtered = listLocalGenes({
      project_root: PLAYGROUND_ROOT!,
      domain: "content",
      fidelity: "Wrapped",
    });
    expect(filtered.total).toBeLessThanOrEqual(allGenes.total);
    for (const gene of filtered.genes) {
      expect(gene.domain.startsWith("content")).toBe(true);
      expect(gene.fidelity).toBe("Wrapped");
    }
  });
});
