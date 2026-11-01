# CLI

The plugin ships a bundled CLI in `plugin/dist/cli.mjs` (source in `src/plugin/cli.ts`). The hooks and the monitor use it. You can also run it by hand.

```bash
node <plugin-path>/dist/cli.mjs <command>
```

In a skill, the path is `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`.

| Command | Used by | What it does |
| --- | --- | --- |
| `session-start` | `SessionStart` hook (`startup`, `resume`, `clear`) | Opens the session, syncs, saves a checkpoint, and prints the repo memory and the cross-repo context (stdout is added to Claude's context) |
| `post-compact` | `SessionStart` hook (`compact`) | Prints the recovery steps (save the compacted summary) and the full memory |
| `session-end` | `SessionEnd` hook | Closes the session, runs a final sync and checkpoint, no output |
| `subagent-stop` | `SubagentStop` hook | Saves the "Key Learnings" items from the subagent's last response (passive capture) |
| `watch` | `orchestra-watch` monitor | Loop: every `inboxPollSec` it prints one line per new message; every `checkpointIntervalSec` it syncs |
| `doctor` | `/orchestra-man:help`, by hand | Read-only diagnosis: configuration, backend and its version, agent, memory and unsynced changes, other repos and inbox, with what to do about each problem. Exits with code 1 on errors. Works even when the configuration is missing |
| `sync` | by hand | Syncs and checkpoints now; prints the result as JSON |
| `status` | by hand | Agent, sync target, and effective configuration (secrets shortened) |
| `configure` | `configure` skill | Edits the configuration file |
| `help` | — | Usage |

## `configure`

```bash
cli.mjs configure                                  # creates the file with a new salt if it does not exist
cli.mjs configure --set mode=d1 --set workerUrl=https://orchestra-man.x.workers.dev
cli.mjs configure --set 'maskPatterns=["CUST-\\d{6}"]'
cli.mjs configure --token-stdin                    # reads the token from stdin
cli.mjs configure --show                           # shows the file (secrets shortened)
```

- `--set token=...` is forbidden on purpose: the token would end up in the shell or conversation history. Use `--token-stdin`.
- The file is written with `0600` permissions and its directory with `0700`.
- Valid keys: see [configuration.md](configuration.md).

## Hook and monitor behavior

Hooks receive the Claude Code event JSON on stdin and use `session_id`, `cwd` and, in `SubagentStop`, `last_assistant_message`.

`session-start`, `post-compact`, `session-end`, `subagent-stop` and `watch` **never fail the session**. On error they print one line `orchestra-man: <reason>` and exit with code 0. The monitor reports each distinct error only once, so a down backend is visible without flooding the conversation with warnings.

On startup, the monitor marks the messages already in the inbox as seen, because `session-start` already showed them.
