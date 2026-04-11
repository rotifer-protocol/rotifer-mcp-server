import { existsSync } from "node:fs";
import { join } from "node:path";

export const MCP_SERVER_ROOT = join(import.meta.dirname, "../..");

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const PLAYGROUND_ROOT = firstExisting([
  join(MCP_SERVER_ROOT, "../rotifer-playground"),
  join(MCP_SERVER_ROOT, "rotifer-playground"),
]);
