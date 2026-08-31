#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getVersionInfo, getPackageVersion } from "./version.js";
import { flushInvocationReports } from "./cloud.js";

async function notifyVersionOnStderr(): Promise<void> {
  if (process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.ROTIFER_NO_UPDATE_CHECK) return;
  try {
    const info = await getVersionInfo();
    if (info.updateAvailable && info.latest) {
      process.stderr.write(
        `[rotifer-mcp-server] Update available: ${info.current} → ${info.latest}. ` +
        `Run: npm i -g @rotifer/mcp-server@latest\n`,
      );
    }
  } catch { /* non-critical */ }
}

async function main() {
  const subcommand = process.argv[2];

  if (subcommand === "login") {
    const { runLogin } = await import("./login.js");
    const providerIdx = process.argv.indexOf("--provider");
    const endpointIdx = process.argv.indexOf("--endpoint");
    await runLogin({
      provider: providerIdx !== -1 ? process.argv[providerIdx + 1] : undefined,
      endpoint: endpointIdx !== -1 ? process.argv[endpointIdx + 1] : undefined,
    });
    return;
  }

  if (subcommand === "logout") {
    const { runLogout } = await import("./login.js");
    runLogout();
    return;
  }

  if (subcommand === "serve") {
    const { startHttpServer } = await import("./http.js");
    const portIdx = process.argv.indexOf("--port");
    const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1], 10) : undefined;
    notifyVersionOnStderr();
    await startHttpServer({ port });
    return;
  }

  if (subcommand === "--version" || subcommand === "-v") {
    console.log(getPackageVersion());
    return;
  }

  notifyVersionOnStderr();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // A long-lived host (Claude Code, Cursor) never needs this — an unawaited
  // open request keeps Node's event loop alive on its own until it settles,
  // the same way playground's CLI does when a command simply returns. What
  // this covers is an explicit kill(): SIGTERM's default action is immediate
  // termination, and installing a handler is the only way to get a chance to
  // flush first. This was the exact repro (2026-08-30): a diagnostic script
  // called run_gene, got its response, and child.kill()'d the process right
  // after — the in-flight §33.4 report never landed, silently. Bounded by
  // flushInvocationReports()'s own FLUSH_TIMEOUT_MS, so a stalled endpoint
  // delays shutdown by a few seconds at most, never indefinitely.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await flushInvocationReports();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
