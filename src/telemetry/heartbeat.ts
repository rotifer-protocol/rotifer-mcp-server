/**
 * Anonymous usage heartbeat (ADR-329).
 *
 * Answers a narrower question than the signed-in invocation report: not "who
 * called what", just "did this machine run something today, and through
 * which channel". No identity, on by default, and it costs nothing to lose
 * one — this is not §33.4 input, so unlike logGeneInvocation's report this
 * file tracks no in-flight requests for anything to await. A dropped
 * heartbeat is not a hole in an audited ledger, it is one machine's "active
 * today" signal that will show up again tomorrow if the machine is still in
 * use.
 *
 * The one thing genuinely different from playground's version of this file:
 * the first-run notice cannot go to stderr here. stderr is where CLI users
 * look and exactly where MCP hosts do not — nobody reads a long-lived MCP
 * server's stderr stream in normal use. So recordHeartbeat() *returns* the
 * notice text instead of printing it, and the caller (server.ts) folds it
 * into the tool response the user's client will actually render.
 */
import { loadCloudConfig } from "../cloud.js";
import { getPackageVersion } from "../version.js";
import {
  loadOrInitHeartbeatConfig,
  resolveHeartbeatDecision,
  heartbeatDecisionEnabled,
  markFirstRunNoticeShown,
} from "./config.js";

const FIRST_RUN_NOTICE =
  "Anonymous usage heartbeat is on by default — no code, no identity, just " +
  '"this machine ran something today". Set ROTIFER_TELEMETRY=0 or DO_NOT_TRACK=1 ' +
  "to disable. Details: https://rotifer.dev/telemetry";

/**
 * Reports one Gene invocation's worth of activity for this machine, today,
 * on the given channel. Fire-and-forget; every failure mode is silence.
 *
 * Returns the first-run notice text exactly once — the first time a report
 * for this machine is actually about to leave the process, never before (a
 * machine whose heartbeat is off, by env or stored choice, must never be
 * told "we're about to collect data" for data that in fact never leaves it)
 * — and null every other time, including every call after the first.
 */
export function recordHeartbeat(channel: string): string | null {
  // The whole body is one try/catch, deliberately wider than the network
  // call — loadOrInitHeartbeatConfig()/markFirstRunNoticeShown() write to
  // ~/.rotifer/telemetry.json, and a tool call failing because this
  // fire-and-forget signal couldn't touch the filesystem would be a much
  // worse trade than just not sending a heartbeat this once.
  try {
    const config = loadOrInitHeartbeatConfig();
    const decision = resolveHeartbeatDecision(config);
    if (!heartbeatDecisionEnabled(decision)) return null;

    // Persisted synchronously, before the fetch below, so a crash mid-request
    // can never cause the notice to be owed again on the next call.
    let notice: string | null = null;
    if (!config.first_run_notice_shown) {
      notice = FIRST_RUN_NOTICE;
      markFirstRunNoticeShown(config);
    }

    const cloudConfig = loadCloudConfig();
    const url = `${cloudConfig.endpoint.replace(/\/+$/, "")}/rest/v1/rpc/record_heartbeat`;

    // No Authorization header: record_heartbeat is anon-callable by design
    // (playground migration 20260830010000) — that grant is the entire point
    // of ADR-329. Sending credentials here would be pointless (the RPC does
    // not use them) and would defeat the "no identity" promise for a caller
    // who happens to be signed in but hasn't opted into the invocation report.
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cloudConfig.anonKey },
      body: JSON.stringify({
        p_machine_id: config.machine_id,
        p_channel: channel,
        p_client_version: getPackageVersion(),
        p_invocation_delta: 1,
      }),
    })
      .then((res) => {
        if (!res.ok && process.env.ROTIFER_DEBUG) {
          process.stderr.write(`[rotifer] record_heartbeat failed (${res.status})\n`);
        }
      })
      .catch((err: unknown) => {
        if (process.env.ROTIFER_DEBUG) {
          process.stderr.write(`[rotifer] record_heartbeat error: ${(err as Error)?.message ?? err}\n`);
        }
      });

    return notice;
  } catch (err: unknown) {
    if (process.env.ROTIFER_DEBUG) {
      process.stderr.write(`[rotifer] record_heartbeat setup error: ${(err as Error)?.message ?? err}\n`);
    }
    return null;
  }
}
