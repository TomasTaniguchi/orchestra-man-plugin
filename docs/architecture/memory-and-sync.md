# Memoria y sincronización

## Memoria propia, local primero

Cada máquina guarda la memoria de su repo en el SQLite local del plugin (`localDbPath`). No hace falta instalar nada más. El diseño reproduce el de [Engram](https://github.com/Gentleman-Programming/engram), que es la referencia de la que partimos (ver [ADR 0008](../adr/0008-memoria-propia-local-primero.md)):

| Comportamiento | Cómo funciona | Código |
| --- | --- | --- |
| Guardar | `orchestra_save` con `type`, `title`, `content`, `scope`, `topicKey`. Se adjunta a la sesión abierta | `MemoryStore.save` |
| Upsert por tema | Mismo `topicKey` + proyecto + alcance → se actualiza en el lugar, `revisionCount` +1, y el contenido anterior queda en `mem_observation_versions` | `save`, `update` |
| Dedupe | Mismo contenido normalizado (sin mayúsculas ni espacios extra), título, tipo, proyecto y alcance en menos de 15 minutos → solo `duplicateCount` +1 | `save` |
| `<private>` | Se reemplaza por `[REDACTED]` antes de guardar, también localmente | `stripPrivate` |
| Borrar | Soft por defecto (se oculta). Hard borra título, contenido e historial y deja una lápida para propagar la baja | `delete` |
| Búsqueda | FTS5 con bm25, filtros por tipo y alcance | `search` |
| Contexto | Sesiones recientes, fijadas y recientes, limitado a 16 KB | `formatMemoryContext` |
| Timeline | Memorias guardadas antes y después en la misma sesión | `timeline` |
| Sugerir tema | Familia según tipo o palabras clave + segmento normalizado del título (algoritmo de Engram) | `suggestTopicKey` |
| Sesiones | Abiertas por el hook de inicio con el `session_id` de Claude Code y cerradas al terminar. El resumen va a la sesión y como memoria `session_summary` | `startSession`, `saveSessionSummary` |
| Captura pasiva | Ítems de una sección `## Key Learnings` / `## Aprendizajes` en la salida de un subagente, guardados una sola vez | `capturePassive`, hook `SubagentStop` |
| Recuperación tras compactación | El hook `SessionStart` con matcher `compact` pide guardar el resumen y reinyecta la memoria | `postCompact` |

El protocolo de cuándo y cómo guardar está en la skill `plugin/skills/memory/SKILL.md`.

Toda operación por id está acotada al repo: no se puede leer ni modificar la memoria de otro proyecto con un id.

### Alcances

| Alcance | Dónde vive | Se comparte |
| --- | --- | --- |
| `project` (por defecto) | Local | Sí, enmascarada, en la siguiente sincronización |
| `personal` | Local | **Nunca.** Si una memoria pasa de `project` a `personal`, se retira del backend |

## Sincronización incremental

```
orchestra_save ──► mem_observations (local, sin enmascarar, change_seq = max+1)
                          │
        session-start · monitor cada 5 min · session-end · orchestra_sync
                          ▼
     changesSince(cursor) → toChange → maskedRemote → PUT /v1/memories (lotes de 50)
                          ▼
                 avanzar cursor tras cada lote confirmado
```

- Cada cambio (alta, edición, borrado o cambio de alcance) recibe un `change_seq` monótono dentro de su transacción. El cursor de cada backend guarda el último `change_seq` confirmado. Así **ningún cambio se saltea**, aunque dos tengan el mismo timestamp o el reloj retroceda.
- El cursor avanza solo después de que el backend confirma el lote. Si falla la red, se reintenta en la próxima sincronización: no se pierde nada.
- Las memorias borradas o `personal` viajan como **baja**: solo `sourceId` y `updatedAt`, sin título ni contenido.
- Cada lote es **un** `batch()` de D1. Un upsert nunca reemplaza una copia más nueva, y una baja nunca borra una copia más nueva.
- Una llamada procesa hasta 10 ventanas de 200 cambios. Si queda más, lo indica (`pending`) y sigue en la siguiente.
- Hay un cursor por backend (`syncTarget`), así que cambiar de Worker o pasar de local a D1 vuelve a subir todo una vez.

Lo guardado queda disponible para los otros repos después de la próxima sincronización: hasta `checkpointIntervalSec` (5 minutos por defecto), o al instante con `orchestra_sync`.

## Checkpoints

Un checkpoint es una foto de dónde quedó un repo: rama, commit, archivos sin commitear (hasta 50) y los títulos de las memorias `project` recientes. Se genera **en la máquina donde corre el código**, nunca desde el Worker, porque un Worker no puede leer un codespace apagado. Sirve para que otro agente sepa **qué tan vieja** es la información de un repo apagado.

## Dos búsquedas

| Herramienta | Qué busca | Ventajas |
| --- | --- | --- |
| `orchestra_search` | La memoria **de este repo**, local | Al instante, sin enmascarar, incluye `personal` |
| `orchestra_recall` | La memoria compartida **de todos los repos** | Funciona con codespaces apagados. Datos enmascarados y con la antigüedad de la última sincronización |

Ambas usan FTS5: cada palabra de la consulta se convierte en un término con prefijo entre comillas, unido con OR, y bm25 ordena primero los mejores resultados. Las coincidencias se marcan con `[ ]`.
