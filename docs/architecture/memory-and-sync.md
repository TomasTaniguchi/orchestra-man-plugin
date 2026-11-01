# Memoria y sincronización

## Engram es la memoria; orchestra-man la comparte

Cada repo sigue usando [Engram](https://github.com/Gentleman-Programming/engram) como siempre: el agente guarda observaciones curadas (`mem_save`) en un SQLite local. orchestra-man **no cambia Engram ni lo forkea**: lee su API HTTP local (`GET /observations/recent?project=<repo>`) y replica esas observaciones al backend compartido con su propio contrato. Ver [ADR 0003](../adr/0003-extender-engram-sin-fork.md).

| Engram (`observations`) | orchestra-man (`memories`) |
| --- | --- |
| `sync_id` | `source_id` (clave de idempotencia junto con `repo`) |
| `type`, `title`, `content`, `topic_key` | igual, con título y contenido **enmascarados** y truncados a los límites del contrato |
| `created_at`, `updated_at` | igual |
| `deleted_at` no nulo | no se replica |

El proyecto de Engram se deduce del nombre del repo (`acme/api` → `api`). Si tu proyecto en Engram se llama distinto, configurá `engramProject`.

## Cuándo se sincroniza

| Disparador | Dónde |
| --- | --- |
| Al abrir Claude Code | hook `SessionStart` → `session-start` |
| Cada `checkpointIntervalSec` (300 s por defecto) | monitor → `watch` |
| Al cerrar Claude Code | hook `SessionEnd` → `session-end` |
| A pedido | herramienta `orchestra_sync` o `cli sync` |

El checkpoint se genera **en la máquina donde corre el código** (codespace o clon local), nunca desde el Worker: un Worker no puede leer un codespace apagado. El cron del Worker solo hace mantenimiento.

## Lotes e idempotencia

- Se leen las últimas 200 observaciones y se mandan en lotes de 50 (`PUT /v1/memories`).
- Cada lote es **un** `batch()` de D1: transaccional y una sola consulta frente al límite por invocación. Cada sentencia usa 10 parámetros, lejos del máximo de 100.
- El upsert no reemplaza una copia más nueva con una más vieja (`WHERE excluded.updated_at >= memories.updated_at`). Reenviar es seguro.
- `shortcut`: se relee siempre la ventana completa. Si un repo genera más de 200 observaciones entre sincronizaciones, conviene agregar una marca de agua.

## Checkpoints

Un checkpoint es una foto de dónde quedó un repo: rama, commit, archivos sin commitear (hasta 50) y los títulos de las memorias recientes. Sirve para que otro agente sepa **qué tan vieja** es la información de un repo apagado. El contexto de sesión muestra el último checkpoint de cada repo y si su agente está online (visto en los últimos `agentStaleMinutes`).

## Búsqueda

`orchestra_recall` usa FTS5 sobre título y contenido. Cada palabra de la consulta se convierte en un término con prefijo entre comillas, unido con OR, y bm25 ordena los mejores primero. El entrecomillado evita que una consulta del usuario rompa la sintaxis de FTS. Los fragmentos devueltos marcan las coincidencias con `[ ]`.
