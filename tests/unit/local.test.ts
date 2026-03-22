import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { listLocalGenes } from "../../src/local.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function setupMockFs(genes: Record<string, { phenotype: any; cloud?: any; compiled?: any; hasWasm?: boolean; hasSource?: boolean }>) {
  const geneNames = Object.keys(genes);
  const genesDir = "/project/genes";

  vi.mocked(existsSync).mockImplementation((p: any) => {
    const path = String(p);
    if (path === "/project") return true;
    if (path === "/project/genes") return true;
    if (path === "/project/rotifer.json") return false;
    for (const name of geneNames) {
      if (path === `${genesDir}/${name}/phenotype.json`) return true;
      if (path === `${genesDir}/${name}/gene.ir.wasm`) return genes[name].hasWasm ?? false;
      if (path === `${genesDir}/${name}/index.ts`) return genes[name].hasSource ?? false;
    }
    return false;
  });

  vi.mocked(readdirSync).mockReturnValue(geneNames as any);

  vi.mocked(statSync).mockImplementation((p: any) => {
    return { isDirectory: () => geneNames.includes(String(p).split("/").pop()!) } as any;
  });

  vi.mocked(readFileSync).mockImplementation((p: any) => {
    const path = String(p);
    for (const name of geneNames) {
      if (path === `${genesDir}/${name}/phenotype.json`) return JSON.stringify(genes[name].phenotype);
      if (path === `${genesDir}/${name}/.cloud-manifest.json` && genes[name].cloud) return JSON.stringify(genes[name].cloud);
      if (path === `${genesDir}/${name}/.compile-result.json` && genes[name].compiled) return JSON.stringify(genes[name].compiled);
    }
    throw new Error(`ENOENT: ${path}`);
  });
}

describe("listLocalGenes", () => {
  it("scans genes directory and reads phenotype.json", () => {
    setupMockFs({
      "my-gene": { phenotype: { domain: "test.domain", fidelity: "Wrapped", description: "A test gene" } },
    });
    const result = listLocalGenes({ project_root: "/project" });
    expect(result.total).toBe(1);
    expect(result.genes[0].name).toBe("my-gene");
    expect(result.genes[0].domain).toBe("test.domain");
    expect(result.genes[0].fidelity).toBe("Wrapped");
  });

  it("skips directories without phenotype.json", () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path === "/project") return true;
      if (path === "/project/genes") return true;
      if (path === "/project/rotifer.json") return false;
      if (path === "/project/genes/valid/phenotype.json") return true;
      return false;
    });
    vi.mocked(readdirSync).mockReturnValue(["valid", "no-phenotype"] as any);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      if (String(p).includes("valid/phenotype.json")) return JSON.stringify({ domain: "d", fidelity: "Wrapped" });
      throw new Error("ENOENT");
    });

    const result = listLocalGenes({ project_root: "/project" });
    expect(result.total).toBe(1);
    expect(result.genes[0].name).toBe("valid");
  });

  it("enriches with .cloud-manifest.json when present", () => {
    setupMockFs({
      "cloud-gene": {
        phenotype: { domain: "test", fidelity: "Wrapped" },
        cloud: { cloud_id: "uuid-123", owner: "dev1", version: "0.1.0" },
      },
    });

    const result = listLocalGenes({ project_root: "/project" });
    expect(result.genes[0].cloud).toEqual({ id: "uuid-123", owner: "dev1", version: "0.1.0" });
  });

  it("enriches with .compile-result.json when present", () => {
    setupMockFs({
      "compiled-gene": {
        phenotype: { domain: "test", fidelity: "Native" },
        compiled: { irHash: "abc123", compiledAt: "2026-01-01", totalSize: 500000, wasmAvailable: true },
        hasWasm: true,
      },
    });

    const result = listLocalGenes({ project_root: "/project" });
    expect(result.genes[0].compiled?.ir_hash).toBe("abc123");
    expect(result.genes[0].has_wasm).toBe(true);
  });

  it("filters by domain prefix", () => {
    setupMockFs({
      "gene-a": { phenotype: { domain: "code.debug", fidelity: "Wrapped" } },
      "gene-b": { phenotype: { domain: "code.format", fidelity: "Wrapped" } },
      "gene-c": { phenotype: { domain: "search.web", fidelity: "Wrapped" } },
    });

    const result = listLocalGenes({ project_root: "/project", domain: "code" });
    expect(result.total).toBe(2);
    expect(result.genes.every((g) => g.domain.startsWith("code"))).toBe(true);
  });

  it("filters by exact fidelity", () => {
    setupMockFs({
      "native-gene": { phenotype: { domain: "d1", fidelity: "Native" } },
      "wrapped-gene": { phenotype: { domain: "d2", fidelity: "Wrapped" } },
    });

    const result = listLocalGenes({ project_root: "/project", fidelity: "Native" });
    expect(result.total).toBe(1);
    expect(result.genes[0].fidelity).toBe("Native");
  });

  it("sorts by domain then name", () => {
    setupMockFs({
      "beta": { phenotype: { domain: "a.domain", fidelity: "Wrapped" } },
      "alpha": { phenotype: { domain: "a.domain", fidelity: "Wrapped" } },
      "zeta": { phenotype: { domain: "b.domain", fidelity: "Wrapped" } },
    });

    const result = listLocalGenes({ project_root: "/project" });
    expect(result.genes.map((g) => g.name)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("returns empty for nonexistent path", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const result = listLocalGenes({ project_root: "/nonexistent" });
    expect(result.total).toBe(0);
    expect(result.genes).toEqual([]);
  });

  it("reads custom genes_dir from rotifer.json", () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path === "/project") return true;
      if (path === "/project/rotifer.json") return true;
      if (path === "/project/custom-genes") return true;
      if (path === "/project/custom-genes/g1/phenotype.json") return true;
      return false;
    });
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path === "/project/rotifer.json") return JSON.stringify({ genes_dir: "custom-genes" });
      if (path.includes("g1/phenotype.json")) return JSON.stringify({ domain: "d", fidelity: "Wrapped" });
      throw new Error("ENOENT");
    });
    vi.mocked(readdirSync).mockReturnValue(["g1"] as any);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);

    const result = listLocalGenes({ project_root: "/project" });
    expect(result.genes_dir).toContain("custom-genes");
    expect(result.total).toBe(1);
  });

  it("handles combined domain + fidelity filter", () => {
    setupMockFs({
      "a": { phenotype: { domain: "code.debug", fidelity: "Native" } },
      "b": { phenotype: { domain: "code.format", fidelity: "Wrapped" } },
      "c": { phenotype: { domain: "search.web", fidelity: "Native" } },
    });

    const result = listLocalGenes({ project_root: "/project", domain: "code", fidelity: "Native" });
    expect(result.total).toBe(1);
    expect(result.genes[0].name).toBe("a");
  });
});
