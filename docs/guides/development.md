# Development

## Commands

```bash
npm ci
npm run typecheck
npm test              # unit + end-to-end
npm run test:unit     # src/**/*.test.ts
npm run test:e2e      # test/e2e
npm run test:update   # regenerates snapshots: review the diff before committing
npm run build         # generates plugin/dist (versioned)
npm run check         # typecheck + tests + build, same as CI
```

CI (`.github/workflows/ci.yml`) also fails if `plugin/dist` does not match what `npm run build` generates.

## Try the plugin in your Claude Code without installing it

```bash
npm run build
claude --plugin-dir ./plugin
claude plugin validate ./plugin
```

## Test strategy

| Level | Where | What it covers |
| --- | --- | --- |
| Unit | `src/**/*.test.ts` | Repositories and service on in-memory SQLite; in-process Worker; masking; graph; config, identity, sync, CLI and MCP with fake dependencies |
| Contract | `test/e2e/contract.test.ts` | `docs/api/openapi.yaml` documents exactly the routes in `src/core/routes.ts` |
| Scenario | `test/e2e/multi-agent.e2e.test.ts` | Three repos and the full flow **on both backends**, with identical results and no sensitive data in any table |
| Artifact | `test/e2e/bundle.e2e.test.ts` | `plugin/dist` run as processes: hooks and MCP over stdio on two real git clones |
| Deploy script | `test/e2e/setup-worker.e2e.test.ts`, `test/scripts/` | The real `scripts/setup-worker.sh` with a fake wrangler (`test/helpers/fake-wrangler.mjs`) and the real Worker over HTTP. CI runs it on macOS (bash 3.2) and Windows (Git Bash); shellcheck on Linux |

Everything is deterministic: the clock (`manualClock`) and ids (`sequentialIds`) are injected from `test/helpers/fixtures.ts`. Snapshots should not change between runs; if they do, it is a behavior change.

Helpers:

- `testService()`: a service on already-migrated in-memory SQLite.
- `inProcessWorker()` / `issueToken()`: the real Worker, in process.
- `makeBackend("d1" | "local")`: a complete production backend.
- `testRuntime({ repo, machine, codespace, remote, memories, git })`: an agent with its local memory preloaded and fake git.

## Recipes

### Add an endpoint

1. Schemas in `src/core/contract.ts`.
2. Method in `OrchestraService` (validate with `parse`), and in the `Remote` port and `REMOTE_METHODS` if the plugin uses it.
3. Route in `ROUTES` (`src/core/routes.ts`) and handler in `HANDLERS` (`src/worker/handlers.ts`).
4. Client in `httpRemote` (`src/plugin/http-remote.ts`). If it carries free text, mask it in `maskedRemote`.
5. Document the route in `docs/api/openapi.yaml`. The contract test fails until they match.
6. Tests: a unit test on the service and, if a flow changes, the e2e scenario.

### Add an MCP tool

1. Entry in `TOOLS` (`src/plugin/mcp.ts`): description, zod schema and `run`, which delegates to a use case (`src/plugin/commands.ts`) or to the `Remote`.
2. If it is a human decision, make it a separate tool (like `orchestra_task_approve`) so Claude Code asks for permission.
3. Document it in `docs/reference/mcp-tools.md` and, if the protocol changes, in `plugin/skills/orchestra/SKILL.md`.
4. `npm run build`.

### Add a masking rule

1. Rule in `DEFAULT_RULES` (`src/masking/rules.ts`). Use lookbehind and lookahead so you do not capture non-sensitive context.
2. Add a case to `SENSITIVE` and, if there is a risk of false positives, another to `HARMLESS` in `src/masking/masking.test.ts`.
3. `npm run test:update` and review the snapshot.

### Change the schema

Never edit a migration that has already been published. Add `migrations/0002_<name>.sql`: wrangler applies it to D1 (`npm run worker:migrate:remote`) and local mode applies it automatically when it opens the database.

### Add a check to the diagnosis

1. Add a `Check` in `diagnose` (`src/plugin/doctor.ts`) with `status`, `detail` and, if it is not `ok`, an actionable `fix`.
2. Add the case in `src/plugin/doctor.test.ts`. If the output changes, run `npm run test:update` and review the snapshot.
3. If the `/orchestra-man:help` guide needs to mention it, edit `plugin/skills/help/SKILL.md`.

### Add a phase to the graph

1. `Phase` and, if needed, a new `kind` in `TaskInput` (`src/orchestration/state.ts`).
2. A node in `src/orchestration/nodes.ts` that validates its input with `requireInput` and records the action with `step`.
3. Register it in `NODES` and `NODE_FOR_PHASE` (`src/orchestration/graph.ts`).
4. Update `docs/architecture/orchestration.md` and the skill.
