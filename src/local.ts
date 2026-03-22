import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

interface RotiferConfig {
  genes_dir: string;
}

interface Phenotype {
  domain: string;
  description?: string;
  version?: string;
  author?: string;
  fidelity?: string;
  transparency?: string;
  source?: string;
  dependencies?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface CloudManifest {
  cloud_id: string;
  owner: string;
  version: string;
  published_at?: string;
  installed_at?: string;
}

interface CompileResult {
  irHash: string;
  wasmAvailable: boolean;
  compiledAt: string;
  totalSize?: number;
}

export interface LocalGene {
  name: string;
  path: string;
  domain: string;
  fidelity: string;
  version: string | null;
  author: string | null;
  description: string | null;
  has_wasm: boolean;
  has_source: boolean;
  cloud?: { id: string; owner: string; version: string };
  compiled?: { ir_hash: string; compiled_at: string; wasm_size: number | null };
}

export interface ListLocalGenesResult {
  project_root: string;
  genes_dir: string;
  genes: LocalGene[];
  total: number;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function resolveProjectRoot(hint?: string): string {
  if (hint && existsSync(hint)) return hint;
  return process.cwd();
}

function resolveGenesDir(root: string): string {
  const config = readJson<RotiferConfig>(join(root, "rotifer.json"));
  return join(root, config?.genes_dir || "genes");
}

export function listLocalGenes(options: {
  project_root?: string;
  domain?: string;
  fidelity?: string;
}): ListLocalGenesResult {
  const root = resolveProjectRoot(options.project_root);
  const genesDir = resolveGenesDir(root);

  if (!existsSync(genesDir)) {
    return { project_root: root, genes_dir: genesDir, genes: [], total: 0 };
  }

  let entries: string[];
  try {
    entries = readdirSync(genesDir).filter((name) => {
      const p = join(genesDir, name);
      return statSync(p).isDirectory() && existsSync(join(p, "phenotype.json"));
    });
  } catch {
    return { project_root: root, genes_dir: genesDir, genes: [], total: 0 };
  }

  let genes: LocalGene[] = entries.map((name) => {
    const geneDir = join(genesDir, name);
    const phenotype = readJson<Phenotype>(join(geneDir, "phenotype.json"));
    const cloud = readJson<CloudManifest>(join(geneDir, ".cloud-manifest.json"));
    const compiled = readJson<CompileResult>(join(geneDir, ".compile-result.json"));

    return {
      name,
      path: geneDir,
      domain: phenotype?.domain || "unknown",
      fidelity: phenotype?.fidelity || "Unknown",
      version: phenotype?.version || cloud?.version || null,
      author: phenotype?.author || cloud?.owner || null,
      description: phenotype?.description || null,
      has_wasm: existsSync(join(geneDir, "gene.ir.wasm")),
      has_source: existsSync(join(geneDir, "index.ts")),
      ...(cloud && {
        cloud: { id: cloud.cloud_id, owner: cloud.owner, version: cloud.version },
      }),
      ...(compiled && {
        compiled: {
          ir_hash: compiled.irHash,
          compiled_at: compiled.compiledAt,
          wasm_size: compiled.totalSize ?? null,
        },
      }),
    };
  });

  if (options.domain) {
    genes = genes.filter((g) => g.domain === options.domain || g.domain.startsWith(options.domain + "."));
  }
  if (options.fidelity) {
    genes = genes.filter((g) => g.fidelity === options.fidelity);
  }

  genes.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));

  return { project_root: root, genes_dir: genesDir, genes, total: genes.length };
}

// ── Local Agent scanning ──

export interface LocalAgent {
  id: string;
  name: string;
  state: string;
  genome: string[];
  composition: Record<string, unknown>;
  strategy: string;
  created_at: string;
  reputation: number;
}

export interface ListLocalAgentsResult {
  project_root: string;
  agents_dir: string;
  agents: LocalAgent[];
  total: number;
}

export function listLocalAgents(options: {
  project_root?: string;
  state?: string;
}): ListLocalAgentsResult {
  const root = resolveProjectRoot(options.project_root);
  const agentsDir = join(root, ".rotifer", "agents");

  if (!existsSync(agentsDir)) {
    return { project_root: root, agents_dir: agentsDir, agents: [], total: 0 };
  }

  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { project_root: root, agents_dir: agentsDir, agents: [], total: 0 };
  }

  let agents: LocalAgent[] = files
    .map((f) => {
      const raw = readJson<any>(join(agentsDir, f));
      if (!raw || !raw.id || !raw.name) return null;
      return {
        id: raw.id,
        name: raw.name,
        state: raw.state || "Unknown",
        genome: Array.isArray(raw.genome) ? raw.genome : [],
        composition: raw.composition || { type: "Single" },
        strategy: raw.strategy || "manual",
        created_at: raw.createdAt || raw.created_at || "",
        reputation: raw.reputation ?? 0,
      } satisfies LocalAgent;
    })
    .filter((a): a is LocalAgent => a !== null);

  if (options.state) {
    agents = agents.filter(
      (a) => a.state.toLowerCase() === options.state!.toLowerCase()
    );
  }

  agents.sort(
    (a, b) => (b.created_at || "").localeCompare(a.created_at || "")
  );

  return { project_root: root, agents_dir: agentsDir, agents, total: agents.length };
}

// ── Agent creation ──

export interface CreateAgentResult {
  id: string;
  name: string;
  state: string;
  genome: string[];
  composition: Record<string, unknown>;
  strategy: string;
  created_at: string;
}

export function createLocalAgent(options: {
  project_root?: string;
  name: string;
  genes: string[];
  composition?: string;
}): CreateAgentResult {
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");

  const root = resolveProjectRoot(options.project_root);
  const genesDir = resolveGenesDir(root);
  const agentsDir = join(root, ".rotifer", "agents");
  mkdirSync(agentsDir, { recursive: true });

  for (const geneName of options.genes) {
    const phenoPath = join(genesDir, geneName, "phenotype.json");
    if (!existsSync(phenoPath)) {
      throw new Error(`Gene '${geneName}' not found at ${phenoPath}. Run 'rotifer wrap ${geneName}' first.`);
    }
  }

  const agentId = randomUUID();
  const compositionType = options.genes.length >= 2
    ? (options.composition || "Seq")
    : "Single";

  let composition: Record<string, unknown> = { type: compositionType };
  if (compositionType === "Par") {
    composition = { type: "Par", branches: options.genes, merge: "first" };
  } else if (compositionType === "Try" && options.genes.length >= 2) {
    composition = { type: "Try", primary: options.genes[0], fallback: options.genes[1] };
  }

  const agent = {
    id: agentId,
    name: options.name,
    state: "Active",
    genome: options.genes,
    composition,
    strategy: "manual",
    createdAt: new Date().toISOString(),
    reputation: 0.0,
  };

  writeFileSync(
    join(agentsDir, agentId + ".json"),
    JSON.stringify(agent, null, 2) + "\n"
  );

  return {
    id: agentId,
    name: agent.name,
    state: agent.state,
    genome: agent.genome,
    composition: agent.composition,
    strategy: agent.strategy,
    created_at: agent.createdAt,
  };
}

// ── Phase 4: Shell-out operations ──

export interface ShellResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
}

function shellExec(cmd: string, args: string[], cwd?: string): ShellResult {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const result = spawnSync(cmd, args, {
    cwd: cwd || process.cwd(),
    timeout: 120_000,
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    success: result.status === 0,
    exit_code: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function resolveRotiferBin(): string {
  const npxResult = shellExec("which", ["rotifer"]);
  if (npxResult.success && npxResult.stdout) return npxResult.stdout;
  return "npx";
}

function rotiferCmd(args: string[], cwd?: string): ShellResult {
  const bin = resolveRotiferBin();
  if (bin === "npx") {
    return shellExec("npx", ["rotifer", ...args], cwd);
  }
  return shellExec(bin, args, cwd);
}

export function agentRun(options: {
  agent_id: string;
  project_root?: string;
  input?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["agent", "run", options.agent_id];
  if (options.input) {
    args.push("--input", options.input);
  }
  return rotiferCmd(args, root);
}

export function compileGene(options: {
  gene_name: string;
  project_root?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  return rotiferCmd(["compile", options.gene_name], root);
}

export function runGene(options: {
  gene_name: string;
  project_root?: string;
  input?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["run", options.gene_name];
  if (options.input) {
    args.push("--input", options.input);
  }
  return rotiferCmd(args, root);
}

// ── Creation-side operations ──

export function initGene(options: {
  name: string;
  project_root?: string;
  fidelity?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["init", options.name];
  if (options.fidelity) {
    args.push("--fidelity", options.fidelity);
  }
  return rotiferCmd(args, root);
}

export function scanGenes(options: {
  path?: string;
  project_root?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["scan"];
  if (options.path) {
    args.push(options.path);
  }
  return rotiferCmd(args, root);
}

export function wrapGene(options: {
  name: string;
  project_root?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  return rotiferCmd(["wrap", options.name], root);
}

export function testGene(options: {
  name?: string;
  project_root?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["test"];
  if (options.name) {
    args.push(options.name);
  }
  return rotiferCmd(args, root);
}

export function publishGene(options: {
  name?: string;
  project_root?: string;
  all?: boolean;
  skip_arena?: boolean;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["publish"];
  if (options.all) {
    args.push("--all");
  } else if (options.name) {
    args.push(options.name);
  }
  if (options.skip_arena) {
    args.push("--skip-arena");
  }
  return rotiferCmd(args, root);
}
