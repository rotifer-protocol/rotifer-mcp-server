# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.6] - 2026-04-21

### Changed

- **Release-line catch-up** — bumped MCP Server public package version to `v0.8.6` to match the current CLI release line and eliminate cross-surface version drift in docs/install snippets.
- **Installation pointer alignment** — this release is intended to be consumed by `rotifer-playground/mcp.json` and rotifer.dev's MCP setup surface as the current public MCP package.

## [0.8.5] - 2026-04-08

### Changed

- **Public release-line consolidation** — aligned the MCP package with the current public `v0.8.5` release line used by rotifer.dev, installation snippets, and registry-facing metadata
- **Distribution metadata cleanup** — server/package versions now present one coherent public version instead of splitting `v0.8.1` and `v0.8.2` across user-facing surfaces
- **Reserved version gap documented** — `v0.8.2` to `v0.8.4` are treated as reserved internal iteration numbers rather than retroactively published public releases

## [0.8.2] - 2026-03-29

### Fixed

- **ESM compatibility** — replaced all `require()` calls with top-level ESM `import` statements; fixes `ReferenceError: require is not defined` in `create_agent`, `agent_run`, `compile_gene`, `run_gene`, `init_gene`, `scan_genes`, `wrap_gene`, `test_gene`, `publish_gene`, `install_gene`, and `logout`
- **`agent_run` parameter mismatch** — changed from `agent_id` (UUID) to `agent_name` to match CLI's name-based agent lookup
- **`install_gene` duplicate overwrite** — now checks if gene directory exists before install; use `force: true` to overwrite

### Added

- **CLI parameter parity** — 12 tools updated with missing CLI flags:
  - `wrap_gene`: `domain`, `fidelity`, `from_skill`, `from_clawhub`
  - `compile_gene`: `check`, `wasm_path`, `lang`
  - `publish_gene`: `description`, `changelog`, `skip_security`
  - `run_gene`: `verbose`, `no_sandbox`, `trust_unsigned`
  - `install_gene`: `force`
  - `init_gene`: `domain`, `no_genesis`
  - `scan_genes`: `skills`, `skills_path`
  - `test_gene`: `verbose`, `compliance` (name now required)
  - `login`: `endpoint`
  - `create_agent`: `domain`, `top`, `strategy`, `par_merge`; composition expanded to `Cond`, `TryPool`
  - `search_genes`: sort values aligned with CLI (`popular`, `fitness`)
  - `agent_run`: parameter corrected from UUID to name

- **`vg_scan` tool** — V(g) security scanner exposed via MCP; static analysis returns grade (A/B/C/D/?), findings with severity/file/line/snippet, and scan stats; enables AI Agents to perform automated security audits on Gene/Skill code

### Changed

- README rewritten with full 29-tool catalog, grouped by function
- `rotifer://local/agents` resource now documented

## [0.8.1] - 2026-03-28

### Changed

- Version bump aligned with CLI v0.8.1 (Ecosystem Reach release)

## [0.8.0] - 2026-02-17

### Changed

- Version bump aligned with CLI v0.8.0 (Iron Shell release)
- MCP server identity version corrected to match package version

## [0.7.9] - 2026-03-20

### Changed

- Version bump aligned with CLI v0.7.9 (Trust Shield release)

## [0.7.8] - 2026-02-17

### Changed

- Version bump aligned with CLI v0.7.8 (Test Fortification release)

## [0.7.7] - 2026-02-17

### Added

- **`get_gene_reputation` tool** — detailed reputation breakdown for a gene (code quality, test coverage, documentation, community)
- **`get_my_reputation` tool** — current user's creator reputation and contribution summary
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

- 3 new tools: `get_gene_stats` (download statistics by time period), `get_leaderboard` (creator reputation rankings), `get_developer_profile` (creator profile + reputation data)
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

[0.8.6]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.8.6
[0.8.5]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.8.5
[0.8.2]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.8.2
[0.8.1]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.8.1
[0.8.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.8.0
[0.7.9]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.9
[0.7.8]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.8
[0.7.7]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.7
[0.7.6]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.6
[0.7.5]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.5
[0.7.1]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.1
[0.7.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.7.0
[0.4.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.4.0
[0.3.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.2.0
[0.1.2]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.1.2
[0.1.1]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@rotifer/mcp-server/v/0.1.0
