# 0003. Extend Engram without forking it, with our own contract

**Status**: superseded by [0008](0008-built-in-local-first-memory.md) in version 0.2.0

## Context

Engram already handles per-repo memory: the agent saves curated observations in a SQLite database with FTS5, with its own protocol and Claude Code plugin. Its sync goes through a `Transport` interface, and it has its own cloud on Postgres. We decided to use **our own contract**, not Engram Cloud's.

## Decision

- Engram remains each repo's local memory, unchanged.
- orchestra-man reads Engram's local HTTP API (`GET /observations/recent`), read-only, and replicates the observations to `memories` with its own contract, masked.
- We do not fork or modify the Go binary.

## Consequences

- Engram updates do not require maintaining a fork.
- We depend on the shape of `/observations/recent`. The client validates only the fields it uses (`src/plugin/engram.ts`) to tolerate new fields.
- Without Engram running, replication is skipped and reported; everything else works.
- `shortcut`: replication rereads a window of 200 observations on every sync. It is idempotent; if volume grows, a watermark should be added.
