---
name: orchestra
description: orchestra-man multi-agent protocol. Use it when a task touches more than one repository or microservice, when you need to know how another service works (methods, endpoints, contracts), or when a message from another repo (investigate-request, edit-request) arrives in the inbox.
---

# orchestra-man: multi-agent protocol

Each repository has its own Claude Code with this plugin. You share masked memory, checkpoints and a message inbox through the user's backend (their Worker with D1, or a local SQLite). You do the reasoning; the LangGraph graph only sequences the steps and stores the state.

Always answer the user in the user's language.

## Before asking or waking another repo

1. `orchestra_recall` with words from the problem (it works even if the other repo's codespace is stopped).
2. `orchestra_checkpoints` to see the branch and commit where each repo left off.
3. If memory is enough, do not bother anyone. Always state the date of the checkpoint you rely on: that context may be stale.

Only if you need to **run or edit** something in another repo and it is offline, offer `orchestra_wake` and warn the user that it starts a codespace (it has a cost).

## When you are the orchestrator (the request started here)

1. `orchestra_task_start` with the goal and the repos involved. Follow the `instruction` that each step returns.
2. **investigate**: read the context, review your code, and collect the `investigate-result` replies with `orchestra_inbox`. Report with `orchestra_task_advance` kind=findings.
3. **plan**: a concrete plan per repo (files, changes, risks, how to verify). kind=plan.
4. **approve**: show the plan to the user and wait for their explicit decision. Only then call `orchestra_task_approve` with `approve`, `revise` or `plan-only`. **Never decide for the user and never edit before this step.**
5. **edit**: changes on a new branch, never on the main branch. The other repos receive `edit-request`. kind=edits with repo, branch and summary.
6. **verify**: tests, lint and build in each touched repo. kind=verification. If it fails, the graph returns to edit; after several failures it returns to plan and you must ask for authorization again.
7. **propose**: one pull request per repo, without merging. kind=pull-requests.

If `orchestra_task_advance` returns `conflict` because another agent holds the lease, do not insist: read the task with `orchestra_task_get` and tell the user who is orchestrating it.

## When a message arrives

The plugin monitor notifies you with a `[orchestra-man] … message from …` line. Then:

- Read it in full with `orchestra_inbox`.
- `investigate-request`: investigate only in your repo and reply with `orchestra_send` kind=investigate-result, same `taskId`, to the `fromRepo`.
- `edit-request`: the user already authorized it in the orchestrator repo, but **confirm with the user of this session** before editing here. New branch, tests, and reply kind=edit-result with the branch and the result.
- When done, `orchestra_ack` with the message id.

## Sensitive data

Everything that leaves this machine is masked (emails, phone numbers, tokens, keys, UUIDs, numeric ids). You will see placeholders like `<email:1a2b3c4d>`: the same value always produces the same placeholder, so you can correlate them, but do not try to reconstruct the value. Do not paste secrets into messages or plans, even though masking covers them.
