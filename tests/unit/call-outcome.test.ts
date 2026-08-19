import { describe, it, expect } from "vitest";
import { toolCallSucceeded } from "../../src/call-outcome.js";

/**
 * `mcp_call_log.success` used to record whether the handler threw. These tools
 * report failure by *returning* it, so the ordinary failure — a gene that ran
 * and exited non-zero — was logged as a success and `get_mcp_stats` reported a
 * rate that could not go down.
 *
 * The rule is deliberately one-sided: an explicit `success: false` is a
 * failure, everything else is a success. The cases below are mostly about that
 * asymmetry, because the tempting generalisations (empty results, error-ish
 * field names) are how a fix for an over-optimistic metric turns into a
 * pessimistic one.
 */
describe("toolCallSucceeded", () => {
  it("reads an explicit failure from a shell result", () => {
    expect(toolCallSucceeded({ success: false, exitCode: 1, stdout: "", stderr: "boom" })).toBe(
      false
    );
  });

  it("reads an explicit success", () => {
    expect(toolCallSucceeded({ success: true, exitCode: 0, stdout: "ok", stderr: "" })).toBe(true);
  });

  it("treats a result with no success field as a success", () => {
    expect(toolCallSucceeded({ genes: [], total: 0 })).toBe(true);
    expect(toolCallSucceeded({ rankings: [{ rank: 1 }] })).toBe(true);
  });

  /**
   * A search that matches nothing searched fine. Reading emptiness as failure
   * would trade an over-optimistic metric for a wrong one.
   */
  it("does not read an empty result as a failure", () => {
    expect(toolCallSucceeded({ genes: [] })).toBe(true);
    expect(toolCallSucceeded([])).toBe(true);
    expect(toolCallSucceeded({})).toBe(true);
  });

  /** A field that merely shares the name says nothing about the outcome. */
  it("ignores a non-boolean success field", () => {
    expect(toolCallSucceeded({ success: "false" })).toBe(true);
    expect(toolCallSucceeded({ success: 0 })).toBe(true);
    expect(toolCallSucceeded({ success: null })).toBe(true);
    expect(toolCallSucceeded({ success: undefined })).toBe(true);
  });

  it("handles non-objects without throwing", () => {
    expect(toolCallSucceeded(null)).toBe(true);
    expect(toolCallSucceeded(undefined)).toBe(true);
    expect(toolCallSucceeded("done")).toBe(true);
    expect(toolCallSucceeded(42)).toBe(true);
  });

  /**
   * `exitCode` is not consulted on its own: `ShellResult` already derives
   * `success` from it, and no other result carries one. Reading it separately
   * would be a second, drifting definition of the same thing.
   */
  it("does not second-guess success using exitCode", () => {
    expect(toolCallSucceeded({ success: true, exitCode: 1 })).toBe(true);
    expect(toolCallSucceeded({ success: false, exitCode: 0 })).toBe(false);
  });

  it("reads a failed login as a failure", () => {
    expect(
      toolCallSucceeded({ success: false, username: null, provider: null, message: "denied" })
    ).toBe(false);
  });
});
