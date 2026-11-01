# orchestra-man documentation

Index for people and agents. Each document covers one topic; start with the one that matches what you want to do.

## I want to use it

| Document | Purpose |
| --- | --- |
| [guides/install-plugin.md](guides/install-plugin.md) | Install and configure the plugin in local clones and codespaces |
| [guides/deploy-worker.md](guides/deploy-worker.md) | Deploy your Cloudflare Worker with D1, step by step |
| [guides/usage.md](guides/usage.md) | Usage scenarios: `/orchestra-man:help`, memory, queries, cross-repo tasks, answering requests |
| [troubleshooting.md](troubleshooting.md) | Common problems and how to fix them |

## I want to understand it

| Document | Purpose |
| --- | --- |
| [architecture/overview.md](architecture/overview.md) | Components, ports and adapters, data flow |
| [architecture/orchestration.md](architecture/orchestration.md) | The LangGraph graph, phases, leases and orchestrator rotation |
| [architecture/memory-and-sync.md](architecture/memory-and-sync.md) | Each repo's local memory, incremental sync and checkpoints |
| [security.md](security.md) | Threat model, masking, tokens |
| [adr/](adr/) | Architecture decisions and their rationale |
| [glossary.md](glossary.md) | Project terms |

## Reference

| Document | Contents |
| --- | --- |
| [api/openapi.yaml](api/openapi.yaml) | Worker HTTP contract |
| [reference/mcp-tools.md](reference/mcp-tools.md) | The 12 MCP tools |
| [reference/cli.md](reference/cli.md) | CLI commands (hooks, monitor, configure) |
| [reference/configuration.md](reference/configuration.md) | All keys, environment variables and precedence |
| [reference/data-model.md](reference/data-model.md) | Tables, indexes and concurrency rules |
| [reference/masking.md](reference/masking.md) | Masking rules and how to extend them |
| [reference/d1-limits.md](reference/d1-limits.md) | Verified D1 limits and how the plugin respects them |

## I want to modify it

| Document | Purpose |
| --- | --- |
| [../AGENTS.md](../AGENTS.md) | Repo rules, code map and commands |
| [guides/development.md](guides/development.md) | Tests, snapshots, build and recipes to extend it |
