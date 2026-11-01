# Architecture decision records (ADR)

Each ADR records a decision, its context and its consequences. If a decision changes, a new ADR is added that supersedes the previous one; history is not rewritten.

| # | Decision |
| --- | --- |
| [0001](0001-typescript-everywhere.md) | TypeScript in the Worker, the plugin and orchestration |
| [0002](0002-one-sql-two-backends.md) | A D1-shaped interface to run the same SQL on D1 and on local SQLite |
| [0003](0003-extend-engram-without-fork.md) | ~~Extend Engram by reading its API~~ (superseded by 0008) |
| [0004](0004-langgraph-without-checkpointer.md) | LangGraph one step per invocation; state lives in the backend with a lease |
| [0005](0005-config-file-and-environment.md) | Configuration via a 0600 file and environment variables, not `userConfig` |
| [0006](0006-client-side-masking.md) | Client-side masking with HMAC placeholders |
| [0007](0007-committed-bundle.md) | Plugin bundle committed in `plugin/dist` |
| [0008](0008-built-in-local-first-memory.md) | Built-in, local-first memory, with no dependency on Engram |
