# 0005. Configuration via file and environment, not `userConfig`

**Status**: accepted (2026-10-31). Supersedes the initial idea of storing credentials in the plugin's `userConfig`.

## Context

`plugin.json` lets you declare `userConfig` and stores sensitive values in the system keychain. According to the manifest reference, those values reach hooks and MCP servers, but **not monitors**: "Monitor processes don't receive `CLAUDE_PLUGIN_OPTION_<KEY>`". The monitor needs the token to read the inbox and to sync.

## Decision

- A single source for all processes: environment variables take precedence over `~/.config/orchestra-man/config.json` (permissions 0600, directory 0700).
- In codespaces, GitHub Codespaces secrets (`ORCHESTRA_URL`, `ORCHESTRA_TOKEN`, `ORCHESTRA_MASK_SALT`).
- On local machines, `configure --token-stdin`: the token never goes through the conversation or the shell history. `--set token=` is rejected.

## Consequences

- The local token lives in a private file, as with wrangler or the AWS CLI, instead of the keychain.
- The MCP server, the hooks and the monitor see exactly the same configuration.
- If a future Claude Code version passes `userConfig` to monitors, this can be reconsidered.
