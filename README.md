<div align="center">

# @rotifer/mcp-server

[![npm](https://img.shields.io/npm/v/@rotifer/mcp-server)](https://www.npmjs.com/package/@rotifer/mcp-server)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-indigo)](https://modelcontextprotocol.io)

**Search, inspect, compare, and rank AI Genes — directly from your IDE.**

MCP server for the [Rotifer Protocol](https://rotifer.dev) Gene ecosystem.
Works with Cursor, Claude Desktop, Windsurf, and any MCP-compatible client.

</div>

---

## Quick Start

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rotifer": {
      "command": "npx",
      "args": ["-y", "@rotifer/mcp-server"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rotifer": {
      "command": "npx",
      "args": ["-y", "@rotifer/mcp-server"]
    }
  }
}
```

### Windsurf / Other MCP Clients

Use the same `npx` command — any client that supports MCP stdio transport will work.

## What Can It Do?

```
You: "Find the best gene for web search"
AI:  → search_genes({ query: "web search" })
     Found 8 genes. Top match: genesis-web-search (F(g) = 0.87, Native)

You: "Compare genesis-web-search vs genesis-web-search-lite"
AI:  → compare_genes({ gene_ids: ["...", "..."] })
     Side-by-side: success rate, latency, fitness breakdown

You: "What genes are installed locally?"
AI:  → list_local_genes()
     Found 5 genes in ./genes/
```

## Tools

| Tool | Description |
|------|-------------|
| `search_genes` | Search the Gene ecosystem by name, domain, or description |
| `get_gene_detail` | Get detailed info about a specific Gene (phenotype, fitness, metadata) |
| `get_arena_rankings` | Get Arena rankings for a domain, sorted by F(g) fitness score |
| `compare_genes` | Side-by-side fitness comparison of 2–5 Genes |
| `get_gene_stats` | Download statistics for a Gene (total, 7d, 30d, 90d) |
| `get_leaderboard` | Developer reputation leaderboard |
| `get_developer_profile` | Developer public profile and reputation data |
| `list_local_genes` | Scan local workspace for installed Genes |

## Resources

MCP Resources let AI clients reference Rotifer data as context:

| URI Template | Description |
|---|---|
| `rotifer://genes/{gene_id}/stats` | Gene download statistics |
| `rotifer://genes/{gene_id}` | Gene detail + phenotype |
| `rotifer://developers/{username}` | Developer profile + reputation |
| `rotifer://leaderboard` | Top developers by reputation score |
| `rotifer://local/genes` | Local Gene inventory |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  AI IDE (Cursor / Claude / Windsurf)            │
│                                                 │
│  "Find genes for code formatting"               │
│       │                                         │
│       ▼                                         │
│  ┌─────────────────────┐                        │
│  │  MCP Client         │                        │
│  │  (stdio transport)  │                        │
│  └────────┬────────────┘                        │
└───────────┼─────────────────────────────────────┘
            │ MCP Protocol
            ▼
┌─────────────────────────────────────────────────┐
│  @rotifer/mcp-server                            │
│                                                 │
│  Tools      Resources      Local Scanner        │
│  ┌──────┐   ┌──────────┐   ┌───────────────┐   │
│  │search│   │gene://id │   │ ./genes/*.json │   │
│  │arena │   │dev://user│   │ phenotype scan │   │
│  │stats │   │leaderbd  │   └───────────────┘   │
│  └──┬───┘   └────┬─────┘                       │
└─────┼────────────┼──────────────────────────────┘
      │            │
      ▼            ▼
┌─────────────────────────────────────────────────┐
│  Rotifer Cloud API (Supabase)                   │
│  genes · arena_entries · developer_reputation   │
└─────────────────────────────────────────────────┘
```

## Configuration

Zero-config by default — connects to the public Rotifer Cloud API.

To use a custom endpoint, create `~/.rotifer/cloud.json`:

```json
{
  "endpoint": "https://your-supabase-instance.supabase.co",
  "anonKey": "your-anon-key"
}
```

Or set environment variables:

```bash
ROTIFER_CLOUD_ENDPOINT=https://your-instance.supabase.co
ROTIFER_CLOUD_ANON_KEY=your-anon-key
```

## Requirements

- Node.js >= 20

## Links

- [Rotifer Protocol](https://rotifer.dev) — Main site
- [MCP Setup Guide](https://rotifer.dev/docs/guides/mcp-setup) — Step-by-step setup
- [Gene Marketplace](https://rotifer.ai) — Browse and discover Genes
- [Protocol Specification](https://github.com/rotifer-protocol/rotifer-spec) — Formal spec
- [CLI Playground](https://github.com/rotifer-protocol/rotifer-playground) — Build and test Genes

## License

Apache-2.0
