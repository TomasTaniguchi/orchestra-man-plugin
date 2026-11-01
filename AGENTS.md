# AGENTS.md

Punto de entrada para agentes de IA que trabajan **sobre este repositorio**. Los agentes que **usan** el plugin leen `plugin/skills/`.

## Qué es

`orchestra-man` es un plugin de Claude Code. Varias sesiones de Claude Code, una por repositorio (codespace o clon local), comparten memoria y coordinan tareas a través de un Worker de Cloudflare personal con D1, o de un archivo SQLite local. LangGraph ordena el flujo de cada tarea; Claude Code hace todo el razonamiento. Índice de documentación: `docs/README.md`.

## Comandos

| Objetivo | Comando |
| --- | --- |
| Instalar | `npm ci` |
| Typecheck | `npm run typecheck` |
| Todos los tests | `npm test` |
| Solo unitarios | `npm run test:unit` |
| Solo end-to-end | `npm run test:e2e` |
| Actualizar snapshots (¡revisá el diff!) | `npm run test:update` |
| Generar el bundle (`plugin/dist`) | `npm run build` |
| Todo lo que corre CI | `npm run check` |

`plugin/dist/` está versionado: los usuarios instalan el plugin sin build. **Si cambiás `src/`, corré `npm run build` y commiteá `plugin/dist/`.** CI falla si el bundle quedó desactualizado.

## Mapa

| Ruta | Responsabilidad |
| --- | --- |
| `src/core/contract.ts` | El contrato de la API (zod). Fuente única de verdad de cada payload |
| `src/core/routes.ts` | Rutas HTTP. Las usan el router del Worker y el cliente `httpRemote` |
| `src/core/db.ts` | `SqlDatabase`: interfaz mínima con forma de D1 de la que depende todo el código de datos |
| `src/core/repositories/` | Un archivo por tabla. Funciones SQL atómicas, sin HTTP ni reglas de negocio |
| `src/core/service.ts` | `OrchestraService`: reglas de negocio (validación, leases, versiones, lotes) |
| `src/core/remote.ts` | `Remote`: el puerto que usa el plugin. Lo implementan el servicio local y `httpRemote` |
| `src/masking/` | Reglas de enmascarado y el decorador `maskedRemote` |
| `src/worker/` | Worker: router, auth, wake de codespaces, mantenimiento por cron |
| `src/orchestration/` | Grafo de LangGraph. Nodos puros más herramientas inyectadas |
| `src/memory/` | Memoria local de cada repo (reemplazo de Engram): store, texto, contexto y esquema `mem_*` |
| `src/plugin/` | Runtime del plugin: config, identidad, sync incremental, casos de uso, MCP y CLI |
| `migrations/` | Esquema. Lo usan wrangler **y** el modo local |
| `plugin/` | El plugin instalable (manifest, hooks, monitor, skills y `dist/`) |
| `docs/api/openapi.yaml` | Contrato legible. `test/e2e/contract.test.ts` lo mantiene sincronizado con las rutas |

## Reglas

- **Contrato primero.** Cambiá `src/core/contract.ts`, `src/core/routes.ts` y `docs/api/openapi.yaml` antes del handler. El test de contrato falla si divergen.
- **Una sola implementación de cada regla.** La lógica de datos vive en `src/core`; el Worker y el modo local solo la adaptan. Nunca copies SQL en `src/worker` ni en `src/plugin`.
- **Funciones atómicas, inyectadas y testeables.** Las dependencias (`db`, `clock`, `ids`, `fetch`, `exec`) entran por parámetro. Nada de singletons ni `Date.now()` fuera de `src/core/clock.ts`.
- **La memoria local nunca sale sin pasar por la sync.** `src/memory` no conoce la red; solo `src/plugin/sync.ts` publica, y nunca memorias `personal`.
- **Enmascarar en el borde.** Todo lo que sale de la máquina pasa por `maskedRemote`. El código del plugin nunca usa un `Remote` sin enmascarar; `createRuntime` es el único lugar que arma uno.
- **Respetar los límites de D1** (`docs/reference/d1-limits.md`): como máximo 100 parámetros por sentencia, un `batch()` por petición y 50 consultas por invocación en el plan Free.
- **Los snapshots son aserciones.** Si un snapshot cambia, explicá por qué en el commit.
- **Nunca editar otro repositorio sin autorización.** `orchestra_task_approve` es la puerta humana; tiene que seguir siendo una herramienta aparte para que Claude Code pida permiso.
- **Hooks y monitor nunca rompen la sesión.** Fallan con una línea explicativa y código 0.

## Recetas

- Agregar un endpoint, una herramienta MCP o una regla de enmascarado: `docs/guides/development.md`.

## Para leer después

- `docs/architecture/overview.md`: componentes y flujo de datos
- `docs/architecture/orchestration.md`: el grafo de tareas
- `docs/reference/`: API, configuración, herramientas MCP, CLI, modelo de datos
- `docs/adr/`: por qué las cosas son como son
