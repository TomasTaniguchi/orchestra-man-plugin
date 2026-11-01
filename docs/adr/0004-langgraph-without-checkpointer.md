# 0004. LangGraph one step per invocation, state in the backend

**Status**: accepted (2026-10-31)

## Context

- LangGraph should only orchestrate tools; Claude Code does the reasoning, to avoid extra API costs.
- The orchestrator can move between machines, and a machine can shut down mid-task.
- The LangGraph checkpointer stores state in its own storage and does not know about our lease.

## Decision

- Each `orchestra_task_*` call runs **one step**: `START → route() → phase node → END`.
- The graph state is the task's `state` in our backend. The lease is taken before the step; afterwards the state is saved with version control.
- Nodes do not call models: they validate what Claude reported, call injected tools (`GraphTools`) and return an instruction.
- Human approval is a separate MCP tool, not a LangGraph `interrupt`.

## Consequences

- Any agent holding the lease can continue the task; rotation comes naturally.
- There is no second storage to keep in sync.
- The human gate relies on the Claude Code permission system, which the user can see and configure.
- LangGraph features that depend on the checkpointer (time travel, `interrupt`) are not used. The `actions` log covers traceability.
