# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.9] - 2026-03-20

### Changed

- Version bump aligned with CLI v0.7.9 (Trust Shield release)

## [0.7.8] - 2026-02-17

### Changed

- Version bump aligned with CLI v0.7.8 (Test Fortification release)

## [0.7.7] - 2026-02-17

### Added

- **`get_gene_reputation` tool** — detailed reputation breakdown for a gene (code quality, test coverage, documentation, community)
- **`get_my_reputation` tool** — current user's developer reputation and contribution summary
- **`suggest_domain` tool** — AI-powered domain suggestions based on natural language description

### Fixed

- **Server version string** — corrected hardcoded version from `0.7.5` to `0.7.7`

## [0.7.6] - 2026-03-19

### Fixed

- **Gene list deduplication** — `search_genes` now returns only the latest version per (owner, name) pair, fixing inflated gene counts and duplicate entries

## [0.7.5] - 2026-02-17

### Added

- **`list_gene_versions` tool** — list full version history chain for a Gene by owner and name, with changelog entries and `previous_version_id` links
- **`get_mcp_stats` tool** — call analytics dashboard: total calls, success rate, avg latency, top tools and genes (requires authentication)
- **MCP call instrumentation** — every tool invocation logs `tool_name`, `success`, `latency_ms`, `gene_id` to `mcp_call_log` table (fire-and-forget, zero impact on response latency)

### Changed

- `Gene` interface now includes `previous_version_id` and `changelog` fields
- `search_genes` and `get_gene_detail` return version chain fields
- Server version bumped to 0.7.5

## [0.7.1] - 2026-02-17

### Added

- **Authentication tools**: `auth_status`, `login` (OAuth Device Flow), `logout` — MCP users can authenticate entirely within the IDE
- **Creation lifecycle tools** (Phase 5): `init_gene`, `scan_genes`, `wrap_gene`, `test_gene`, `publish_gene` via CLI shell-out

## [0.7.0] - 2026-02-17

### Added

- **Phase 4 tools**: `agent_run`, `compile_gene`, `run_gene` via CLI shell-out
- **Phase 3 write tools**: `arena_submit`, `install_gene`, `create_agent`

## [0.4.0] - 2026-03-19

### Changed

- `search_genes` tool now uses server-side `search_genes` RPC (full-text search with tsvector + trigram fallback) instead of client-side `ILIKE` queries — significantly better search relevance and performance
- New `sort` parameter for `search_genes`: `relevance`, `newest`, `reputation`, `downloads`
- Aligned with `@rotifer/playground` v0.7 search infrastructure (Migration 011)

## [0.3.0] - 2026-03-18

### Added

- `login` CLI subcommand: `rotifer-mcp-server login` opens browser for OAuth (GitHub/GitLab) and stores credentials in `~/.rotifer/credentials.json`
- `logout` CLI subcommand: `rotifer-mcp-server logout` clears stored credentials
- Cross-platform browser opening with Windows compatibility fix (`start "" "url"` pattern)
- PKCE and implicit OAuth flow support, shared token storage with `@rotifer/playground` CLI

### Fixed

- Windows: `start` command no longer treats URL as window title (the `start ""` empty-title workaround)

## [0.2.0] - 2026-03-14

### Added

- 3 new tools: `get_gene_stats` (download statistics by time period), `get_leaderboard` (developer reputation rankings), `get_developer_profile` (developer profile + reputation data)
- 1 new tool: `list_local_genes` (scan local workspace for installed Genes with metadata, compile status, and cloud origin)
- MCP Resources support with 5 resource templates: `rotifer://genes/{id}/stats`, `rotifer://genes/{id}`, `rotifer://developers/{username}`, `rotifer://leaderboard`, `rotifer://local/genes`
- Comprehensive test suite (139 tests): unit, integration, protocol, security, and resilience layers using Vitest

### Changed

- `get_arena_rankings` upgraded from PostgREST table query to `get_arena_rankings` RPC (returns proper domain-partitioned ranks and owner usernames)
- Pagination parameters now clamped to safe ranges (`perPage` min 1 / max 50, `page` min 1)
- Server architecture refactored: handler registration extracted to `createServer()` factory for testability

### Fixed

- Negative or zero `perPage` values no longer cause PostgREST 416 errors

## [0.1.2] - 2026-03-13

### Added

- README with Quick Start guide for Cursor, Claude Desktop, and other MCP clients
- Tool reference table and usage examples
- Custom endpoint configuration documentation

## [0.1.1] - 2026-03-12

### Fixed

- `npx @rotifer/mcp-server` binary resolution — added `mcp-server` entry to `bin` field (npx resolves scoped packages by suffix)
- Enhanced error messages for network connectivity issues (e.g., Supabase project paused)
- Query parameter sanitization in `listGenes` to prevent PostgREST injection

### Changed

- Default anon key embedded for zero-config usage (Supabase anon key is public by design)
- Cloud config loading with caching to reduce redundant reads

## [0.1.0] - 2026-03-11

### Added

- Initial release of Rotifer MCP Server
- 4 MCP tools: `list_genes`, `get_gene`, `run_gene`, `compare_genes`
- Cloud API integration via Supabase PostgREST
- Configurable endpoint via `~/.rotifer/cloud.json` or environment variables
- Zero-config mode with built-in defaults for public Cloud API
- Support for `npx @rotifer/mcp-server` execution

[0.3.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.2.0
[0.1.2]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.1.2
[0.1.1]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.1.0
