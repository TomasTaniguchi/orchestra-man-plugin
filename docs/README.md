# Documentación de orchestra-man

Índice para personas y agentes. Cada documento cubre un tema; empezá por el que corresponda a lo que querés hacer.

## Quiero usarlo

| Documento | Para qué |
| --- | --- |
| [guides/install-plugin.md](guides/install-plugin.md) | Instalar y configurar el plugin en clones locales y codespaces |
| [guides/deploy-worker.md](guides/deploy-worker.md) | Desplegar tu Worker de Cloudflare con D1, paso a paso |
| [guides/usage.md](guides/usage.md) | Escenarios de uso: consultas, tareas entre repos, responder pedidos |
| [troubleshooting.md](troubleshooting.md) | Problemas frecuentes y cómo resolverlos |

## Quiero entenderlo

| Documento | Para qué |
| --- | --- |
| [architecture/overview.md](architecture/overview.md) | Componentes, puertos y adaptadores, flujo de datos |
| [architecture/orchestration.md](architecture/orchestration.md) | El grafo de LangGraph, fases, leases y rotación del orquestador |
| [architecture/memory-and-sync.md](architecture/memory-and-sync.md) | La memoria local de cada repo, la sincronización incremental y los checkpoints |
| [security.md](security.md) | Modelo de amenazas, enmascarado, tokens |
| [adr/](adr/) | Decisiones de arquitectura y sus razones |
| [glossary.md](glossary.md) | Términos del proyecto |

## Referencia

| Documento | Contenido |
| --- | --- |
| [api/openapi.yaml](api/openapi.yaml) | Contrato HTTP del Worker |
| [reference/mcp-tools.md](reference/mcp-tools.md) | Las 12 herramientas MCP |
| [reference/cli.md](reference/cli.md) | Comandos de la CLI (hooks, monitor, configure) |
| [reference/configuration.md](reference/configuration.md) | Todas las claves, variables de entorno y precedencia |
| [reference/data-model.md](reference/data-model.md) | Tablas, índices y reglas de concurrencia |
| [reference/masking.md](reference/masking.md) | Reglas de enmascarado y cómo extenderlas |
| [reference/d1-limits.md](reference/d1-limits.md) | Límites de D1 verificados y cómo los respeta el plugin |

## Quiero modificarlo

| Documento | Para qué |
| --- | --- |
| [../AGENTS.md](../AGENTS.md) | Reglas del repo, mapa de código y comandos |
| [guides/development.md](guides/development.md) | Tests, snapshots, build y recetas para extenderlo |
