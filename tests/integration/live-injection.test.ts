import { describe, expect, it } from "vitest";

import {
  developerProfile,
  getGeneDetail,
  searchGenes,
} from "../../src/tools.js";

const hasCloudKey = !!process.env.ROTIFER_CLOUD_ANON_KEY;
const describeCloud = hasCloudKey ? describe : describe.skip;

describeCloud("SQL injection via search query", { timeout: 15000 }, () => {
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

describeCloud("SQL injection via domain filter", { timeout: 15000 }, () => {
  it("handles injected domain value", async () => {
    const result = await searchGenes({ domain: "search.web; DELETE FROM genes" });
    expect(Array.isArray(result.genes)).toBe(true);
  });
});

describeCloud("XSS via query parameters", { timeout: 15000 }, () => {
  const payloads = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
  ];

  for (const payload of payloads) {
    it(`sanitizes: ${payload.slice(0, 30)}`, async () => {
      const result = await searchGenes({ query: payload });
      const json = JSON.stringify(result);
      expect(json).not.toContain("<script>");
      expect(json).not.toContain("onerror=");
    });
  }
});

describeCloud("gene ID injection", { timeout: 15000 }, () => {
  const payloads = [
    "../../etc/passwd",
    "'; DROP TABLE genes; --",
    "' OR '1'='1",
    "../../../.env",
  ];

  for (const payload of payloads) {
    it(`safely rejects: ${payload}`, async () => {
      await expect(getGeneDetail({ gene_id: payload })).rejects.toThrow();
    });
  }
});

describeCloud("username injection", { timeout: 15000 }, () => {
  const payloads = [
    "admin'--",
    "' OR '1'='1",
    "'; DROP TABLE profiles; --",
  ];

  for (const payload of payloads) {
    it(`safely rejects: ${payload}`, async () => {
      await expect(developerProfile({ username: payload })).rejects.toThrow();
    });
  }
});
