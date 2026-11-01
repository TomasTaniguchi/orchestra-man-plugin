# Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| Al abrir la sesión: `orchestra-man is not configured correctly (maskSalt …)` | No hay archivo de configuración ni variables | `/orchestra-man:configure` |
| `mode is d1 but workerUrl or token is missing` | Modo D1 sin URL o token | `configure --set workerUrl=…` y `configure --token-stdin` |
| `invalid or revoked token` (`unauthorized`) | Token mal copiado o revocado | Emití uno nuevo ([deploy-worker.md](guides/deploy-worker.md#7-emitir-un-token-por-máquina)) |
| `cannot reach https://…` (`unavailable`) | Worker caído, URL incorrecta o sin red | `curl <url>/v1/health` |
| Otro repo no encuentra una memoria recién guardada | Todavía no se sincronizó | Se publica en la próxima sincronización (hasta `checkpointIntervalSec`), o al instante con `orchestra_sync` |
| Una memoria no aparece en `orchestra_recall` | Es `personal`, está borrada, o se busca desde el mismo repo antes de sincronizar | `orchestra_search` busca la memoria local de este repo, incluidas las personales |
| `memory #N not found in owner/repo` | El id es de otro repo o la memoria se borró | Los ids son locales a cada máquina; buscá de nuevo |
| `Backend compartido no disponible` al iniciar | Worker caído o sin red | La memoria local sigue funcionando; se sincroniza cuando vuelva |
| El otro repo aparece `offline` aunque está abierto | Su monitor no corre o no tiene configuración | En esa sesión, `/orchestra-man:configure` y reiniciar. `agentStaleMinutes` define el umbral |
| No llegan los avisos de mensajes nuevos | El monitor no arrancó (los monitores no corren en modo `-p`) | Reiniciá la sesión interactiva; mirá `/tasks` |
| `task … is leased by … until …` (`conflict`) | Otro agente está orquestando la tarea | Esperá a que venza el lease (10 min) o seguí desde esa máquina |
| `task … is at version N, not M` | Otro agente avanzó la tarea entre tu lectura y tu escritura | `orchestra_task_get` y repetí el paso |
| `phase "plan" expects plan, got "edits"` | Se reportó algo que no corresponde a la fase | Seguí la `instruction` de la tarea |
| `wake is not configured on this backend` | Modo local, o Worker sin `GITHUB_TOKEN` | Cargá el secreto en el Worker |
| `GitHub refused to start …: HTTP 402` | Sin cuota o sin pago de Codespaces | Revisá la facturación de Codespaces |
| Placeholders distintos para el mismo email en repos distintos | Salts distintos entre máquinas | Usá el mismo `maskSalt` en todas |
| `wrangler d1 export` falla | D1 no exporta bases con tablas virtuales (FTS5) | Ver "Backups" en [deploy-worker.md](guides/deploy-worker.md#backups) |
| `ExperimentalWarning: SQLite is an experimental feature` | Aviso de Node sobre `node:sqlite` | Inofensivo; va a stderr |

## Diagnóstico

```bash
node <ruta-del-plugin>/dist/cli.mjs status   # configuración efectiva e identidad
node <ruta-del-plugin>/dist/cli.mjs sync     # fuerza una sincronización y muestra el resultado
```

En Claude Code: `orchestra_status` muestra el backend y qué agentes ve.
