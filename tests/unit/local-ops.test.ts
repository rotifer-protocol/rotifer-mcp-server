import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomUUID: vi.fn(() => "agent-uuid-123"),
  };
});

import {
  agentRun,
  compileGene,
  createLocalAgent,
  initGene,
  listLocalAgents,
  publishGene,
  runGene,
  scanGenes,
  testGene,
  vgScan,
  wrapGene,
} from "../../src/local.js";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";

function mockSpawnSequence(...results: Array<Partial<ReturnType<typeof spawnSync>>>) {
  vi.mocked(spawnSync).mockReset();
  for (const result of results) {
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 1,
      output: [],
      stdout: "",
      stderr: "",
      status: 0,
      signal: null,
      ...result,
    } as ReturnType<typeof spawnSync>);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listLocalAgents", () => {
  it("returns empty when agents directory is missing", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = listLocalAgents({ project_root: "/project" });

    expect(result.total).toBe(0);
    expect(result.agents).toEqual([]);
  });

  it("loads, filters, and sorts agent snapshots", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["a.json", "b.json", "broken.json"] as any);
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      const file = String(path);
      if (file.endsWith("a.json")) {
        return JSON.stringify({
          id: "a",
          name: "alpha",
          state: "Active",
          genome: ["g1"],
          createdAt: "2026-01-01T00:00:00Z",
        });
      }
      if (file.endsWith("b.json")) {
        return JSON.stringify({
          id: "b",
          name: "beta",
          state: "paused",
          genome: ["g2"],
          created_at: "2026-02-01T00:00:00Z",
        });
      }
      throw new Error("bad json");
    });

    const filtered = listLocalAgents({ project_root: "/project", state: "PAUSED" });

    expect(filtered.total).toBe(1);
    expect(filtered.agents[0].id).toBe("b");

    const all = listLocalAgents({ project_root: "/project" });
    expect(all.agents.map((agent) => agent.id)).toEqual(["b", "a"]);
  });
});

describe("createLocalAgent", () => {
  it("rejects missing gene_ids", () => {
    expect(() =>
      createLocalAgent({
        project_root: "/project",
        agent_name: "demo-agent",
        gene_ids: [],
      }),
    ).toThrow("gene_ids");
  });

  it("rejects unknown genes before writing files", () => {
    vi.mocked(existsSync).mockImplementation((path: any) => {
      const file = String(path);
      return file === "/project";
    });

    expect(() =>
      createLocalAgent({
        project_root: "/project",
        agent_name: "demo-agent",
        gene_ids: ["missing-gene"],
      }),
    ).toThrow("missing-gene");
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  it("writes a Par composition with default merge strategy", () => {
    vi.mocked(existsSync).mockImplementation((path: any) => {
      const file = String(path);
      return (
        file === "/project" ||
        file === "/project/genes/alpha/phenotype.json" ||
        file === "/project/genes/beta/phenotype.json"
      );
    });

    const result = createLocalAgent({
      project_root: "/project",
      agent_name: "demo-agent",
      gene_ids: ["alpha", "beta"],
      composition: "Par",
    });

    expect(result.id).toBe("agent-uuid-123");
    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith("/project/.rotifer/agents", {
      recursive: true,
    });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1);
    const [, raw] = vi.mocked(writeFileSync).mock.calls[0];
    const saved = JSON.parse(String(raw));
    expect(saved.composition).toEqual({
      type: "Par",
      branches: ["alpha", "beta"],
      merge: "first",
    });
  });

  it("supports TryPool composition", () => {
    vi.mocked(existsSync).mockImplementation((path: any) => {
      const file = String(path);
      return (
        file === "/project" ||
        file === "/project/genes/alpha/phenotype.json" ||
        file === "/project/genes/beta/phenotype.json"
      );
    });

    createLocalAgent({
      project_root: "/project",
      agent_name: "pool-agent",
      gene_ids: ["alpha", "beta"],
      composition: "TryPool",
    });

    const [, raw] = vi.mocked(writeFileSync).mock.calls[0];
    const saved = JSON.parse(String(raw));
    expect(saved.composition).toEqual({
      type: "TryPool",
      pool: ["alpha", "beta"],
    });
  });
});

describe("shell-backed local commands", () => {
  it("falls back to npx when the rotifer binary is absent", () => {
    mockSpawnSequence(
      { status: 1, stdout: "", stderr: "" },
      { status: 0, stdout: "ok", stderr: "" },
    );

    const result = agentRun({
      project_root: "/project",
      agent_name: "demo-agent",
      input: "hello",
      verbose: true,
      no_sandbox: true,
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(spawnSync)).toHaveBeenNthCalledWith(
      2,
      "npx",
      ["rotifer", "agent", "run", "demo-agent", "--input", "hello", "--isVerbose", "--no-sandbox"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("uses the installed rotifer binary when available", () => {
    mockSpawnSequence(
      { status: 0, stdout: "/usr/local/bin/rotifer\n", stderr: "" },
      { status: 0, stdout: "compiled", stderr: "" },
    );

    compileGene({
      project_root: "/project",
      gene_name: "alpha",
      check: true,
      wasm_path: "dist/out.wasm",
      lang: "ts",
    });

    expect(vi.mocked(spawnSync)).toHaveBeenNthCalledWith(
      2,
      "/usr/local/bin/rotifer",
      ["compile", "alpha", "--check", "--wasm", "dist/out.wasm", "--lang", "ts"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("passes option flags through the helper wrappers", () => {
    mockSpawnSequence(
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
    );

    runGene({
      project_root: "/project",
      gene_name: "alpha",
      input: "demo",
      verbose: true,
      no_sandbox: true,
      trust_unsigned: true,
    });
    initGene({
      project_root: "/project",
      gene_name: "alpha",
      fidelity: "Wrapped",
      domain: "search.web",
      no_genesis: true,
    });
    scanGenes({
      project_root: "/project",
      path: "genes",
      skills: true,
      skills_path: "skills",
    });
    wrapGene({
      project_root: "/project",
      gene_name: "alpha",
      domain: "search.web",
      fidelity: "Wrapped",
      from_skill: "skill-id",
      from_clawhub: "clawhub-id",
    });
    testGene({
      project_root: "/project",
      gene_name: "alpha",
      verbose: true,
      compliance: true,
    });
    publishGene({
      project_root: "/project",
      all: true,
      skip_arena: true,
      description: "desc",
      changelog: "changes",
      skip_security: true,
    });

    const calls = vi.mocked(spawnSync).mock.calls.filter(([command]) => command !== "which");
    expect(calls.map(([command, args]) => [command, args])).toEqual([
      ["npx", ["rotifer", "run", "alpha", "--input", "demo", "--verbose", "--no-sandbox", "--trust-unsigned"]],
      ["npx", ["rotifer", "init", "alpha", "--fidelity", "Wrapped", "--domain", "search.web", "--no-genesis"]],
      ["npx", ["rotifer", "scan", "genes", "--skills", "--skills-path", "skills"]],
      ["npx", ["rotifer", "wrap", "alpha", "--domain", "search.web", "--fidelity", "Wrapped", "--from-skill", "skill-id", "--from-clawhub", "clawhub-id"]],
      ["npx", ["rotifer", "test", "alpha", "--verbose", "--compliance"]],
      ["npx", ["rotifer", "publish", "--all", "--skip-arena", "--description", "desc", "--changelog", "changes", "--skip-security"]],
    ]);
  });
});

describe("vgScan", () => {
  it("parses successful JSON output", () => {
    mockSpawnSequence(
      { status: 0, stdout: "/usr/local/bin/rotifer\n", stderr: "" },
      {
        status: 0,
        stdout: JSON.stringify({
          grade: "A",
          skill_id: "skill-1",
          findings: [],
          stats: { files_scanned: 2, lines_of_code: 10 },
        }),
        stderr: "",
      },
    );

    const result = vgScan({
      project_root: "/project",
      path: "genes",
      gene_id: "gene-1",
      all: true,
    });

    expect(result.grade).toBe("A");
    expect(vi.mocked(spawnSync)).toHaveBeenNthCalledWith(
      2,
      "/usr/local/bin/rotifer",
      ["vg", "genes", "--json", "--id", "gene-1", "--all"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("surfaces shell and parse failures", () => {
    mockSpawnSequence(
      { status: 0, stdout: "/usr/local/bin/rotifer\n", stderr: "" },
      { status: 1, stdout: "", stderr: "scan failed" },
    );
    expect(() => vgScan({ project_root: "/project" })).toThrow("scan failed");

    mockSpawnSequence(
      { status: 0, stdout: "/usr/local/bin/rotifer\n", stderr: "" },
      { status: 0, stdout: "not json", stderr: "" },
    );
    expect(() => vgScan({ project_root: "/project" })).toThrow("Failed to parse V(g) scan output");
  });
});
