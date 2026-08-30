/**
 * The one environment-variable check both telemetry paths share.
 *
 * Mirrors rotifer-playground's src/telemetry/consent.ts exactly — same
 * logic, independently implemented because these are two separate npm
 * packages that cannot import each other's source. If this file and that one
 * ever diverge, fix both; a user who sets ROTIFER_TELEMETRY=0 expects it to
 * mean "off" from whichever binary they happen to be running.
 *
 * ADR-329's decision is explicit: "ROTIFER_TELEMETRY=0 同时关闭匿名信号与
 * 登录上报——「关掉」意味着全部，与 316 的语义一致." Before this module
 * existed, ROTIFER_TELEMETRY was checked in exactly one place here
 * (cloud.ts's telemetryOptedOut, for the signed-in invocation/download
 * reports). Adding the anonymous heartbeat with its own copy of that check
 * would have been the easy path and the wrong one.
 *
 * DO_NOT_TRACK is the cross-tool convention (https://consoledonottrack.com/)
 * and is new here — it outranks ROTIFER_TELEMETRY because it is a stance the
 * user took before ever hearing of this project.
 */
export function telemetryOptedOutByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const dnt = (env.DO_NOT_TRACK || "").trim().toLowerCase();
  if (dnt !== "" && dnt !== "0" && dnt !== "false") return true;

  const flag = (env.ROTIFER_TELEMETRY || "").trim().toLowerCase();
  return flag === "0" || flag === "false" || flag === "off";
}

/**
 * True when the environment explicitly asked for telemetry (as opposed to
 * "unset, so whatever the default is"). An explicit ROTIFER_TELEMETRY=1
 * should win even over a stored "disabled" choice — a per-shell override
 * should not require first running a separate command to change stored state.
 */
export function telemetryExplicitlyOnByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (telemetryOptedOutByEnv(env)) return false;
  const flag = (env.ROTIFER_TELEMETRY || "").trim().toLowerCase();
  return flag !== "" && flag !== "0" && flag !== "false" && flag !== "off";
}
