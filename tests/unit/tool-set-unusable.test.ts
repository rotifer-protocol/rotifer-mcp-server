/**
 * A `--tools` declaration that names nothing this server has must stop the
 * server, not start one with zero tools.
 *
 * `--tools=core` (no such preset) used to resolve to the set {"core"}, which
 * filtered every tool away: tools/list returned nothing and stderr said
 * nothing, so a mistyped preset looked exactly like a broken install (T-88).
 * A partly unknown list still runs — a set written for a newer version keeps
 * working on an older one — but says which names it ignored.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkToolSet, resolveToolSet, ToolSetError, PRESETS } from "../../src/tool-sets.js";

const KNOWN = ["search_genes", "get_gene_detail", "install_gene", "vg_scan", "doctor", ...PRESETS.evolve, ...PRESETS.readonly];

describe("checkToolSet", () => {
  it("refuses a declaration that names no known tool, and lists the presets", () => {
    for (const declaration of ["core", "core,nonsense", "Evolv"]) {
      expect(() => checkToolSet(resolveToolSet(declaration), KNOWN), declaration).toThrow(ToolSetError);
    }
    try {
      checkToolSet(resolveToolSet("core"), KNOWN);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("core");
      for (const preset of Object.keys(PRESETS)) expect(message).toContain(preset);
      expect(message).toContain("--tools=search_genes,get_gene_detail");
    }
  });

  it("returns the names it will ignore when only some are unknown", () => {
    expect(checkToolSet(resolveToolSet("search_genes,serch_genes"), KNOWN)).toEqual(["serch_genes"]);
    expect(checkToolSet(resolveToolSet("evolve,core"), KNOWN)).toEqual(["core"]);
  });

  it("is silent for a valid declaration and for none at all", () => {
    expect(checkToolSet(resolveToolSet("evolve"), KNOWN)).toEqual([]);
    expect(checkToolSet(resolveToolSet("readonly,vg_scan"), KNOWN)).toEqual([]);
    expect(checkToolSet(resolveToolSet(undefined), KNOWN)).toEqual([]);
  });
});

/** The built server, started the way an MCP client starts it. */
function runServer(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "index.js"), ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ROTIFER_TELEMETRY: "0", DO_NOT_TRACK: "1", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    // A server that started (zero tools or not) waits on stdin forever.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stderr, timedOut: true });
    }, 5_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}

describe.runIf(existsSync(join(process.cwd(), "dist", "index.js")))("the built server with an unusable --tools", () => {
  it("exits 2 on --tools=core and names the valid presets", async () => {
    const r = await runServer(["--tools=core"]);
    expect(r.timedOut, "the server started instead of refusing").toBe(false);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("core");
    expect(r.stderr).toContain("evolve");
    expect(r.stderr).toContain("readonly");
  }, 15_000);

  it("does the same for ROTIFER_MCP_TOOLS", async () => {
    const r = await runServer([], { ROTIFER_MCP_TOOLS: "core" });
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("evolve");
  }, 15_000);

  it("still starts with a valid preset", async () => {
    const r = await runServer(["--tools=evolve"]);
    expect(r.timedOut, r.stderr).toBe(true);
  }, 15_000);
});
