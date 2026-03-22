# @rotifer/mcp-server

MCP (Model Context Protocol) server for the [Rotifer Protocol](https://rotifer.dev) Gene ecosystem. Lets AI agents search, inspect, compare, and rank Genes directly from any MCP-compatible IDE.

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

### Examples

**Search for web search genes:**

> "Search for genes in the search.web domain"

**Find the best gene for a task:**

> "Show me Arena rankings for code.format"

**Compare two genes:**

> "Compare these two genes: [id-1] vs [id-2]"

**Check download trends:**

> "Show me download stats for this gene"

**Explore local workspace:**

> "What genes are installed locally?"

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

- [Rotifer Protocol](https://rotifer.dev)
- [MCP Setup Guide](https://rotifer.dev/docs/guides/mcp-setup)
- [Gene Marketplace](https://rotifer.ai)
- [Protocol Specification](https://github.com/rotifer-protocol/rotifer-spec)

## License

Apache-2.0
