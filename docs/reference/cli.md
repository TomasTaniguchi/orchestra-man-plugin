# CLI

El plugin trae una CLI empaquetada en `plugin/dist/cli.mjs` (código en `src/plugin/cli.ts`). La usan los hooks y el monitor; también la podés correr a mano.

```bash
node <ruta-del-plugin>/dist/cli.mjs <comando>
```

En una skill, la ruta es `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`.

| Comando | Lo usa | Qué hace |
| --- | --- | --- |
| `session-start` | hook `SessionStart` (`startup`, `resume`, `clear`) | Abre la sesión, sincroniza, guarda un checkpoint e imprime la memoria del repo y el contexto entre repos (stdout se agrega al contexto de Claude) |
| `post-compact` | hook `SessionStart` (`compact`) | Imprime los pasos de recuperación (guardar el resumen compactado) y la memoria completa |
| `session-end` | hook `SessionEnd` | Cierra la sesión, última sincronización y checkpoint, sin salida |
| `subagent-stop` | hook `SubagentStop` | Guarda los ítems "Key Learnings" de la última respuesta del subagente (captura pasiva) |
| `watch` | monitor `orchestra-watch` | Bucle: cada `inboxPollSec` imprime una línea por mensaje nuevo; cada `checkpointIntervalSec` sincroniza |
| `sync` | a mano | Sincroniza y checkpointea ahora; imprime el resultado en JSON |
| `status` | a mano | Agente, destino de sincronización y configuración efectiva (secretos acortados) |
| `configure` | skill `configure` | Edita el archivo de configuración |
| `help` | — | Uso |

## `configure`

```bash
cli.mjs configure                                  # crea el archivo con un salt nuevo si no existe
cli.mjs configure --set mode=d1 --set workerUrl=https://orchestra-man.x.workers.dev
cli.mjs configure --set 'maskPatterns=["CUST-\\d{6}"]'
cli.mjs configure --token-stdin                    # lee el token de stdin
cli.mjs configure --show                           # muestra el archivo (secretos acortados)
```

- `--set token=...` está prohibido a propósito: el token quedaría en el historial del shell o de la conversación. Usá `--token-stdin`.
- El archivo se escribe con permisos `0600` y su directorio con `0700`.
- Claves válidas: ver [configuration.md](configuration.md).

## Comportamiento de hooks y monitor

Los hooks reciben por stdin el JSON del evento de Claude Code y usan `session_id`, `cwd` y, en `SubagentStop`, `last_assistant_message`.

`session-start`, `post-compact`, `session-end`, `subagent-stop` y `watch` **nunca fallan la sesión**. Ante un error imprimen una línea `orchestra-man: <motivo>` y terminan con código 0. El monitor reporta cada error distinto una sola vez, para que un backend caído se vea sin llenar la conversación de avisos.

Al arrancar, el monitor marca como vistos los mensajes que ya estaban en la bandeja, porque `session-start` ya los mostró.
