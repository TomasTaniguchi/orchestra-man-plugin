# 0001. TypeScript everywhere

**Status**: accepted (2026-10-31)

## Context

There are three pieces: a Cloudflare Worker, a Claude Code plugin (MCP server, hooks, monitor) and orchestration with LangGraph. Engram, which we use as a reference, is written in Go.

## Decision

All three pieces are written in TypeScript, in a single package:

- Workers run JavaScript natively.
- LangGraph has an official JavaScript version.
- The TypeScript MCP SDK is the reference SDK.
- A single language allows **one contract** (`src/core/contract.ts`), validated by both server and client, and one data layer.

## Consequences

- No Go code from Engram is reused; its behavior was reproduced in TypeScript (see [0008](0008-built-in-local-first-memory.md)).
- The plugin requires Node.js 22.13 or later, because of `node:sqlite`.
- A single `package.json` instead of a monorepo with workspaces: less configuration, and each artifact (Worker and plugin bundle) takes only what it imports.
