# 0006. Client-side masking with HMAC placeholders

**Status**: accepted (2026-10-31)

## Context

Uploading company code and context is allowed, but IDs and personal data (emails, phone numbers) must be hidden, as well as secrets. For the first version, good-enough masking is sufficient; it will be improved iteratively.

## Decision

- Mask on the client, before the network: what never leaves cannot leak.
- A single enforcement point: the `maskedRemote` decorator, which `createRuntime` always applies.
- Ordered regex rules, extensible through configuration.
- `<rule:hmac8>` placeholders with a local salt: deterministic (agents can correlate them) and not reversible by dictionary attack without the salt.

## Consequences

- There are false negatives (names, addresses, free text). They are documented in `docs/reference/masking.md`.
- All machines must share the salt.
- Routing identifiers (repo, agent, ids) are not masked.
- To raise the bar, an entity detector can be added without changing the `Mask` interface.
