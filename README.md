<div align="center">

# @rotifer/mcp-server

[![npm](https://img.shields.io/npm/v/@rotifer/mcp-server)](https://www.npmjs.com/package/@rotifer/mcp-server)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-indigo)](https://modelcontextprotocol.io)

**Build, compose, and run AI agents — directly from your IDE.**

Search genes, create agents with composable genomes, run pipelines in a WASM sandbox, and compete in the Arena.
Zero config. Works with Cursor, Claude Desktop, Windsurf, and any MCP-compatible client.

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
      "args": ["@rotifer/mcp-server"]
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
      "args": ["@rotifer/mcp-server"]
    }
  }
}
```

### Windsurf / Other MCP Clients

Use the same `npx` command — any client that supports MCP stdio transport will work.

## What Can It Do?

### Create and run an agent in one conversation

```
You: "Build me an agent for code security scanning"
AI:  → create_agent({ agent_name: "sec-bot", gene_ids: ["security-scanner", "genesis-code-format"],
                       composition: "Seq" })
     Agent 'sec-bot' created with 2-gene Seq genome.

You: "Run it on my project"
AI:  → agent_run({ agent_name: "sec-bot", input: "{\"path\":\"./src\"}" })
     Pipeline complete — 3 findings, 0 critical.
```

### Search, compare, and compose genes

```
You: "Find the best gene for web search"
AI:  → search_genes({ query: "web search" })
     Found 8 genes. Top match: genesis-web-search (F(g) = 0.87, Native)

You: "Compare it against the lite version"
AI:  → compare_genes({ gene_ids: ["...", "..."] })
     Side-by-side: success rate, latency, fitness breakdown
```

### Full gene lifecycle from your IDE

```
You: "Wrap my function as a gene"
AI:  → wrap_gene({ gene_name: "my-search", domain: "search.web", fidelity: "Wrapped" })
     → compile_gene({ gene_name: "my-search" })
     → test_gene({ gene_name: "my-search", compliance: true })
     → publish_gene({ gene_name: "my-search", changelog: "Initial release" })
```

## Tools (29)

### Discovery & Analytics

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `search_genes` | Search the Gene ecosystem by name, domain, or description | `query`, `domain`, `fidelity`, `sort` (`relevance`/`newest`/`popular`/`fitness`), `page`, `per_page` |
| `get_gene_detail` | Get detailed info about a Gene (phenotype, fitness, metadata) | `gene_id`, `content_hash` (either identifies the gene) |
| `get_arena_rankings` | Arena rankings for a domain, sorted by F(g) fitness | `domain`, `page`, `per_page` |
| `compare_genes` | Side-by-side fitness comparison of 2–5 Genes | `gene_ids` (array) |
| `get_gene_stats` | Download statistics (total, 7d, 30d, 90d) | `gene_id` |
| `get_leaderboard` | Creator reputation leaderboard | `limit` |
| `get_developer_profile` | Creator public profile and reputation | `username` |
| `get_gene_reputation` | Detailed reputation breakdown (Arena, Usage, Stability) | `gene_id` |
| `list_gene_versions` | Version history chain with changelogs | `owner`, `gene_name` |
| `suggest_domain` | Suggest matching domains from the registry | `description` |

### Local Workspace

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_local_genes` | Scan local workspace for installed Genes | `project_root`, `domain`, `fidelity` |
| `list_local_agents` | List Agents in the local workspace | `project_root`, `state` |

### Gene Lifecycle

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `init_gene` | Initialize a new Gene project with starter files | `gene_name`, `fidelity`, `domain`, `no_genesis` |
| `scan_genes` | Scan for candidate functions or SKILL.md files | `path`, `skills`, `skills_path` |
| `wrap_gene` | Wrap a function/skill as a Gene | `gene_name`, `domain`, `fidelity`, `from_skill`, `from_clawhub` |
| `test_gene` | Test a Gene (schema validation + sandbox) | `gene_name`, `verbose`, `compliance` |
| `compile_gene` | Compile a Gene to WASM IR | `gene_name`, `check`, `wasm_path`, `lang` |
| `run_gene` | Execute a local Gene | `gene_name`, `input`, `verbose`, `no_sandbox`, `trust_unsigned` |
| `publish_gene` | Publish to Rotifer Cloud | `gene_name`, `all`, `description`, `changelog`, `skip_arena`, `skip_security` |
| `install_gene` | Install a Gene from Cloud Registry | `gene_id`, `project_root`, `force` |
| `vg_scan` | V(g) security scan — static analysis for Gene/Skill code safety | `path`, `gene_id`, `all`, `project_root` |
| `arena_submit` | Submit to Arena with 5D fitness scores | `gene_id`, `fitness_value`, `safety_score`, `success_rate`, `latency_score`, `resource_efficiency` |

### Agent Composition

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `create_agent` | Create an Agent composing multiple Genes | `agent_name`, `gene_ids`, `composition` (`Seq`/`Par`/`Cond`/`Try`/`TryPool`), `domain`, `top`, `strategy`, `par_merge` |
| `agent_run` | Run a local Agent by name | `agent_name`, `input`, `verbose`, `no_sandbox` |

### Authentication & Analytics

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `auth_status` | Check login status | — |
| `login` | OAuth login (GitHub/GitLab) | `provider`, `endpoint` |
| `logout` | Clear credentials | — |
| `get_mcp_stats` | MCP call analytics | `days` |
| `get_my_reputation` | Current user's reputation | — |

## Resources (7)

MCP Resources let AI clients reference Rotifer data as context:

| URI Template | Description |
|---|---|
| `rotifer://genes/{gene_id}/stats` | Gene download statistics |
| `rotifer://genes/{gene_id}` | Gene detail + phenotype |
| `rotifer://developers/{username}` | Creator profile + reputation |
| `rotifer://leaderboard` | Top creators by reputation score |
| `rotifer://local/genes` | Local Gene inventory |
| `rotifer://local/agents` | Local Agent registry |
| `rotifer://version` | MCP Server version and update availability |

## Prompts (4)

MCP Prompts give AI clients guided workflows for common tasks:

| Prompt | Description | Key Arguments |
|--------|-------------|---------------|
| `rotifer-hello` | Interactive agent creation — pick a template and run immediately | `template`, `input` |
| `rotifer-guide` | Understand Rotifer Protocol — genes, agents, Arena, fidelity model | — |
| `rotifer-architect` | Design an Agent — task-driven gene search + composition planning | `task` |
| `rotifer-challenge` | Arena evaluation — submit a gene, compare with competitors | `gene` |

Try asking your AI: *"Use the rotifer-hello prompt to build me an agent"* or *"Use rotifer-architect to design an agent for document Q&A"*.

---

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
│  29 Tools  7 Resources  4 Prompts  Local Scanner│
│  ┌──────────┐  ┌───────────┐   ┌────────────┐  │
│  │ discover │  │rotifer:// │   │ ./genes/    │  │
│  │ lifecycle│  │genes/stats│   │ phenotype   │  │
│  │ agents   │  │developers │   │ agents      │  │
│  │ auth     │  │leaderboard│   └────────────┘  │
│  └────┬─────┘  └─────┬─────┘         │         │
└───────┼──────────────┼────────────────┼─────────┘
        │              │                │
        ▼              ▼                ▼
┌─────────────────────────────────────────────────┐
│  Rotifer Cloud API          Local File System   │
│  (Supabase)                 (genes/, .rotifer/) │
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

## Pair with the CLI

This MCP server works best alongside the [Rotifer CLI](https://github.com/rotifer-protocol/rotifer-playground). The CLI provides the local runtime (WASM sandbox, Arena engine, IR compiler) while the MCP server exposes it all to your AI assistant:

```bash
npm install -g @rotifer/playground
rotifer init my-project && cd my-project
rotifer hello   # your first agent in 30 seconds
```

## Links

- [Rotifer Protocol](https://rotifer.dev) — Main site
- [MCP Setup Guide](https://rotifer.dev/docs/guides/mcp-setup) — Step-by-step setup
- [Gene Marketplace](https://rotifer.ai) — Browse and discover Genes
- [CLI Playground](https://github.com/rotifer-protocol/rotifer-playground) — Build and test Genes locally
- [Protocol Specification](https://github.com/rotifer-protocol/rotifer-spec) — Formal spec

## License

Apache-2.0
