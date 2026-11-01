---
name: memory
description: "ALWAYS ACTIVE. Persistent memory for this repository: what to save (decisions, root causes, contracts, constraints), how to update by topic, how to recall, and what to do when closing a session or after a compaction."
---

# Memory for this repository

You have a persistent memory that survives across sessions and compactions. It lives on this machine and is shared, masked, with the agents of the other repositories on every sync. Follow this protocol without waiting to be asked.

## What to save

Save knowledge that is **verified, durable, and expensive to rebuild**:
- decisions with their reasoning;
- root causes that were not obvious;
- API and event contracts that other services consume;
- real constraints;
- pending work that matters for picking things up again.

Group related conclusions; do not save every step.

**Do not save:** secrets, personal data, speculation, raw dumps, or routine progress. If a sensitive value is essential, wrap it in `<private>…</private>`: it is not saved, not even locally.

Memories may be written in the user's language.

`orchestra_save` format:
- **title**: verb + what, short and searchable ("Fixed N+1 in OrderList", "Chose D1 over KV").
- **type**: `bugfix`, `decision`, `architecture`, `discovery`, `pattern`, `config`, `preference` or `learning`.
- **scope**: `project` (default, shared with the other repos) or `personal` (this machine only, never uploaded).
- **topicKey**: stable key for topics that evolve, for example `architecture/invoice-api`. You can ask for a suggestion with `orchestra_suggest_topic_key`.
- **content**:
  - **What**: one sentence about what was done.
  - **Why**: what motivated it.
  - **Where**: files or paths.
  - **Learned**: surprises and edge cases (omit it if there are none).

## Update by topic (required)

1. Before writing about a topic, search with `orchestra_search` and read the candidates in full with `orchestra_get`. A snippet does not prove it is the same topic.
2. **Same topic**: save with the same `topicKey`, or use `orchestra_update` with the id. The previous version stays in the history. Keep the facts that are still valid.
3. **New topic**: `orchestra_save` with a different, deliberate `topicKey`. If it is already covered, do not write anything.
4. If you are not sure it is the same topic, or the search failed, do not overwrite or duplicate: ask, or continue without saving.

Saving the same thing twice within 15 minutes does not duplicate it: it only increments a counter.

## Recall

When the user asks about past work ("what did we do with…?", "remember…", "how did we solve…?"):

1. `orchestra_context`: recent sessions, pinned and recent memories for this repo. It is fast.
2. `orchestra_search` with distinctive words.
3. `orchestra_get` for the full content. `orchestra_timeline` shows what was saved before and after in the same session.
4. If it is about **another** repository, use `orchestra_recall` (see the `orchestra` skill).

Search when it actually helps; mentioning the project is not enough reason to search.

Pin with `orchestra_pin` what must always be in the context, such as a central contract or a repo rule.

## Closing a session

On an explicit close or handoff, call `orchestra_session_summary` with:
- **Goal**
- **Instructions**
- **Discoveries**
- **Accomplished**
- **Next Steps**
- **Relevant Files**

Finishing an ordinary task does not require a summary.

## After a compaction

If the context says it was compacted (a block reading "el contexto se compactó"):

1. **First**, `orchestra_session_summary` with the content of the compacted summary. Otherwise, the work done before compaction is lost.
2. Then read the injected memory and, if needed, `orchestra_context`.
3. Only then continue with the task.

## Passive capture

If a subagent ends its response with a `## Key Learnings` or `## Aprendizajes` section of list items, the plugin saves each new item as a memory. It is a safety net; it does not replace `orchestra_save`. You can also call `orchestra_capture_passive` with text that contains that section.

## Delivery

Memory is internal bookkeeping, not the answer. Save before writing the final answer. If saving fails, answer anyway, and do not say something was saved unless you confirmed it.
