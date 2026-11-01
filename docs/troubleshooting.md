# Troubleshooting

| Symptom | Likely cause | Solution |
| --- | --- | --- |
| `! Backend: responde con la versión X; el plugin espera Y` | The Worker is on a different version | In the plugin repo: `git pull && npm ci && npm run worker:migrate:remote && npm run worker:deploy` |
| `! Agente: … el repo no tiene remoto git` | Clone without `origin` | `git remote add origin <url>`: otherwise the others do not recognize it as `owner/name` |
| When the session opens: `orchestra-man is not configured correctly (maskSalt …)` | No configuration file or variables | `/orchestra-man:configure` |
| `mode is d1 but workerUrl or token is missing` | D1 mode without URL or token | `configure --set workerUrl=…` and `configure --token-stdin` |
| `invalid or revoked token` (`unauthorized`) | Token copied incorrectly or revoked | Issue a new one ([deploy-worker.md](guides/deploy-worker.md#issue-more-tokens)) |
| `cannot reach https://…` (`unavailable`) | Worker down, wrong URL or no network | `curl <url>/v1/health` |
| Another repo cannot find a just-saved memory | It has not synced yet | It is published on the next sync (up to `checkpointIntervalSec`), or instantly with `orchestra_sync` |
| A memory does not show up in `orchestra_recall` | It is `personal`, deleted, or searched from the same repo before syncing | `orchestra_search` searches this repo's local memory, including personal ones |
| `memory #N not found in owner/repo` | The id belongs to another repo or the memory was deleted | Ids are local to each machine; search again |
| `Backend compartido no disponible` at startup | Worker down or no network | Local memory keeps working; it syncs when the backend is back |
| The other repo shows as `offline` even though it is open | Its monitor is not running or it has no configuration | In that session, run `/orchestra-man:configure` and restart. `agentStaleMinutes` sets the threshold |
| New-message notifications do not arrive | The monitor did not start (monitors do not run in `-p` mode) | Restart the interactive session; check `/tasks` |
| `task … is leased by … until …` (`conflict`) | Another agent is orchestrating the task | Wait for the lease to expire (10 min) or continue from that machine |
| `task … is at version N, not M` | Another agent advanced the task between your read and your write | `orchestra_task_get` and repeat the step |
| `phase "plan" expects plan, got "edits"` | Something was reported that does not match the phase | Follow the task's `instruction` |
| `wake is not configured on this backend` | Local mode, or Worker without `GITHUB_TOKEN` | Load the secret into the Worker |
| `GitHub refused to start …: HTTP 402` | No Codespaces quota or payment | Check your Codespaces billing |
| Different placeholders for the same email in different repos | Different salts across machines | Use the same `maskSalt` on all of them |
| `wrangler d1 export` fails | D1 does not export databases with virtual tables (FTS5) | See "Backups" in [deploy-worker.md](guides/deploy-worker.md#backups) |
| `ExperimentalWarning: SQLite is an experimental feature` | Node warning about `node:sqlite` | Harmless; it goes to stderr |

## Diagnosis

Always start here:

```
/orchestra-man:help
```

It checks the configuration, the backend (whether it responds, whether it rejects the token, whether the Worker version matches), the agent identity, the repo's memory and unsynced changes, the other repos and the inbox. For each problem it says what to do.

From the terminal, without Claude Code:

```bash
node <plugin-path>/dist/cli.mjs doctor   # the same diagnosis; exits with code 1 if there are errors
node <plugin-path>/dist/cli.mjs status   # effective configuration (shortened secrets) and identity
node <plugin-path>/dist/cli.mjs sync     # forces a sync and shows the result
```
