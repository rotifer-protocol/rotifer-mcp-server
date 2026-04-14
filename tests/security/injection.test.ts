import { describe, it, expect } from "vitest";
import { listLocalGenes } from "../../src/tools.js";

describe("path traversal in list_local_genes", () => {
  it("does not crash with parent directory traversal", () => {
    const result = listLocalGenes({ project_root: "../../" });
    expect(typeof result.total).toBe("number");
  });

  it("does not expose /etc files", () => {
    const result = listLocalGenes({ project_root: "/etc" });
    for (const g of result.genes) {
      expect(g.name).not.toContain("passwd");
      expect(g.name).not.toContain("shadow");
    }
  });

  it("handles deeply nested traversal", () => {
    const result = listLocalGenes({ project_root: "../../../../../../../tmp" });
    expect(typeof result.total).toBe("number");
  });
});
