# 0008. Built-in memory, local first

**Status**: accepted (2026-10-31). Supersedes [0003](0003-extend-engram-without-fork.md).

## Context

Version 0.1 read Engram's memory through its local HTTP API. In practice, that required installing the Engram binary and its plugin in every clone and every codespace, and it depended on the shape of its API. Also, replication was not incremental.

## Decision

orchestra-man ships its own memory, reproducing the Engram behavior we use:

- saving with type, scope and `topic_key`, upsert by topic with version history, 15-minute dedupe, `<private>`, and soft or hard delete;
- FTS5 search, session context, pins, timeline and `topic_key` suggestion;
- sessions with summaries, recovery after compaction and passive capture of "Key Learnings";
- the memory protocol as a skill.

The memory lives in the same local SQLite as the plugin, with `mem_*` tables separate from the shared backend tables. Sync is incremental, driven by a monotonic change sequence, and propagates withdrawals without content.

## What was not reproduced

- Capturing every user prompt: it is intrusive and not needed to share knowledge across repos.
- The conflict judge (`mem_judge`, `mem_compare`), project aliases and project merging.
- TUI, Obsidian export, its own cloud, and `doctor`.
- `global` scope: the shared backend provides the cross-repo value.

## Consequences

- Installing the plugin is enough; there are no external dependencies.
- The built-in memory works even when the shared backend is unavailable.
- Anyone who already has memories in Engram does not see them in orchestra-man. If needed, a one-off importer can be added.
- `shortcut`: if two sessions of the same repo are open at the same time on one machine, memories saved through MCP are attached to the most recent one. Engram solves this by injecting the `session_id` with a `PreToolUse` hook; that can be added if needed.
