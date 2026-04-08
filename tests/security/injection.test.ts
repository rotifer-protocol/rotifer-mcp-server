import { describe, it, expect } from "vitest";
import { searchGenes, getGeneDetail, developerProfile, listLocalGenes } from "../../src/tools.js";

describe("SQL injection via search query", { timeout: 15000 }, () => {
  const payloads = [
    "'; DROP TABLE genes; --",
    "1 OR 1=1",
    "UNION SELECT * FROM profiles",
    "'; UPDATE genes SET published=true; --",
    "1; SELECT pg_sleep(5); --",
  ];

  for (const payload of payloads) {
    it(`safely handles: ${payload.slice(0, 40)}`, async () => {
      const result = await searchGenes({ query: payload });
      expect(result.page).toBe(1);
      expect(Array.isArray(result.genes)).toBe(true);
    });
  }
});

describe("SQL injection via domain filter", { timeout: 15000 }, () => {
  it("handles injected domain value", async () => {
    const result = await searchGenes({ domain: "search.web; DELETE FROM genes" });
    expect(Array.isArray(result.genes)).toBe(true);
  });
});

describe("XSS via query parameters", { timeout: 15000 }, () => {
  const xssPayloads = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
  ];

  for (const payload of xssPayloads) {
    it(`sanitizes: ${payload.slice(0, 30)}`, async () => {
      const result = await searchGenes({ query: payload });
      const json = JSON.stringify(result);
      expect(json).not.toContain("<script>");
      expect(json).not.toContain("onerror=");
    });
  }
});

describe("gene ID injection", { timeout: 15000 }, () => {
  const idPayloads = [
    "../../etc/passwd",
    "'; DROP TABLE genes; --",
    "' OR '1'='1",
    "../../../.env",
  ];

  for (const payload of idPayloads) {
    it(`safely rejects: ${payload}`, async () => {
      await expect(getGeneDetail({ gene_id: payload })).rejects.toThrow();
    });
  }
});

describe("username injection", { timeout: 15000 }, () => {
  const userPayloads = [
    "admin'--",
    "' OR '1'='1",
    "'; DROP TABLE profiles; --",
  ];

  for (const payload of userPayloads) {
    it(`safely rejects: ${payload}`, async () => {
      await expect(developerProfile({ username: payload })).rejects.toThrow();
    });
  }
});

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
