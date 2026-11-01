# MCP tools

The plugin's MCP server is named `orchestra` and exposes 23 tools: 11 for this repo's memory, 4 for shared queries, 4 for messages, and 4 for tasks. Definition: `TOOLS` in `src/plugin/mcp.ts`. Every error comes back as an MCP result with `isError: true` and a message that starts with `orchestra-man:`; the server never crashes because of a tool error.

## This repo's memory

Local, instant and unmasked. `project` memories are published on the next sync; `personal` ones never leave the machine. Usage protocol: the `memory` skill.

| Tool | Input | Returns |
| --- | --- | --- |
| `orchestra_save` | `title`, `type`, `content`, `scope?` (`project`/`personal`), `topicKey?` | `{ id, outcome, topicKey, revision, scope }`. `outcome`: `created`, `updated-topic` (same `topicKey`: previous version goes to history) or `deduplicated` (identical within 15 min) |
| `orchestra_update` | `id` and the fields to change | The updated memory; the previous one is kept as a version |
| `orchestra_delete` | `id`, `hard?` | Soft by default. `hard` deletes content and history. Both are withdrawn from the backend |
| `orchestra_get` | `id`, `history?` | The full memory and, with `history`, its versions |
| `orchestra_search` | `query`, `type?`, `scope?`, `limit?` | Matches in this repo's local memory, with `snippet` |
| `orchestra_context` | `compact?`, `maxBytes?` | Recent sessions, pinned and recent memories (16 KB by default) |
| `orchestra_timeline` | `id`, `before?`, `after?` | Memories saved before and after in the same session |
| `orchestra_pin` | `id`, `pinned?` | Pins (or unpins with `pinned=false`) so it always appears in the context |
| `orchestra_suggest_topic_key` | `type`, `title`, `content?` | `{ topicKey }`, for example `architecture/invoice-api` |
| `orchestra_session_summary` | `content` | Saves the session summary (one per session, updated if repeated) |
| `orchestra_capture_passive` | `content` | `{ extracted, saved, duplicates }` from the items in a `## Key Learnings` / `## Aprendizajes` section |

`<private>…</private>` is replaced with `[REDACTED]` before saving. Ids are local to each machine, and id-based operations only reach this repo's memories.

## Shared queries

| Tool | Input | Returns |
| --- | --- | --- |
| `orchestra_status` | — | The diagnosis as text: configuration, backend and version, this agent, repo memory (and unsynced changes), other repos online/offline, inbox, and what to fix. It is what `/orchestra-man:help` shows and the same as `cli.mjs doctor` |
| `orchestra_recall` | `query`, `repo?`, `limit?` (1–50) | Matching memories, with `snippet` (matches between `[ ]`). Works even when the repo's codespace is stopped |
| `orchestra_checkpoints` | `repo?` | Latest checkpoint per repo: branch, commit, uncommitted files, recent memories |
| `orchestra_sync` | — | Publishes this repo's memory changes now (masked, `project` only) and saves a checkpoint |

## Messages

| Tool | Input | Returns |
| --- | --- | --- |
| `orchestra_send` | `toRepo`, `kind`, `body`, `taskId?` | The created message. The `body` is masked before it leaves |
| `orchestra_inbox` | `includeAcked?` | Messages to this repo, oldest first (at most 100) |
| `orchestra_ack` | `messageId` | The message marked as handled. Only the recipient repo can do it, and only once |
| `orchestra_wake` | `repo` | `{ repo, codespaceName, state }`. Starts the last seen codespace of that repo. Requires the D1 backend and `GITHUB_TOKEN` in the Worker |

`kind`: `investigate-request`, `investigate-result`, `edit-request`, `edit-result`, `note`.

## Tasks

| Tool | Input | Returns |
| --- | --- | --- |
| `orchestra_task_start` | `goal`, `repos` | Initial step: the caller becomes the orchestrator. Gathers context and asks the other repos to investigate |
| `orchestra_task_advance` | `taskId`, `kind` and the matching field | Runs one step of the graph. See the table below |
| `orchestra_task_approve` | `taskId`, `decision` (`approve`, `revise`, `plan-only`), `note?` | **User decision** on the plan. A separate tool so Claude Code asks for permission |
| `orchestra_task_get` | `taskId` | Full state: phase, plan, edits, `actions` log and `instruction` |

`orchestra_task_advance` fields by `kind`:

| `kind` | Fields | Phase |
| --- | --- | --- |
| `findings` | `findings: string[]` | investigate |
| `plan` | `plan: string` | plan |
| `edits` | `edits: { repo, branch, summary }[]` | edit |
| `verification` | `passed: boolean`, `report: string` | verify |
| `pull-requests` | `urls: string[]` | propose |
| `cancel` | `reason: string` | any |

All task tools return `{ taskId, phase, status, instruction, state }`. Typical errors:

- `conflict`: another agent holds the current lease, the task is already closed, or the version changed.
- `bad_request`: the `kind` does not match the phase.

## Recommended permissions

Allow the read-only tools without prompting (`orchestra_status`, `orchestra_recall`, `orchestra_checkpoints`, `orchestra_inbox`, `orchestra_task_get`, `orchestra_search`, `orchestra_get`, `orchestra_context`, `orchestra_timeline`, `orchestra_suggest_topic_key`) and, if you want Claude to save memory without asking, `orchestra_save` and `orchestra_session_summary`. Do **not** allow `orchestra_task_approve` automatically.
