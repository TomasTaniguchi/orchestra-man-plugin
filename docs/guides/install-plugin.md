# Install and configure the plugin

Install it in **every** codespace and local clone you want to connect. All of them must point to the same backend and use the **same masking salt**.

Nothing else is needed: each repo's memory is built into the plugin. You only need Node.js 22.13 or later (codespaces with the universal image already have it; otherwise, add the `node` feature in `devcontainer.json`).

## 1. Install

In Claude Code:

```
/plugin marketplace add TomasTaniguchi/orchestra-man-plugin
/plugin install orchestra-man@orchestra-man
```

For everyone working on a repo, you can install it with project scope (it goes into the repo's `.claude/settings.json`). Each person still installs it on their own machine.

## 2. Configure

The config lives in `~/.config/orchestra-man/config.json` (permissions 0600), and environment variables take precedence. Details for each key are in [configuration.md](../reference/configuration.md).

### Local clone, shared mode (D1)

In Claude Code:

```
/orchestra-man:configure d1
```

The skill sets the mode and the URL. You enter the token yourself in **your terminal** (not in the chat), so it does not end up in any history:

```bash
node ~/.claude/plugins/<path-the-skill-gives-you>/dist/cli.mjs configure --token-stdin
# paste the token, Enter, Ctrl-D
```

### Codespace

Codespaces need no file. Create **GitHub Codespaces** secrets (Settings → Codespaces → Secrets) and assign them to the relevant repos:

| Secret | Value |
| --- | --- |
| `ORCHESTRA_URL` | Your Worker's URL |
| `ORCHESTRA_TOKEN` | Token issued for codespaces |
| `ORCHESTRA_MASK_SALT` | The same salt you use on your other machines |

The plugin processes (MCP server, hooks and monitor) read these variables. Restart the codespace after creating them. GitHub exposes `CODESPACES` and `CODESPACE_NAME`, and the plugin uses them to register as a codespace agent (this enables `orchestra_wake`).

### This machine only (local mode)

```
/orchestra-man:configure local
```

Uses a SQLite file at `~/.local/share/orchestra-man/orchestra.db`. Useful for several local clones on the same machine without the cloud.

### The masking salt

The first time, a random `maskSalt` is generated. **Copy it unchanged to all your machines** (file or `ORCHESTRA_MASK_SALT` secret): if two machines use different salts, the same email produces different placeholders and agents cannot correlate them. Do not share it outside your machines.

## 3. Verify

Restart the Claude Code session and run:

```
/orchestra-man:help
```

If the "Status" section says "All good.", it is ready. If not, each item tells you what to do. You will also see the `# orchestra-man` block when each session opens.

## Permissions

Claude Code asks for permission for the MCP tools the first time. Recommendation:

- Allow the read tools without asking (`orchestra_status`, `orchestra_recall`, `orchestra_checkpoints`, `orchestra_inbox`, `orchestra_task_get`).
- Do **not** add `orchestra_task_approve` to the allow list: that permission prompt is your confirmation that code may be edited.
