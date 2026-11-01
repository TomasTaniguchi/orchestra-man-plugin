# 0007. Committed plugin bundle

**Status**: accepted (2026-10-31)

## Context

Claude Code installs a plugin by copying its directory. It does not run `npm install`. The runtime needs zod, the MCP SDK and LangGraph.

## Decision

- `scripts/build-plugin.mjs` bundles two self-contained entry points with esbuild, `plugin/dist/mcp.mjs` and `plugin/dist/cli.mjs` (minified, with names preserved), and copies `migrations/` next to them.
- `plugin/dist/` is committed.
- CI regenerates the bundle and fails if it differs from the committed one.

## Consequences

- Installing the plugin requires no build and no network.
- Every change in `src/` must come with `npm run build`.
- The `test/e2e/bundle.e2e.test.ts` test runs the real bundle, not the source code.
