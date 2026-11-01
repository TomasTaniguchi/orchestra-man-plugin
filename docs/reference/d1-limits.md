# D1 limits and how they are respected

Verified on 2026-10-31 at <https://developers.cloudflare.com/d1/platform/limits/>. Check them again if Cloudflare changes them.

| Limit | Free | Paid |
| --- | --- | --- |
| Size per database | 500 MB | 10 GB |
| Storage per account | 5 GB | 1 TB |
| Queries per Worker invocation | 50 | 1,000 |
| Bound parameters per query | 100 | 100 |
| SQL statement length | 100 KB | 100 KB |
| Row, string or BLOB size | 2 MB | 2 MB |
| Query duration | 30 s | 30 s |
| Query result size | 50 MB (from 2026-11-04) | 50 MB |
| Simultaneous connections per invocation | 6 | 6 |
| Time Travel | 7 days | 30 days |

Concurrency: each database processes **one query at a time**. Throughput is roughly 1 / query duration. Excess requests are queued, and if the queue fills up D1 responds "overloaded".

`batch()` counts as **one** query against the per-invocation limit, runs as a transaction, and applies the per-statement limits to each statement.

Undocumented: maximum statements per `batch()` and writes per second.

## How orchestra-man respects them

| Limit | Measure | Where |
| --- | --- | --- |
| 50 queries per invocation | Each request makes at most ~3 queries: authentication, the operation, and a follow-up read. A batch of memories is a single `batch()` | `src/core/service.ts` |
| 100 parameters per query | The memory upsert uses 10; no statement exceeds 11 | `src/core/repositories/*` |
| Statements per batch (undocumented) | At most 50 memories per request (`LIMITS.memoriesPerBatch`) | `src/core/contract.ts` |
| 2 MB per row | Memory content ≤ 64,000 characters, message body ≤ 32,000, checkpoint summary ≤ 32,000. The client truncates before sending | `LIMITS`, `src/plugin/sync.ts` |
| 100 KB per statement | Values go as bound parameters, not inside the SQL | Repositories |
| 50 MB per result | Searches ≤ 50 results with snippets, inbox ≤ 100 messages | Repositories |
| 500 MB per database | Daily retention of messages and checkpoints. Memories are updated by upsert, not duplicated | Worker cron |
| One query at a time | Short, indexed queries. Monitor every 30 s per machine | `inboxPollSec` |
| Request body | The Worker rejects bodies larger than 4 MB | `src/worker/index.ts` |

## Usage estimate

With 5 machines open for 8 hours: the monitor makes about 960 inbox queries per machine per day, plus a sync every 5 minutes (about 5 requests each). That adds up to fewer than 30,000 queries per day, well below what the Free plan handles. Check current Workers and D1 pricing if you scale to a large team.
