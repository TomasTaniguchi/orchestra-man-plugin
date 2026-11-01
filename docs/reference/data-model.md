# Modelo de datos

Esquema: `migrations/0001_init.sql`. Es SQLite portable: corre igual en D1 y en `node:sqlite`.

| Tabla | Clave | Contenido |
| --- | --- | --- |
| `tokens` | `id` | Tokens de máquina: `name`, `token_hash` (SHA-256, único), `created_at`, `revoked_at` |
| `agents` | `id` (`repo#machine`) | `repo`, `machine`, `kind` (`codespace`/`local`), `codespace_name`, `created_at`, `last_seen_at` |
| `memories` | `id` entero; único `(repo, source_id)` | Memorias replicadas de Engram, enmascaradas: `type`, `title`, `content`, `topic_key`, fechas |
| `memories_fts` | `rowid` = `memories.id` | Índice FTS5 (external content) sobre `title` y `content`, mantenido por triggers |
| `checkpoints` | `id` | `agent_id`, `repo`, `branch`, `commit_sha`, `summary`, `created_at` |
| `tasks` | `id` | `title`, `repos` (JSON), `orchestrator`, `status`, `state` (JSON del grafo), `version`, `lease_owner`, `lease_expires_at`, fechas |
| `messages` | `id` | `task_id`, `from_agent`, `from_repo`, `to_repo`, `kind`, `body`, `created_at`, `acked_at`, `acked_by` |

Índices: `agents(repo, last_seen_at)`, `checkpoints(repo, created_at)`, `messages(to_repo, acked_at, created_at)`.

## Concurrencia

D1 procesa una consulta a la vez por base, así que cada `UPDATE` condicional es atómico. Todas las reglas de concurrencia se expresan en una sola sentencia:

| Operación | Garantía | Sentencia |
| --- | --- | --- |
| Tomar lease | Solo si está libre, es tuyo o venció, y la tarea está abierta | `tryAcquireLease` en `repositories/tasks.ts` |
| Guardar tarea | Solo el dueño del lease vigente y con la versión esperada; incrementa la versión | `tryUpdateTask` |
| Cerrar tarea | Al pasar a `done`/`cancelled` se libera el lease | `tryUpdateTask` |
| Upsert de memoria | No reemplaza una copia más nueva | `upsertMemoryStatement` |
| Ack de mensaje | Una sola vez y solo el repo destinatario | `tryAck` |

Si la condición no se cumple, la sentencia afecta 0 filas y el servicio lo convierte en `conflict` o `not_found` con un mensaje que explica la causa.

## Fechas

Todas las fechas que genera el backend son ISO 8601 en UTC (`toISOString()`), así que comparar strings equivale a comparar fechas. Las de las memorias vienen de Engram tal cual.
