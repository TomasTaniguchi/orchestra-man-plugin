# orchestra-man

A Claude Code plugin to **generate and fix code across several repositories at once**, with agents that talk to each other and a shared memory that survives while a codespace is shut down.

```
 codespace acme/billing          local clone acme/api (you ask here)      local clone acme/web
 ┌──────────────────────┐        ┌──────────────────────────────┐          ┌──────────────────────┐
 │ Claude Code          │        │ Claude Code  ← orchestrator  │          │ Claude Code          │
 │ + orchestra-man      │        │ + orchestra-man (LangGraph)  │          │ + orchestra-man      │
 │ + local memory       │        │ + local memory               │          │ + local memory       │
 └──────────┬───────────┘        └──────────────┬───────────────┘          └──────────┬───────────┘
            │       masked memory · checkpoints · messages · leased tasks              │
            └──────────────────────────────┬────────────────────────────────────────────┘
                                           ▼
                       Your Cloudflare Worker + D1   (or local SQLite)
```

## What it solves

We work with microservices in separate repositories that act as a single product. Each Claude Code only sees its own repo, so:

- **It forgets everything when the session closes.** Each repo has its own persistent memory: decisions, root causes and contracts that Claude saves and recalls across sessions and after context compaction.
- **It does not know how the other service works.** orchestra-man publishes each repo's memory to a shared database. From `acme/api` you can ask how the `acme/billing` endpoint works **even if its codespace is shut down**.
- **A change spans several repos.** The Claude where you start the request becomes the **orchestrator**: it investigates with the others, builds a plan, asks for your approval and coordinates the edits. Any repo can be the orchestrator, and if a machine goes to sleep mid-task, another one can take over.
- **Agents talk in both directions.** Each repo has an inbox. A plugin monitor notifies Claude when a request arrives from another repo, and the reply comes back through the same channel.
- **You do not want sensitive data to leak.** Everything that leaves your machine is masked first: emails, phone numbers, tokens, keys and IDs are replaced with stable placeholders such as `<email:1a2b3c4d>`.

## How it works

| Piece | What it does |
| --- | --- |
| **Memory** | Each repo stores what is worth remembering in a local SQLite: topic updates with history, no duplicates, full-text search, sessions with summaries and recovery after compaction. Design inspired by [Engram](https://github.com/Gentleman-Programming/engram), with no need to install it. `personal` memories never leave the machine. |
| **Sync** | When Claude Code opens, every 5 minutes and on close: it publishes only new changes (masked, in batches) and saves a *checkpoint* with branch, commit and uncommitted files. |
| **Backend** | Your Cloudflare Worker with D1 (shared across machines) or a local SQLite (several Claude sessions on the same machine). Same code and same schema in both. |
| **Orchestration** | A LangGraph graph: `investigate → plan → approve → edit → verify → propose`. If verification fails, it goes back to `edit`; after 3 failures it goes back to `plan` and asks for your approval again. LangGraph only orders steps and calls tools: **Claude Code does the reasoning**, so there is no extra API cost. |
| **Approval** | Nothing is edited without your explicit decision (`approve`, `revise` or `plan-only`). It is a separate MCP tool, so Claude Code asks for your permission. Changes always go to new branches and end in pull requests, never in `main`. |

More detail in [docs/architecture/overview.md](docs/architecture/overview.md).

## Requirements

- Claude Code.
- Node.js **22.13 or later** (uses `node:sqlite`).
- For shared mode: a Cloudflare account (the Free plan is enough to start).

## Quick install

### 1. Install the plugin

Inside Claude Code:

```
/plugin marketplace add TomasTaniguchi/orchestra-man-plugin
/plugin install orchestra-man@orchestra-man
```

Install it in **every** codespace and local clone you want to connect.

### 2. Choose the backend

**This machine only (no cloud):**

```
/orchestra-man:configure local
```

**Shared across machines (recommended):** first deploy your Worker with `npm run worker:setup` ([guide](docs/guides/deploy-worker.md)); on the machine where you run it, the script already configures the plugin. On the others:

```
/orchestra-man:configure d1
```

The token is **never pasted into the chat**: the skill gives you a command to run in your terminal. In codespaces, use GitHub Codespaces secrets. See [docs/guides/install-plugin.md](docs/guides/install-plugin.md).

### 3. Restart Claude Code

When the session opens you will see your repo's memory and a `# orchestra-man` block with the other repos (online or offline), their latest checkpoint and your inbox. To confirm everything is fine: `/orchestra-man:help`.

## Set up the Worker with D1 (summary)

Each person deploys **their own** Worker from this repo. It is for personal use: your data stays in your account. An interactive script does everything, on macOS, Linux and Windows (Git Bash or WSL):

```bash
git clone https://github.com/TomasTaniguchi/orchestra-man-plugin && cd orchestra-man-plugin && npm ci
npm run worker:setup
```

The script logs in to Cloudflare, creates the D1 database (or reuses an existing one), applies the schema, deploys and loads the secrets. At the end it issues a token for your machine and configures the plugin. It asks you for the names, whether to generate the `ADMIN_TOKEN` and, optionally, a `GITHUB_TOKEN` (classic PAT with the `codespace` scope) so `orchestra_wake` can start shut-down codespaces. Your personal configuration lives in `worker/wrangler.local.jsonc`, which git ignores.

The manual steps, how to issue tokens for other machines, D1 limits and backups are in [docs/guides/deploy-worker.md](docs/guides/deploy-worker.md).

## Help

```
/orchestra-man:help              # diagnosis + full guide
/orchestra-man:help memory       # a single topic: memory, repos, tasks, messages, config
```

It shows the plugin's state on this machine and, if something fails, what to do:

```
# orchestra-man · diagnóstico

✓ Configuración: modo d1 · https://orchestra-man.tomas.workers.dev
✓ Backend: responde (versión 0.2.0)
✓ Agente: acme/api#laptop (local) · registrado
✓ Memoria de este repo: 14 compartidas, 2 personales, 1 fijada, 6 sesiones · 3 cambios sin publicar (se publican en la próxima sincronización, o ya con orchestra_sync) · último cambio 2026-11-01T14:02:11.000Z

## Otros repositorios
- acme/billing: offline · cs-billing (codespace) · último checkpoint 2026-11-01T09:40:00.000Z en main@4f2a9c1
- acme/web: online · laptop (local) · último checkpoint 2026-11-01T13:58:00.000Z en feat/cart@91be0d2

## Bandeja: 1 sin leer (orchestra_inbox para verlos)

## Estado
Todo en orden.
```

Then it shows a short guide with examples of what to ask Claude. It only runs when you invoke it, so it takes no context in your conversations. From the terminal, `node <plugin-path>/dist/cli.mjs doctor` gives the same diagnosis.

## Usage

**Remember** (this repo's memory, across sessions):

> What did we decide about webhook retries?

Claude searches the local memory (`orchestra_context`, `orchestra_search`). The `memory` skill decides what gets saved: decisions, root causes, contracts; never secrets or routine progress.

**Ask about another service** (works with its codespace shut down):

> How does the billing service create invoices and what does it return?

Claude uses `orchestra_recall` on the `acme/billing` memory and tells you the date of the checkpoint it relies on.

**A change that spans repos:**

> I want orders to store the invoiceId from billing and web to show the receipt link. Coordinate it with billing and web.

1. Claude starts the task (`orchestra_task_start`) and asks `acme/billing` and `acme/web` to investigate.
2. The Claude sessions in those repos get notified, investigate their code and reply.
3. It shows you a plan per repo and **waits for your decision**.
4. If you approve, each repo edits its part on a branch, verifies and opens a PR.

**When a request reaches you** from another repo, the monitor notifies you with a `[orchestra-man] Mensaje ...` line. Claude reads it, investigates or edits (and in that case asks for your confirmation here too) and replies.

More examples in [docs/guides/usage.md](docs/guides/usage.md) and in `/orchestra-man:help`. The 23 MCP tools are listed in [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md).

## Security and data

- **Client-side masking**, before any network request: emails, phone numbers, JWTs, Bearer tokens, credentials in URLs, secret assignments, GitHub, AWS and Stripe keys, UUIDs and numeric IDs. Placeholders are HMACs with a local *salt*: the same value gives the same placeholder (agents can correlate), but it cannot be reversed without the salt. You can add your own rules. It is a first, rule-based version: **it does not detect names, addresses or sensitive free text**. See [docs/reference/masking.md](docs/reference/masking.md).
- **Per-machine tokens**, revocable. The Worker stores only their SHA-256.
- **Code is never uploaded.** Git remains the source of truth. Only memories, checkpoints, messages and task state travel.
- **Personal memories and `<private>`.** A `personal` memory never leaves your machine, and if a memory becomes personal it is withdrawn from the backend. Anything between `<private>…</private>` is not saved, not even locally. Withdrawals travel without content.
- Full threat model in [docs/security.md](docs/security.md).

## Development

```bash
npm ci
npm run check        # typecheck + 119 tests (unit + end-to-end with snapshots) + build
```

The end-to-end tests run the full three-repo scenario against **both backends** (in-process Worker on SQLite and local SQLite), require identical results and verify that no sensitive data reaches the database. They also run the real bundle (`plugin/dist`) as processes, with MCP over stdio. See [docs/guides/development.md](docs/guides/development.md).

This repo is designed to be worked on with agents: start with [AGENTS.md](AGENTS.md).

## Known limitations (v0.1)

- The context of a shut-down repo is its **latest checkpoint**: it may be out of date.
- What one repo saves reaches the others on the next sync (up to 5 minutes, or instantly with `orchestra_sync`).
- If you have been using Engram and want to bring your memories over, there is no importer yet.
- Masking is rule-based (see above).
- `orchestra_wake` only works with the D1 backend and a `GITHUB_TOKEN` from the codespaces' owner.
- On the Cloudflare Free plan: 500 MB per database and 50 queries per invocation. The plugin is sized for that ([docs/reference/d1-limits.md](docs/reference/d1-limits.md)).

## License

MIT

## Acknowledgements

Thanks to [Alan Buscaglia (Gentleman Programming)](https://github.com/Alan-TheGentleman) for creating [Engram](https://github.com/Gentleman-Programming/engram). orchestra-man's memory borrows its concepts:
- agent-curated memory;
- topic updates with history;
- deduplication;
- `<private>`;
- recovery after compaction;
- passive capture of learnings;
- its memory protocol.

Several functions in `src/memory/text.ts` are ported from its code, which is distributed under the MIT license.
