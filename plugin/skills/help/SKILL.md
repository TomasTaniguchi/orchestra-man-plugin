---
name: help
description: orchestra-man help. Diagnoses the state of the plugin on this machine (configuration, backend, memory, other repos, inbox) and shows a short guide with examples of what to ask.
disable-model-invocation: true
argument-hint: "[memory | repos | tasks | messages | config]"
---

# orchestra-man help

Requested topic: `$ARGUMENTS` (empty = everything). Topics: `memory`, `repos`, `tasks`, `messages`, `config`. Also accept the old Spanish names as synonyms: `memoria` = `memory`, `tareas` = `tasks`, `mensajes` = `messages`, `configuracion` = `config`.

Present the guide in the user's language.

## 1. Diagnosis

Call the `orchestra_status` tool. If it is not available (for example, the MCP server did not start), run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" doctor
```

Show the user the report **verbatim**, inside a code block. If the "Status" section has problems (✗ or !), first explain what to do about each one, in one line, and offer to do it yourself when possible. For example, for a missing configuration offer `/orchestra-man:configure`. Never show or ask for tokens in the chat.

## 2. Quick guide

After the diagnosis, show the guide below. If a topic was requested, show only that section and "Commands". Do not invent features that are not listed here.

### This repo's memory

Claude saves only what is worth remembering: decisions, root causes, contracts, and pending work. It survives across sessions and context compaction.

| Ask | What it does |
| --- | --- |
| "Save that the invoices endpoint returns invoiceId and status" | `orchestra_save`, with a stable topic (`topicKey`) so it can be updated later |
| "Update the retries decision: it's 5 now" | Same topic: updates the memory and the previous version stays in the history |
| "Save as personal that I use port 5433 for postgres" | `scope=personal`: never leaves this machine |
| "What did we decide about webhooks?" | `orchestra_context`, `orchestra_search` and `orchestra_get` |
| "Pin the invoices contract memory" | `orchestra_pin`: always appears when the session opens |
| "Delete memory #12" | `orchestra_delete` (soft); it is also withdrawn from the other repos |

To make sure something is never saved, not even locally, wrap it in `<private>…</private>`.

### Other repositories

| Ask | What it does |
| --- | --- |
| "How does the billing service create invoices?" | `orchestra_recall` over the shared memory. Works with its codespace stopped |
| "What branch is web on?" | `orchestra_checkpoints` |
| "Start the billing codespace" | `orchestra_wake`. Only with the D1 backend and `GITHUB_TOKEN` in the Worker; it has a cost |

What another repo saves arrives on its next sync (every 5 minutes). `orchestra_sync` publishes yours right away.

### Cross-repo tasks

> "Orders need to store the invoiceId from billing and web needs to show the receipt. Coordinate it."

1. It investigates in every repo and asks the other agents for help.
2. It shows you a plan per repo and **waits for your decision**: approve, revise, or keep only the plan.
3. If you approve, each repo edits on a new branch, verifies, and opens a PR. It never merges.

Other requests: "what's the status of task task_…?", "cancel the task", "continue task task_…" (if the original orchestrator is gone).

### Messages

| Ask | What it does |
| --- | --- |
| "Ask billing which error codes /invoices returns" | `orchestra_send` |
| "Do I have messages?" | `orchestra_inbox` |

When a request arrives from another repo, a `[orchestra-man] … message from …` line appears and Claude handles it. It asks you before editing code, even if the other repo already approved it.

### Configuration

| To | Use |
| --- | --- |
| Deploy your Worker (once) | `npm run worker:setup` in the plugin repo |
| Configure this machine | `/orchestra-man:configure` |
| See the status | `/orchestra-man:help` |
| Publish memory now | "sync" (`orchestra_sync`) |

All your machines must use the same `maskSalt`. `/orchestra-man:configure` explains it.

### Commands

- `/orchestra-man:help [topic]`: this diagnosis and the guide. Topics: `memory`, `repos`, `tasks`, `messages`, `config`.
- `/orchestra-man:configure [d1|local]`: configure the backend, the URL, the token, and masking.

Full documentation: https://github.com/TomasTaniguchi/orchestra-man-plugin/tree/main/docs (common problems in `docs/troubleshooting.md`).
