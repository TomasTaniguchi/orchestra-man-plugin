# AGENTS.md

Entry point for AI agents working **on this repository**. Agents that **use** the plugin read `plugin/skills/`.

## What it is

`orchestra-man` is a Claude Code plugin. Several Claude Code sessions, one per repository (codespace or local clone), share memory and coordinate tasks through a personal Cloudflare Worker with D1, or a local SQLite file. LangGraph orders the flow of each task; Claude Code does all the reasoning. Documentation index: `docs/README.md`.

## Commands

| Goal | Command |
| --- | --- |
| Install | `npm ci` |
| Typecheck | `npm run typecheck` |
| All tests | `npm test` |
| Unit only | `npm run test:unit` |
| End-to-end only | `npm run test:e2e` |
| Update snapshots (review the diff!) | `npm run test:update` |
| Build the bundle (`plugin/dist`) | `npm run build` |
| Everything CI runs | `npm run check` |
| Deploy your Worker (interactive) | `npm run worker:setup` (`scripts/setup-worker.sh`) |

`plugin/dist/` is versioned: users install the plugin without a build. **If you change `src/`, run `npm run build` and commit `plugin/dist/`.** CI fails if the bundle is out of date.

## Map

| Path | Responsibility |
| --- | --- |
| `src/core/contract.ts` | The API contract (zod). Single source of truth for every payload |
| `src/core/routes.ts` | HTTP routes. Used by the Worker router and the `httpRemote` client |
| `src/core/db.ts` | `SqlDatabase`: minimal D1-shaped interface that all data code depends on |
| `src/core/repositories/` | One file per table. Atomic SQL functions, no HTTP or business rules |
| `src/core/service.ts` | `OrchestraService`: business rules (validation, leases, versions, batches) |
| `src/core/remote.ts` | `Remote`: the port the plugin uses. Implemented by the local service and `httpRemote` |
| `src/masking/` | Masking rules and the `maskedRemote` decorator |
| `src/worker/` | Worker: router, auth, codespace wake, cron maintenance |
| `src/orchestration/` | LangGraph graph. Pure nodes plus injected tools |
| `src/memory/` | Each repo's local memory (Engram replacement): store, text, context and `mem_*` schema |
| `src/plugin/` | Plugin runtime: config, identity, incremental sync, use cases, MCP and CLI |
| `migrations/` | Schema. Used by wrangler **and** local mode |
| `scripts/setup-worker.sh` | Interactive Worker deployment (bash 3.2+, Git Bash, WSL). The portable logic lives in `scripts/setup-worker-lib.mjs` |
| `worker/wrangler.jsonc` | Versioned template. Each person uses their own copy `worker/wrangler.local.jsonc` (ignored) |
| `plugin/` | The installable plugin (manifest, hooks, monitor, skills and `dist/`) |
| `plugin/skills/` | `memory` (memory protocol), `orchestra` (multi-agent), `configure` and `help` (invoked only by the user). The guide with examples lives in `help/SKILL.md` |
| `src/plugin/doctor.ts` | The diagnosis for `/orchestra-man:help`, `cli.mjs doctor` and `orchestra_status`: a single implementation |
| `docs/api/openapi.yaml` | Human-readable contract. `test/e2e/contract.test.ts` keeps it in sync with the routes |

## Rules

- **Contract first.** Change `src/core/contract.ts`, `src/core/routes.ts` and `docs/api/openapi.yaml` before the handler. The contract test fails if they diverge.
- **A single implementation of each rule.** Data logic lives in `src/core`; the Worker and local mode only adapt it. Never copy SQL into `src/worker` or `src/plugin`.
- **Atomic, injected, testable functions.** Dependencies (`db`, `clock`, `ids`, `fetch`, `exec`) come in as parameters. No singletons and no `Date.now()` outside `src/core/clock.ts`.
- **Local memory never leaves without going through sync.** `src/memory` knows nothing about the network; only `src/plugin/sync.ts` publishes, and never `personal` memories.
- **Mask at the edge.** Everything that leaves the machine goes through `maskedRemote`. Plugin code never uses an unmasked `Remote`; `createRuntime` is the only place that builds one.
- **Respect D1 limits** (`docs/reference/d1-limits.md`): at most 100 parameters per statement, one `batch()` per request and 50 queries per invocation on the Free plan.
- **Snapshots are assertions.** If a snapshot changes, explain why in the commit.
- **Never edit another repository without approval.** `orchestra_task_approve` is the human gate; it must stay a separate tool so Claude Code asks for permission.
- **Hooks and monitor never break the session.** They fail with an explanatory line and exit code 0.

## Recipes

- Add an endpoint, an MCP tool or a masking rule: `docs/guides/development.md`.

## Further reading

- `docs/architecture/overview.md`: components and data flow
- `docs/architecture/orchestration.md`: the task graph
- `docs/reference/`: API, configuration, MCP tools, CLI, data model
- `docs/adr/`: why things are the way they are
