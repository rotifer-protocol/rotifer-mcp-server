/**
 * Which host this MCP server is answering, expressed as a channel the registry
 * will accept.
 *
 * The ledger behind the §33.4 metrics records that a Gene ran and who ran it,
 * but not what it ran through. Since ADR-321 the same MCP server is reachable
 * from Cursor, Claude Code, OpenClaw and a DSH bundle, so "is anyone using
 * this, and from where" needs an answer that does not exist in the data today.
 *
 * MCP hands us the answer already: the client declares `{name, version}` in its
 * `initialize` request, and the SDK exposes it as `getClientVersion()`. That
 * name is written by the client, though — arbitrary text, no agreed vocabulary,
 * `"Claude Code"` and `"claude-code"` and `"claude_code"` all plausible for one
 * host — so it is normalised here rather than trusted, and dropped rather than
 * mangled when it cannot be normalised faithfully.
 */

/**
 * What the registry's `client_channel` column accepts, mirrored from the CHECK
 * constraint in playground migration 20260830000000. Kept in sync deliberately:
 * a value this side considers fine and the database rejects would fail the
 * whole report, and reporting is fire-and-forget — nobody would find out.
 */
const CHANNEL_RE = /^[a-z0-9_]{1,32}(:[a-z0-9_]{1,32})?$/;

/** Longest host segment the column will take. */
const MAX_SEGMENT = 32;

/**
 * Fold a client-declared name into the column's vocabulary.
 *
 * Lowercase, and any run of non-alphanumeric characters becomes a single
 * underscore — so `"Claude Code"`, `"claude-code"` and `"Claude  Code"` all
 * land on `claude_code` instead of splitting one host across three rows in
 * every aggregate that groups by this column. That collapsing is the whole
 * point: the identifier-boundary rule exists because a casing mismatch once
 * made a lookup silently stop matching.
 *
 * Returns null when nothing usable survives (empty, punctuation-only, or
 * longer than the column allows once folded). Null means "not attributable",
 * which is honest; a truncated or invented name would not be.
 */
export function normaliseHostName(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const folded = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!folded) return null;
  // Not truncated to fit. A host whose name is longer than the column allows
  // is one we cannot record faithfully, and a clipped name would quietly
  // merge with any other host sharing that prefix.
  if (folded.length > MAX_SEGMENT) return null;
  return folded;
}

/**
 * The channel to report for an invocation this server is handling.
 *
 * `mcp` alone when the client did not identify itself — still strictly more
 * than the ledger knows today, since it separates MCP traffic from direct CLI
 * runs. `mcp:<host>` when it did.
 */
export function resolveMcpChannel(clientName: string | undefined | null): string {
  const host = normaliseHostName(clientName);
  const channel = host ? `mcp:${host}` : "mcp";
  // Belt and braces: if the composed value somehow fails the column's shape,
  // fall back to the bare transport rather than losing the report. The channel
  // is worth less than the invocation it is attached to.
  return CHANNEL_RE.test(channel) ? channel : "mcp";
}
