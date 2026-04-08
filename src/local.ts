import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

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
  wasmSize?: number;
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
  hasWasm: boolean;
  hasSource: boolean;
  cloud?: { id: string; owner: string; version: string };
  compiled?: { irHash: string; compiledAt: string; wasmSize: number | null };
}

export interface ListLocalGenesResult {
  projectRoot: string;
  genesDir: string;
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
    return { projectRoot: root, genesDir, genes: [], total: 0 };
  }

  let entries: string[];
  try {
    entries = readdirSync(genesDir).filter((name) => {
      const p = join(genesDir, name);
      return statSync(p).isDirectory() && existsSync(join(p, "phenotype.json"));
    });
  } catch {
    return { projectRoot: root, genesDir, genes: [], total: 0 };
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
      hasWasm: existsSync(join(geneDir, "gene.ir.wasm")),
      hasSource: existsSync(join(geneDir, "index.ts")),
      ...(cloud && {
        cloud: { id: cloud.cloud_id, owner: cloud.owner, version: cloud.version },
      }),
      ...(compiled && {
        compiled: {
          irHash: compiled.irHash,
          compiledAt: compiled.compiledAt,
          wasmSize: compiled.wasmSize ?? compiled.totalSize ?? null,
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

  return { projectRoot: root, genesDir, genes, total: genes.length };
}

// ── Local Agent scanning ──

export interface LocalAgent {
  id: string;
  name: string;
  state: string;
  genome: string[];
  composition: Record<string, unknown>;
  strategy: string;
  createdAt: string;
  reputation: number;
}

export interface ListLocalAgentsResult {
  projectRoot: string;
  agentsDir: string;
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
    return { projectRoot: root, agentsDir, agents: [], total: 0 };
  }

  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { projectRoot: root, agentsDir, agents: [], total: 0 };
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
        createdAt: raw.createdAt || raw.created_at || "",
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
    (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  return { projectRoot: root, agentsDir, agents, total: agents.length };
}

// ── Agent creation ──

export interface CreateAgentResult {
  id: string;
  name: string;
  state: string;
  genome: string[];
  composition: Record<string, unknown>;
  strategy: string;
  createdAt: string;
}

export function createLocalAgent(options: {
  project_root?: string;
  agent_name: string;
  gene_ids?: string[];
  composition?: string;
  domain?: string;
  strategy?: string;
  par_merge?: string;
}): CreateAgentResult {
  const root = resolveProjectRoot(options.project_root);
  const genesDir = resolveGenesDir(root);
  const agentsDir = join(root, ".rotifer", "agents");
  mkdirSync(agentsDir, { recursive: true });

  const genes = options.gene_ids || [];
  if (genes.length === 0) {
    throw new Error("'gene_ids' is required with at least one gene name. Wrap genes first with 'rotifer wrap <gene-name>'.");
  }

  for (const geneName of genes) {
    const phenoPath = join(genesDir, geneName, "phenotype.json");
    if (!existsSync(phenoPath)) {
      throw new Error(`Gene '${geneName}' not found at ${phenoPath}. Run 'rotifer wrap ${geneName}' first.`);
    }
  }

  const agentId = randomUUID();
  const compositionType = genes.length >= 2
    ? (options.composition || "Seq")
    : (genes.length === 1 ? "Single" : (options.composition || "Seq"));

  const mergeStrategy = options.par_merge || "first";
  let composition: Record<string, unknown> = { type: compositionType };
  if (compositionType === "Par") {
    composition = { type: "Par", branches: genes, merge: mergeStrategy };
  } else if (compositionType === "Try" && genes.length >= 2) {
    composition = { type: "Try", primary: genes[0], fallback: genes[1] };
  } else if (compositionType === "Cond" && genes.length >= 2) {
    composition = { type: "Cond", thenBranch: genes[0], elseBranch: genes[1] };
  } else if (compositionType === "TryPool") {
    composition = { type: "TryPool", pool: genes };
  }

  const agent = {
    id: agentId,
    name: options.agent_name,
    state: "Active",
    genome: genes,
    composition,
    strategy: options.strategy || "manual",
    createdAt: new Date().toISOString(),
    reputation: 0.0,
    ...(options.domain && { domain: options.domain }),
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
    createdAt: agent.createdAt,
  };
}

// ── Phase 4: Shell-out operations ──

export interface ShellResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function shellExec(cmd: string, args: string[], cwd?: string): ShellResult {
  const result = spawnSync(cmd, args, {
    cwd: cwd || process.cwd(),
    timeout: 120_000,
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    success: result.status === 0,
    exitCode: result.status ?? 1,
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
  agent_name: string;
  project_root?: string;
  input?: string;
  verbose?: boolean;
  no_sandbox?: boolean;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["agent", "run", options.agent_name];
  if (options.input) {
    args.push("--input", options.input);
  }
  if (options.verbose) args.push("--isVerbose");
  if (options.no_sandbox) args.push("--no-sandbox");
  return rotiferCmd(args, root);
}

export function compileGene(options: {
  gene_name: string;
  project_root?: string;
  check?: boolean;
  wasm_path?: string;
  lang?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["compile", options.gene_name];
  if (options.check) args.push("--check");
  if (options.wasm_path) args.push("--wasm", options.wasm_path);
  if (options.lang) args.push("--lang", options.lang);
  return rotiferCmd(args, root);
}

export function runGene(options: {
  gene_name: string;
  project_root?: string;
  input?: string;
  verbose?: boolean;
  no_sandbox?: boolean;
  trust_unsigned?: boolean;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["run", options.gene_name];
  if (options.input) args.push("--input", options.input);
  if (options.verbose) args.push("--verbose");
  if (options.no_sandbox) args.push("--no-sandbox");
  if (options.trust_unsigned) args.push("--trust-unsigned");
  return rotiferCmd(args, root);
}

// ── Creation-side operations ──

export function initGene(options: {
  gene_name: string;
  project_root?: string;
  fidelity?: string;
  domain?: string;
  no_genesis?: boolean;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["init", options.gene_name];
  if (options.fidelity) args.push("--fidelity", options.fidelity);
  if (options.domain) args.push("--domain", options.domain);
  if (options.no_genesis) args.push("--no-genesis");
  return rotiferCmd(args, root);
}

export function scanGenes(options: {
  path?: string;
  project_root?: string;
  skills?: boolean;
  skills_path?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["scan"];
  if (options.path) args.push(options.path);
  if (options.skills) args.push("--skills");
  if (options.skills_path) args.push("--skills-path", options.skills_path);
  return rotiferCmd(args, root);
}

export function wrapGene(options: {
  gene_name: string;
  project_root?: string;
  domain?: string;
  fidelity?: string;
  from_skill?: string;
  from_clawhub?: string;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["wrap", options.gene_name];
  if (options.domain) args.push("--domain", options.domain);
  if (options.fidelity) args.push("--fidelity", options.fidelity);
  if (options.from_skill) args.push("--from-skill", options.from_skill);
  if (options.from_clawhub) args.push("--from-clawhub", options.from_clawhub);
  return rotiferCmd(args, root);
}

export function testGene(options: {
  gene_name: string;
  project_root?: string;
  verbose?: boolean;
  compliance?: boolean;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["test", options.gene_name];
  if (options.verbose) args.push("--verbose");
  if (options.compliance) args.push("--compliance");
  return rotiferCmd(args, root);
}

export function publishGene(options: {
  gene_name?: string;
  project_root?: string;
  all?: boolean;
  skip_arena?: boolean;
  description?: string;
  changelog?: string;
  skip_security?: boolean;
}): ShellResult {
  const root = resolveProjectRoot(options.project_root);
  const args = ["publish"];
  if (options.all) {
    args.push("--all");
  } else if (options.gene_name) {
    args.push(options.gene_name);
  }
  if (options.skip_arena) args.push("--skip-arena");
  if (options.description) args.push("--description", options.description);
  if (options.changelog) args.push("--changelog", options.changelog);
  if (options.skip_security) args.push("--skip-security");
  return rotiferCmd(args, root);
}

export function vgScan(options: {
  path?: string;
  project_root?: string;
  gene_id?: string;
  all?: boolean;
}): { grade: string; skill_id: string; findings: unknown[]; stats: { files_scanned: number; lines_of_code: number } } {
  const root = resolveProjectRoot(options.project_root);
  const scanPath = options.path || ".";
  const args = ["vg", scanPath, "--json"];
  if (options.gene_id) args.push("--id", options.gene_id);
  if (options.all) args.push("--all");
  const result = rotiferCmd(args, root);
  if (!result.success) {
    throw new Error(result.stderr || "V(g) scan failed");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Failed to parse V(g) scan output: " + result.stdout.slice(0, 200));
  }
}
