# Security

## What leaves your machine

| Leaves (masked) | Does not leave |
| --- | --- |
| The repo's `project` memories (never `personal` ones) | Source code |
| Checkpoints: branch, commit, names of uncommitted files, memory titles | File contents |
| Messages between agents | git or GitHub credentials |
| Task state: plan, findings, branches, PR URLs | The masking salt |

Git remains the source of truth: changes travel through branches and pull requests, not through the backend.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Personal data or secrets in shared memory | Client-side masking before sending ([masking.md](reference/masking.md)). Placeholders use HMAC and a local salt. The e2e test verifies that no sensitive value from the scenario reaches any table |
| Stolen machine token | One token per machine, revocable without affecting the others. The Worker stores only its SHA-256. It is loaded via stdin or as a Codespaces secret, never through the chat or in `plugin.json` |
| Stolen `ADMIN_TOKEN` | It only issues and revokes tokens. It is compared in constant time. Rotate it with `npx wrangler secret put ADMIN_TOKEN -c worker/wrangler.local.jsonc` |
| An agent edits another repo without permission | The graph requires the `approve` decision before the `edit` phase. `orchestra_task_approve` is a separate tool, so Claude Code asks for your permission. The repo that receives an `edit-request` also asks for confirmation in its own session. Changes go to new branches and PRs, never to the main branch |
| Two orchestrators on the same task | Lease with expiration and optimistic versioning in a single atomic SQL statement |
| Malicious instructions inside messages or memories | Messages are written by other agents from your own repos and are treated as data. The skill says not to edit without local confirmation. If you connect third-party repos, review their requests |
| Configuration file readable by other users | It is written with `0600` and its directory with `0700` |
| Huge or invalid payloads | zod validation of every input in the service, per-field size limits and 4 MB per request |
| Unwanted codespace starts | `orchestra_wake` requires a `GITHUB_TOKEN` that you load into your Worker, and only starts codespaces registered by your agents |

## Remaining risks

- Rule-based masking does not detect everything (names, addresses, free text).
- Names of uncommitted files and branch names are sent as is.
- If you share a Worker with colleagues, everyone with a token reads all the memory. There are no per-repo permissions in v0.1.
- Before using it with company code, confirm with your security team that uploading this masked content to Cloudflare is allowed.

## Report a problem

Open a private issue (Security Advisory) in the GitHub repository.
