/**
 * Runs before every test file (vitest.config.ts `setupFiles`).
 *
 * The opt-out variables telemetry/consent.ts reads come from whoever runs the
 * suite. A developer with DO_NOT_TRACK=1 in their shell — a common setting —
 * saw 21 reporting tests fail, every one because nothing was sent, which reads
 * exactly like a reporting bug. Tests that exercise the opt-out set these
 * variables themselves; everything else starts from "not opted out".
 *
 * The stored choice is the same problem one step further (T-87): the opt-out
 * now also reads ~/.rotifer/telemetry.json, so a developer who ran
 * `rotifer telemetry off` would see the same 21 failures. Each test file gets
 * its own empty HOME; tests that exercise the stored choice write the file
 * into it themselves.
 *
 * Child processes spawned by the real-stdio integration tests inherit
 * process.env, so they start clean too.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

delete process.env.DO_NOT_TRACK;
delete process.env.ROTIFER_TELEMETRY;

const isolatedHome = mkdtempSync(join(tmpdir(), "rotifer-mcp-test-home-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

afterAll(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
});
