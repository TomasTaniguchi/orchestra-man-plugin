# Configuration

Code: `src/plugin/config.ts`.

## Precedence

1. Environment variables.
2. The file `~/.config/orchestra-man/config.json` (or `$XDG_CONFIG_HOME/orchestra-man/config.json`, or the path in `ORCHESTRA_CONFIG`).
3. Defaults.

If `mode` is not set, it is `d1` when `workerUrl` and `token` are present, and `local` otherwise.

### Why a file and not the plugin's `userConfig`

Claude Code lets a plugin declare `userConfig` in `plugin.json` and stores sensitive values in the system keychain. But those values **do not reach monitors**, and the `watch` monitor needs the token to read the inbox. So every plugin process (MCP server, hooks and monitor) reads the same source: environment variables or a file with 0600 permissions. See [ADR 0005](../adr/0005-config-file-and-environment.md).

## Keys

| Key | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `mode` | `ORCHESTRA_MODE` | `d1` if URL and token are set, otherwise `local` | Backend: your Worker (`d1`) or local SQLite (`local`) |
| `workerUrl` | `ORCHESTRA_URL` | — | Worker URL. Required in `d1` mode |
| `token` | `ORCHESTRA_TOKEN` | — | This machine's token. Required in `d1` mode. Set it with `configure --token-stdin` |
| `localDbPath` | `ORCHESTRA_LOCAL_DB` | `~/.local/share/orchestra-man/orchestra.db` | Local SQLite file: the repo memory (always) and, in `local` mode, also the shared backend |
| `maskSalt` | `ORCHESTRA_MASK_SALT` | generated when the file is created | Masking secret (at least 16 characters). **Same on all your machines** |
| `maskPatterns` | `ORCHESTRA_MASK_PATTERNS` (JSON array) | `[]` | Extra regexes to mask as `<custom:…>` |
| `checkpointIntervalSec` | `ORCHESTRA_CHECKPOINT_INTERVAL` | `300` (minimum 60) | How often the monitor syncs memory and checkpoints |
| `inboxPollSec` | `ORCHESTRA_INBOX_POLL` | `30` (minimum 10) | How often the monitor polls the inbox |
| `agentStaleMinutes` | `ORCHESTRA_AGENT_STALE_MINUTES` | `15` | With no heartbeat for longer than this, an agent shows as offline |

## Agent identity

It is not configured: it is detected.

- **repo**: `owner/name` from `git remote get-url origin`, or `local/<directory>` if there is no remote.
- **machine**: `CODESPACE_NAME` in a codespace (when `CODESPACES=true`), otherwise the hostname.
- **id**: `<repo>#<machine>`, for example `acme/api#laptop` or `acme/billing#cs-billing`.

## Codespaces

Use GitHub Codespaces secrets (`ORCHESTRA_URL`, `ORCHESTRA_TOKEN`, `ORCHESTRA_MASK_SALT`). No file is needed.

## Worker variables

In `vars` of your `worker/wrangler.local.jsonc` (personal copy of the `worker/wrangler.jsonc` template) and as wrangler secrets:

| Name | Type | Description |
| --- | --- | --- |
| `ADMIN_TOKEN` | secret | Issues and revokes machine tokens |
| `GITHUB_TOKEN` | secret, optional | Classic PAT with the `codespace` scope. Enables `orchestra_wake` |
| `RETENTION_ACKED_MESSAGE_DAYS` | var | Days read messages are kept (7) |
| `RETENTION_UNREAD_MESSAGE_DAYS` | var | Days unread messages are kept (30) |
| `RETENTION_CHECKPOINT_DAYS` | var | Days checkpoints are kept. The latest one for each repo is never deleted (30) |
