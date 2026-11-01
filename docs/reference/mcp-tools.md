# Herramientas MCP

El servidor MCP del plugin se llama `orchestra`. Definición: `TOOLS` en `src/plugin/mcp.ts`. Cada error vuelve como resultado MCP con `isError: true` y un mensaje que empieza con `orchestra-man:`; el servidor nunca se cae por un error de una herramienta.

## Consulta

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `orchestra_status` | — | Este agente, el modo, la salud del backend y cada agente con `online` |
| `orchestra_recall` | `query`, `repo?`, `limit?` (1–50) | Memorias que coinciden, con `snippet` (coincidencias entre `[ ]`). Funciona aunque el codespace del repo esté apagado |
| `orchestra_checkpoints` | `repo?` | Último checkpoint por repo: rama, commit, archivos sin commitear, memorias recientes |
| `orchestra_sync` | — | Replica la memoria de Engram y guarda un checkpoint ahora |

## Mensajes

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `orchestra_send` | `toRepo`, `kind`, `body`, `taskId?` | El mensaje creado. El `body` se enmascara antes de salir |
| `orchestra_inbox` | `includeAcked?` | Mensajes a este repo, los más viejos primero (máximo 100) |
| `orchestra_ack` | `messageId` | El mensaje marcado como atendido. Solo el repo destinatario puede hacerlo, una sola vez |
| `orchestra_wake` | `repo` | `{ repo, codespaceName, state }`. Enciende el último codespace visto de ese repo. Requiere backend D1 y `GITHUB_TOKEN` en el Worker |

`kind`: `investigate-request`, `investigate-result`, `edit-request`, `edit-result`, `note`.

## Tareas

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `orchestra_task_start` | `goal`, `repos` | Paso inicial: el que llama es el orquestador. Junta contexto y pide investigación a los otros repos |
| `orchestra_task_advance` | `taskId`, `kind` y el campo que corresponda | Ejecuta un paso del grafo. Ver tabla abajo |
| `orchestra_task_approve` | `taskId`, `decision` (`approve`, `revise`, `plan-only`), `note?` | **Decisión del usuario** sobre el plan. Herramienta aparte para que Claude Code pida permiso |
| `orchestra_task_get` | `taskId` | Estado completo: fase, plan, ediciones, bitácora `actions` e `instruction` |

Campos de `orchestra_task_advance` según `kind`:

| `kind` | Campos | Fase |
| --- | --- | --- |
| `findings` | `findings: string[]` | investigate |
| `plan` | `plan: string` | plan |
| `edits` | `edits: { repo, branch, summary }[]` | edit |
| `verification` | `passed: boolean`, `report: string` | verify |
| `pull-requests` | `urls: string[]` | propose |
| `cancel` | `reason: string` | cualquiera |

Todas las herramientas de tareas devuelven `{ taskId, phase, status, instruction, state }`. Errores típicos:

- `conflict`: otro agente tiene el lease vigente, la tarea ya está cerrada, o la versión cambió.
- `bad_request`: el `kind` no corresponde a la fase.

## Permisos recomendados

Permití sin preguntar las de solo lectura (`orchestra_status`, `orchestra_recall`, `orchestra_checkpoints`, `orchestra_inbox`, `orchestra_task_get`). **No** permitas `orchestra_task_approve` de forma automática.
