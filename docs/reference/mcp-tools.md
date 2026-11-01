# Herramientas MCP

El servidor MCP del plugin se llama `orchestra` y expone 23 herramientas: 11 de memoria de este repo, 4 de consulta compartida, 4 de mensajes y 4 de tareas. Definición: `TOOLS` en `src/plugin/mcp.ts`. Cada error vuelve como resultado MCP con `isError: true` y un mensaje que empieza con `orchestra-man:`; el servidor nunca se cae por un error de una herramienta.

## Memoria de este repo

Local, al instante y sin enmascarar. Lo `project` se publica en la siguiente sincronización; lo `personal` nunca sale de la máquina. Protocolo de uso: skill `memory`.

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `orchestra_save` | `title`, `type`, `content`, `scope?` (`project`/`personal`), `topicKey?` | `{ id, outcome, topicKey, revision, scope }`. `outcome`: `created`, `updated-topic` (mismo `topicKey`: versión anterior al historial) o `deduplicated` (igual en menos de 15 min) |
| `orchestra_update` | `id` y los campos a cambiar | La memoria actualizada; la anterior queda como versión |
| `orchestra_delete` | `id`, `hard?` | Soft por defecto. `hard` borra contenido e historial. Ambos se retiran del backend |
| `orchestra_get` | `id`, `history?` | La memoria completa y, con `history`, sus versiones |
| `orchestra_search` | `query`, `type?`, `scope?`, `limit?` | Coincidencias en la memoria local de este repo, con `snippet` |
| `orchestra_context` | `compact?`, `maxBytes?` | Sesiones recientes, fijadas y recientes (16 KB por defecto) |
| `orchestra_timeline` | `id`, `before?`, `after?` | Memorias guardadas antes y después en la misma sesión |
| `orchestra_pin` | `id`, `pinned?` | Fija (o desfija con `pinned=false`) para que aparezca siempre en el contexto |
| `orchestra_suggest_topic_key` | `type`, `title`, `content?` | `{ topicKey }`, por ejemplo `architecture/invoice-api` |
| `orchestra_session_summary` | `content` | Guarda el resumen de la sesión (uno por sesión, se actualiza si se repite) |
| `orchestra_capture_passive` | `content` | `{ extracted, saved, duplicates }` de los ítems de una sección `## Key Learnings` / `## Aprendizajes` |

`<private>…</private>` se reemplaza por `[REDACTED]` antes de guardar. Los ids son locales a cada máquina y las operaciones por id solo alcanzan memorias de este repo.

## Consulta compartida

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `orchestra_status` | — | El diagnóstico en texto: configuración, backend y versión, este agente, memoria del repo (y cambios sin publicar), otros repos online/offline, bandeja y qué resolver. Es lo que muestra `/orchestra-man:help` y lo mismo que `cli.mjs doctor` |
| `orchestra_recall` | `query`, `repo?`, `limit?` (1–50) | Memorias que coinciden, con `snippet` (coincidencias entre `[ ]`). Funciona aunque el codespace del repo esté apagado |
| `orchestra_checkpoints` | `repo?` | Último checkpoint por repo: rama, commit, archivos sin commitear, memorias recientes |
| `orchestra_sync` | — | Publica ahora los cambios de memoria de este repo (enmascarados, solo `project`) y guarda un checkpoint |

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

Permití sin preguntar las de solo lectura (`orchestra_status`, `orchestra_recall`, `orchestra_checkpoints`, `orchestra_inbox`, `orchestra_task_get`, `orchestra_search`, `orchestra_get`, `orchestra_context`, `orchestra_timeline`, `orchestra_suggest_topic_key`) y, si querés que Claude guarde memoria sin preguntar, `orchestra_save` y `orchestra_session_summary`. **No** permitas `orchestra_task_approve` de forma automática.
