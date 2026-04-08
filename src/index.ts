#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getVersionInfo, getPackageVersion } from "./version.js";

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
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
