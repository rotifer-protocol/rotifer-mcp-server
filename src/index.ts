#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

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

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
