import { describe, expect, it } from "vitest";
import { normaliseHostName, resolveMcpChannel } from "../../src/channel.js";

/**
 * The channel is how the ledger tells "someone ran a Gene from DSH" apart from
 * "someone ran one from a terminal" — the question ADR-321 left unanswerable.
 *
 * Its input is the client's self-declared `initialize` name: arbitrary text
 * from outside this process. These tests are mostly about what happens to text
 * that is not a tidy identifier, because that is the normal case.
 */
describe("normaliseHostName", () => {
  it.each([
    ["Claude Code", "claude_code"],
    ["claude-code", "claude_code"],
    ["Claude  Code", "claude_code"],
    ["CURSOR", "cursor"],
    ["dsh", "dsh"],
    ["  OpenClaw  ", "openclaw"],
    ["deepseek.harness", "deepseek_harness"],
  ])("folds %j to %j", (raw, expected) => {
    expect(normaliseHostName(raw)).toBe(expected);
  });

  it("folds the spellings of one host onto one value", () => {
    // The whole point: three plausible spellings of the same client must not
    // become three rows in every aggregate that groups by this column.
    const spellings = ["Claude Code", "claude-code", "claude_code", "CLAUDE CODE"];
    const folded = new Set(spellings.map(normaliseHostName));
    expect(folded.size).toBe(1);
  });

  it.each([
    [undefined, "absent"],
    [null, "null"],
    ["", "empty"],
    ["   ", "whitespace only"],
    ["---", "punctuation only, nothing survives folding"],
    ["!@#$%", "symbols only"],
  ])("returns null for %j (%s)", (raw) => {
    expect(normaliseHostName(raw as string | undefined | null)).toBeNull();
  });

  it("refuses an over-long name rather than truncating it", () => {
    // A clipped name would silently merge with any other host sharing that
    // prefix — a wrong attribution is worse than a missing one.
    expect(normaliseHostName("x".repeat(33))).toBeNull();
    expect(normaliseHostName("x".repeat(32))).toBe("x".repeat(32));
  });

  it("is not fooled by a non-string", () => {
    expect(normaliseHostName(42 as unknown as string)).toBeNull();
    expect(normaliseHostName({} as unknown as string)).toBeNull();
  });
});

describe("resolveMcpChannel", () => {
  it("qualifies the transport with the host when the client named itself", () => {
    expect(resolveMcpChannel("DSH")).toBe("mcp:dsh");
    expect(resolveMcpChannel("Claude Code")).toBe("mcp:claude_code");
  });

  it("still says mcp when the client did not identify itself", () => {
    // Strictly more than the ledger knows today: it separates MCP traffic from
    // direct CLI runs even without a host name.
    expect(resolveMcpChannel(undefined)).toBe("mcp");
    expect(resolveMcpChannel("")).toBe("mcp");
    expect(resolveMcpChannel("!!!")).toBe("mcp");
  });

  it("always produces a value the registry's CHECK constraint accepts", () => {
    // Mirrored from migration 20260830000000. If this ever diverges the report
    // is rejected server-side and, being fire-and-forget, fails silently.
    const shape = /^[a-z0-9_]{1,32}(:[a-z0-9_]{1,32})?$/;
    const hostile = [
      "DSH", "Claude Code", "a".repeat(200), "", "   ", "!@#", "x:y:z",
      "emoji 🐛 host", "tab\there", "new\nline", "../../etc/passwd", "'; DROP TABLE--",
    ];
    for (const raw of hostile) {
      expect(resolveMcpChannel(raw)).toMatch(shape);
    }
  });
});
