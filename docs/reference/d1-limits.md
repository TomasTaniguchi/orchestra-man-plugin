# Límites de D1 y cómo se respetan

Verificados el 2026-10-31 en <https://developers.cloudflare.com/d1/platform/limits/>. Revisalos si Cloudflare los cambia.

| Límite | Free | Paid |
| --- | --- | --- |
| Tamaño por base | 500 MB | 10 GB |
| Almacenamiento por cuenta | 5 GB | 1 TB |
| Consultas por invocación del Worker | 50 | 1.000 |
| Parámetros enlazados por consulta | 100 | 100 |
| Longitud de una sentencia SQL | 100 KB | 100 KB |
| Tamaño de fila, string o BLOB | 2 MB | 2 MB |
| Duración de una consulta | 30 s | 30 s |
| Tamaño del resultado de una consulta | 50 MB (desde 2026-11-04) | 50 MB |
| Conexiones simultáneas por invocación | 6 | 6 |
| Time Travel | 7 días | 30 días |

Concurrencia: cada base procesa **una consulta a la vez**. El throughput es aproximadamente 1 / duración de la consulta. Las peticiones en exceso se encolan, y si la cola se llena D1 responde "overloaded".

`batch()` cuenta como **una** consulta frente al límite por invocación, se ejecuta como transacción y aplica los límites por sentencia a cada una.

No documentados: máximo de sentencias por `batch()` y escrituras por segundo.

## Cómo los respeta orchestra-man

| Límite | Medida | Dónde |
| --- | --- | --- |
| 50 consultas por invocación | Cada petición hace como máximo ~3 consultas: autenticación, la operación y una lectura posterior. Un lote de memorias es un único `batch()` | `src/core/service.ts` |
| 100 parámetros por consulta | El upsert de memoria usa 10; ninguna sentencia supera 11 | `src/core/repositories/*` |
| Sentencias por batch (no documentado) | Máximo 50 memorias por petición (`LIMITS.memoriesPerBatch`) | `src/core/contract.ts` |
| 2 MB por fila | Contenido de memoria ≤ 64.000 caracteres, cuerpo de mensaje ≤ 32.000, resumen de checkpoint ≤ 32.000. El cliente trunca antes de enviar | `LIMITS`, `src/plugin/sync.ts` |
| 100 KB por sentencia | Los valores van como parámetros enlazados, no dentro del SQL | Repositorios |
| 50 MB por resultado | Búsquedas ≤ 50 resultados con fragmentos, bandeja ≤ 100 mensajes | Repositorios |
| 500 MB por base | Retención diaria de mensajes y checkpoints. Las memorias se actualizan por upsert, no se duplican | Cron del Worker |
| Una consulta a la vez | Consultas cortas e indexadas. Monitor cada 30 s por máquina | `inboxPollSec` |
| Cuerpo de la petición | El Worker rechaza cuerpos de más de 4 MB | `src/worker/index.ts` |

## Estimación de consumo

Con 5 máquinas abiertas 8 horas: el monitor hace unas 960 consultas a la bandeja por máquina y por día, más una sincronización cada 5 minutos (unas 5 peticiones cada una). Eso da menos de 30.000 consultas diarias, muy por debajo de lo que maneja el plan Free. Revisá los precios vigentes de Workers y D1 si escalás a un equipo grande.
