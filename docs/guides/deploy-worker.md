# Deploy your Worker with D1

Each person deploys **their own** Worker. It is for personal use: memory, messages and tasks live in your Cloudflare account, and you decide which machines get a token.

The Free plan is enough to start (see [limits](../reference/d1-limits.md)).

## Requirements

- A Cloudflare account.
- Node.js 22.13 or later.
- Bash:
  - **macOS**: the system one (3.2) is enough.
  - **Linux**: the system one.
  - **Windows**: **Git Bash** (ships with [Git for Windows](https://git-scm.com/download/win)) or **WSL**. PowerShell and CMD are not supported.
- This repository, cloned:

```bash
git clone https://github.com/TomasTaniguchi/orchestra-man-plugin
cd orchestra-man-plugin
npm ci
```

## Quick option: interactive script (recommended)

```bash
npm run worker:setup
# or directly: bash scripts/setup-worker.sh
```

The script walks you through 8 steps and asks only what it needs. Every question has a default value: press Enter to accept it.

| Step | What it does | What it asks |
| --- | --- | --- |
| 1. Requirements | Checks for Node 22.13+ and runs `npm ci` if dependencies are missing | — |
| 2. Account | If there is no Cloudflare session, opens the browser (`wrangler login`) | — |
| 3. Names | Validates the names (lowercase letters, numbers and hyphens) | Worker name (`orchestra-man`) and D1 database name (the same) |
| 4. D1 database | Creates it, or reuses an existing one with that name. Writes your personal config to `worker/wrangler.local.jsonc` (ignored by git) | If it already exists: reuse it? |
| 5. Schema | Applies the migrations to D1 | wrangler may ask for confirmation: answer yes |
| 6. Deploy | Deploys and detects the `*.workers.dev` URL | The URL, only if it cannot detect it |
| 7. Secrets | Sets `ADMIN_TOKEN` and, optionally, `GITHUB_TOKEN` | Generate the `ADMIN_TOKEN`? (if not, you type it hidden) and the `GITHUB_TOKEN` (hidden, Enter to skip) |
| 8. This machine | Waits for the Worker to respond, issues a token for this machine and configures the plugin | Machine name (the hostname) and configure the plugin? |

At the end it shows the URL and, **only once**:
- the `ADMIN_TOKEN`, if it generated one: store it in your password manager;
- the machine token, if you chose not to configure the plugin here.

Secrets you type are never shown and never end up in your shell history.

### Running it again

It is safe to run it again, for example after an error:
- the database is reused;
- migrations apply only what is new;
- the deployment is updated.

If you choose to **generate** the `ADMIN_TOKEN`, the previous one stops working. Machine tokens already issued keep working, because the Worker stores them in D1.

### Non-interactive (CI or reinstall)

`--yes` takes every default value. You can also give any answer through an environment variable:

```bash
OM_WORKER_NAME=orchestra-man OM_MACHINE_NAME=laptop-tomas bash scripts/setup-worker.sh --yes
```

| Variable | Answer |
| --- | --- |
| `OM_WORKER_NAME`, `OM_DATABASE_NAME` | Names |
| `OM_REUSE_DATABASE` | `s` or `n` |
| `OM_GENERATE_ADMIN_TOKEN` | `s` or `n` |
| `OM_ADMIN_TOKEN`, `OM_GITHUB_TOKEN` | Secrets (avoid leaving them in your shell history) |
| `OM_WORKER_URL` | URL, if it is not detected |
| `OM_MACHINE_NAME` | Name of this machine's token |
| `OM_CONFIGURE_PLUGIN` | `s` or `n` |
| `OM_LOCAL_CONFIG` | Path to the personal config (default `worker/wrangler.local.jsonc`) |

`bash scripts/setup-worker.sh --help` shows the summary.

## Manual option

If you prefer to do it by hand, or the script fails in your environment, these are the same steps.

### 1. Log in and create the database

```bash
npx wrangler login
npx wrangler d1 create orchestra-man
```

### 2. Personal config

`worker/wrangler.jsonc` is the versioned template; do not put your id there. Copy it to `worker/wrangler.local.jsonc`, which git ignores, and replace `REPLACE_WITH_YOUR_DATABASE_ID` with the `database_id` printed by the previous step. If you used other names, also change `name` and `database_name`.

```bash
cp worker/wrangler.jsonc worker/wrangler.local.jsonc
```

All the following commands use `-c worker/wrangler.local.jsonc`, and the `npm run worker:*` scripts already do that.

### 3. Schema

```bash
npm run worker:migrate:remote
```

Applies `migrations/0001_init.sql`: tables, indexes, the FTS5 search table and its triggers. It uses the `DB` binding, so it works with any database name.

### 4. Deploy

```bash
npm run worker:deploy
```

Note the URL it prints, for example `https://orchestra-man.<your-subdomain>.workers.dev`. You deploy before setting the secrets because `wrangler secret put` on a Worker that does not exist asks whether to create it.

### 5. Secrets

The `ADMIN_TOKEN` is only used to issue and revoke machine tokens. Generate a long one (32 characters or more) and store it in your password manager:

```bash
openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN -c worker/wrangler.local.jsonc
```

**Optional**: to let `orchestra_wake` start a stopped codespace, set a GitHub **classic PAT** with the `codespace` scope, from the same user who owns the codespaces. The GitHub API does not document which permission fine-grained tokens need for this operation.

```bash
npx wrangler secret put GITHUB_TOKEN -c worker/wrangler.local.jsonc
```

Without this secret everything works the same, except `orchestra_wake`, which returns `unavailable`.

### 6. Verify

```bash
curl https://orchestra-man.<your-subdomain>.workers.dev/v1/health
# {"status":"ok","service":"orchestra-man","version":"0.2.0"}
```

### 7. Machine token and plugin

Issue a token (see the next section) and follow [install-plugin.md](install-plugin.md) with the URL and the token.

## Issue more tokens

One token per laptop or codespace, so you can revoke them separately:

```bash
export ORCHESTRA_URL=https://orchestra-man.<your-subdomain>.workers.dev
read -r -s -p "ADMIN_TOKEN: " ADMIN_TOKEN; echo

curl -s -X POST "$ORCHESTRA_URL/v1/admin/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"name":"laptop-tomas"}'
# {"id":"tok_...","name":"laptop-tomas","token":"om_...","createdAt":"..."}
```

The `token` is shown **only once**: the Worker stores only its SHA-256. To revoke it:

```bash
curl -s -X POST "$ORCHESTRA_URL/v1/admin/tokens/<id>/revoke" -H "Authorization: Bearer $ADMIN_TOKEN"
```

> One token per machine, but all your machines share the same database. To share memory with a colleague, both of you must point to the same Worker; if each of you deploys your own, each has their own memory.

## Automatic maintenance

The Worker includes a daily Cron Trigger (`17 3 * * *`, UTC) that:

- deletes read messages after `RETENTION_ACKED_MESSAGE_DAYS` (7) and unread ones after `RETENTION_UNREAD_MESSAGE_DAYS` (30);
- deletes checkpoints older than `RETENTION_CHECKPOINT_DAYS` (30), **always keeping the latest one for each repo**;
- releases expired leases.

The values are in `vars` in `worker/wrangler.jsonc`; if you change them, also change them in your `worker/wrangler.local.jsonc`. Memories do not expire: they are updated by upsert.

## Local Worker development

It needs no account and no personal config: it uses the template and a local D1.

```bash
cp worker/.dev.vars.example worker/.dev.vars   # and edit ADMIN_TOKEN
npm run worker:migrate:local
npm run worker:dev                             # http://localhost:8787
```

## Update

```bash
git pull
npm ci
npm run worker:migrate:remote   # applies only new migrations
npm run worker:deploy
```

## Backups

D1 has Time Travel: you can restore the database to any minute in the last 7 days (Free) or 30 days (Paid) with `npx wrangler d1 time-travel restore`.

`wrangler d1 export` **does not work with databases that have virtual tables**, and `memories_fts` is one. The procedure Cloudflare recommends is to drop the virtual table, export, and recreate it:

```bash
# `d1 export` needs the database name (not the binding): use the database_name from your local config.
DB="orchestra-man -c worker/wrangler.local.jsonc --remote"
npx wrangler d1 execute $DB --command "DROP TRIGGER memories_ai; DROP TRIGGER memories_ad; DROP TRIGGER memories_au; DROP TABLE memories_fts;"
npx wrangler d1 export $DB --output backup.sql
# Recreate the table and triggers by copying their block from migrations/0001_init.sql, then:
npx wrangler d1 execute $DB --command "INSERT INTO memories_fts(memories_fts) VALUES('rebuild');"
```

While the table does not exist, search fails and so do memory writes. Do it with all sessions closed.
