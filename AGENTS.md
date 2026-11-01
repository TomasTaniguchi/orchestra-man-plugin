# AGENTS.md

Entry point for AI agents working **on this repository** (not for agents using the plugin; those read `plugin/skills/`).

## What this repo is

`orchestra-man` is a Claude Code plugin. Several Claude Code sessions, one per repository (codespace or local clone), share memory and coordinate tasks through a personal Cloudflare Worker backed by D1, or through a local SQLite file. LangGraph orchestrates the task flow; Claude Code does all reasoning. Start with `docs/README.md`.

## Commands

| Goal | Command |
| --- | --- |
| Install | `npm ci` |
| Type check | `npm run typecheck` |
| All tests | `npm test` |
| Unit tests only | `npm run test:unit` |
| End-to-end tests | `npm run test:e2e` |
| Update snapshots (review the diff!) | `npm run test:update` |
| Build the plugin bundle (`plugin/dist`) | `npm run build` |
| Everything CI runs | `npm run check` |

`plugin/dist/` is committed: users install the plugin without a build step. **Run `npm run build` and commit `plugin/dist/` whenever `src/` changes.**

## Map

| Path | Owns |
| --- | --- |
| `src/core/contract.ts` | The API contract (zod). Single source of truth for every payload |
| `src/core/db.ts` | `SqlDatabase`: the minimal D1-shaped interface all data code depends on |
| `src/core/repositories/` | One file per table. Atomic SQL functions, no HTTP, no business rules |
| `src/core/service.ts` | `OrchestraService`: business rules composed from repositories (leases, versions, batching) |
| `src/core/remote.ts` | `Remote`: the port the plugin talks to. Implemented by HTTP and local adapters |
| `src/masking/` | Redaction rules and the `maskedRemote` decorator |
| `src/worker/` | Cloudflare Worker: routing, auth, wake, cron maintenance |
| `src/orchestration/` | LangGraph task graph. Nodes are pure functions plus injected tools |
| `src/plugin/` | Plugin runtime: config, identity, Engram client, sync, CLI (hooks/monitor) and MCP server |
| `migrations/` | D1/SQLite schema. Used by wrangler **and** by local mode |
| `plugin/` | The installable Claude Code plugin (manifest, hooks, monitor, skills, bundled `dist/`) |
| `docs/api/openapi.yaml` | Human-readable contract. `test/e2e/contract.test.ts` keeps it in sync with the router |

## Rules

- **Contract first.** Change `src/core/contract.ts` and `docs/api/openapi.yaml` before the handler. The contract test fails if routes and spec drift.
- **One implementation of each rule.** Data logic lives in `src/core`; the Worker and local mode only adapt it. Never copy SQL into `src/worker` or `src/plugin`.
- **Atomic, injected, testable.** Functions take their dependencies (`db`, `clock`, `ids`, `fetch`) as arguments. No module-level singletons, no `Date.now()` outside `src/core/clock.ts`.
- **Mask at the boundary.** Anything leaving the machine goes through `maskedRemote`. Do not call a `Remote` unmasked from plugin code.
- **Respect D1 limits** (`docs/reference/d1-limits.md`): ≤100 bound parameters per statement, one `batch()` per request, ≤50 queries per Worker invocation on the Free plan.
- **Snapshots are assertions.** When a snapshot changes, explain why in the commit message.
- **Never edit another repository without approval.** The `orchestra_task_approve` MCP tool is the human gate; keep it a separate tool so Claude Code prompts for permission.

## Where to read next

- `docs/architecture/overview.md`: components and data flow
- `docs/architecture/orchestration.md`: the task graph
- `docs/reference/`: API, configuration, MCP tools, CLI, data model
- `docs/adr/`: why things are the way they are
