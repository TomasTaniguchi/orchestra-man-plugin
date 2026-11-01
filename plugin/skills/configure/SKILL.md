---
name: configure
description: Configures orchestra-man on this machine (D1 mode with your Worker or local SQLite, URL, token, masking salt, intervals). Use it when the user asks to configure orchestra-man or when a tool says it is not configured.
disable-model-invocation: true
argument-hint: "[d1|local]"
---

# Configure orchestra-man

The config lives in `~/.config/orchestra-man/config.json` (permissions 0600), and environment variables override it. The CLI is:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" configure --show
```

Follow these steps with the user. Argument received: `$ARGUMENTS`. Answer the user in the user's language.

## 1. Choose a mode

- **d1**: memory and coordination shared across machines through the user's Worker. Requires a deployed Worker: in the plugin repo, `npm run worker:setup` does it interactively and leaves that machine configured (guide `docs/guides/deploy-worker.md`).
- **local**: SQLite on this machine. Useful for several local Claude sessions on the same machine, or to try it without the cloud.

## 2. Non-secret values

Run them yourself with Bash, for example:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" configure --set mode=d1 --set workerUrl=https://orchestra-man.<subdomain>.workers.dev
```

Other keys: `checkpointIntervalSec` (minimum 60), `inboxPollSec`, `agentStaleMinutes`, `localDbPath`, `maskPatterns` (JSON array of extra regexes, for example `'["CUST-\\d{6}"]'`).

## 3. The token: never through the chat

**Do not ask the user for the token in the conversation and do not put it in a command you run**: it would end up in the history. Ask them to run this in their own terminal and paste the token, ending with Ctrl-D:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" configure --token-stdin
```

In a **codespace**, the recommended approach is to use no file: create the GitHub Codespaces secrets `ORCHESTRA_URL`, `ORCHESTRA_TOKEN` and `ORCHESTRA_MASK_SALT` for the relevant repos, and restart the codespace.

## 4. Same salt on every machine

The masking salt (`maskSalt`) is generated automatically the first time. For the same email to produce the same placeholder in every repo, **all machines must use the same salt**. Tell the user to copy the `maskSalt` value from their file to the other machines (or to the `ORCHESTRA_MASK_SALT` secret). Do not print it in full yourself.

## 5. Verify

Call the `orchestra_status` tool (or run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" doctor`) and show the diagnosis to the user. If the "Status" section says "All good.", it is ready. If not, resolve each item it lists.

Remind the user to restart the Claude Code session so the start hook and the monitor pick up the config, and that `/orchestra-man:help` shows this diagnosis and a guide with examples whenever they need it.
