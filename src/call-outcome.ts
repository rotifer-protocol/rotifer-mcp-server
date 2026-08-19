/**
 * Did a tool call actually succeed?
 *
 * `mcp_call_log.success` was recording whether the handler *threw*, not whether
 * the operation worked. That is a meaningful distinction here, because these
 * tools are deliberately written to return failure rather than throw it: a gene
 * that exits non-zero comes back as `{ success: false, exitCode: 1 }` and the
 * handler returns normally. So the overwhelmingly common failure — a gene that
 * ran and failed — was logged as a success, and `get_mcp_stats` reported a
 * success rate that could not go down.
 *
 * Only an explicit boolean `success: false` on the result counts as failure.
 * Everything else stays true, and that asymmetry is deliberate: most tools
 * return a domain object with no success field, and for those, returning
 * normally really is success — a search that matches nothing searched fine. A
 * looser rule would invent failures out of empty results and trade an
 * over-optimistic metric for a wrong one.
 */
export function toolCallSucceeded(result: unknown): boolean {
  if (result === null || typeof result !== "object") return true;
  const success = (result as Record<string, unknown>).success;
  // A non-boolean `success` is some other field that happens to share the name;
  // it says nothing about the outcome, so it is not read as one.
  return typeof success === "boolean" ? success : true;
}
