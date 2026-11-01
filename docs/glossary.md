# Glossary

| Term | Meaning |
| --- | --- |
| **Agent** | A Claude Code session with the plugin, in one repo and on one machine. Id `repo#machine` |
| **Orchestrator** | The agent that holds a task's lease. Initially, the one that created it; it can rotate |
| **Lease** | Exclusive, temporary permission (10 minutes, renewable) to run a task's steps |
| **Backend** | Where shared data is stored: your Worker with D1 (`d1` mode) or a local SQLite (`local` mode) |
| **Memory** | Curated knowledge an agent saves with `orchestra_save`. It lives in the local SQLite and, if it is `project`, it is published masked to the backend |
| **Scope** | `project` (shared) or `personal` (never leaves the machine) |
| **topic_key** | Stable key for a topic (`architecture/invoice-api`). Saving with the same key updates the memory and keeps the previous version |
| **change_seq** | Monotonic sequence of local memory changes; sync advances along it |
| **Checkpoint** | Snapshot of a repo: branch, commit, uncommitted files and recent memories |
| **Inbox** | Messages addressed to a repo, not a machine: any agent of that repo can handle them |
| **Phase** | A graph stage: investigate, plan, approve, edit, verify, propose, done, cancelled |
| **Instruction** | Text the graph returns at each step to tell Claude what to do |
| **Placeholder** | Replacement for a sensitive value, such as `<email:bab800ec>` |
| **Salt** | Local secret that makes placeholders irreversible. The same on all your machines |
| **Monitor** | Plugin process that runs during the session: notifies new messages and syncs periodically |
| **Wake** | Starting a shut-down codespace through the GitHub API |
| **`Remote` port** | Interface the plugin uses to talk to the backend, whichever it is |
| **`SqlDatabase`** | D1-shaped interface that lets the same SQL run on D1 and on `node:sqlite` |
