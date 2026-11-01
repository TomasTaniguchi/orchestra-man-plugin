# Configuración

Código: `src/plugin/config.ts`.

## Precedencia

1. Variables de entorno.
2. Archivo `~/.config/orchestra-man/config.json` (o `$XDG_CONFIG_HOME/orchestra-man/config.json`, o la ruta en `ORCHESTRA_CONFIG`).
3. Valores por defecto.

Si no se define `mode`, es `d1` cuando hay `workerUrl` y `token`, y `local` en otro caso.

### Por qué un archivo y no `userConfig` del plugin

Claude Code permite declarar `userConfig` en `plugin.json` y guarda los valores sensibles en el llavero del sistema. Pero esos valores **no llegan a los monitores**, y el monitor `watch` necesita el token para leer la bandeja. Por eso todos los procesos del plugin (servidor MCP, hooks y monitor) leen la misma fuente: variables de entorno o un archivo con permisos 0600. Ver [ADR 0005](../adr/0005-configuracion-archivo-y-entorno.md).

## Claves

| Clave | Variable de entorno | Por defecto | Descripción |
| --- | --- | --- | --- |
| `mode` | `ORCHESTRA_MODE` | `d1` si hay URL y token, si no `local` | Backend: tu Worker (`d1`) o SQLite local (`local`) |
| `workerUrl` | `ORCHESTRA_URL` | — | URL del Worker. Obligatoria en modo `d1` |
| `token` | `ORCHESTRA_TOKEN` | — | Token de esta máquina. Obligatorio en modo `d1`. Cargalo con `configure --token-stdin` |
| `localDbPath` | `ORCHESTRA_LOCAL_DB` | `~/.local/share/orchestra-man/orchestra.db` | Archivo SQLite local: la memoria del repo (siempre) y, en modo `local`, también el backend compartido |
| `maskSalt` | `ORCHESTRA_MASK_SALT` | se genera al crear el archivo | Secreto del enmascarado (mínimo 16 caracteres). **Igual en todas tus máquinas** |
| `maskPatterns` | `ORCHESTRA_MASK_PATTERNS` (array JSON) | `[]` | Regex extra a enmascarar como `<custom:…>` |
| `checkpointIntervalSec` | `ORCHESTRA_CHECKPOINT_INTERVAL` | `300` (mínimo 60) | Cada cuánto el monitor sincroniza la memoria y checkpointea |
| `inboxPollSec` | `ORCHESTRA_INBOX_POLL` | `30` (mínimo 10) | Cada cuánto el monitor consulta la bandeja |
| `agentStaleMinutes` | `ORCHESTRA_AGENT_STALE_MINUTES` | `15` | Sin heartbeat por más de esto, un agente se muestra offline |

## Identidad del agente

No se configura: se detecta.

- **repo**: `owner/name` de `git remote get-url origin`, o `local/<directorio>` si no hay remoto.
- **machine**: `CODESPACE_NAME` en un codespace (cuando `CODESPACES=true`), si no el hostname.
- **id**: `<repo>#<machine>`, por ejemplo `acme/api#laptop` o `acme/billing#cs-billing`.

## Codespaces

Usá secretos de GitHub Codespaces (`ORCHESTRA_URL`, `ORCHESTRA_TOKEN`, `ORCHESTRA_MASK_SALT`). No hace falta archivo.

## Variables del Worker

En `worker/wrangler.jsonc` (`vars`) y como secretos de wrangler:

| Nombre | Tipo | Descripción |
| --- | --- | --- |
| `ADMIN_TOKEN` | secreto | Emite y revoca tokens de máquina |
| `GITHUB_TOKEN` | secreto, opcional | PAT clásico con scope `codespace`. Habilita `orchestra_wake` |
| `RETENTION_ACKED_MESSAGE_DAYS` | var | Días que se guardan los mensajes leídos (7) |
| `RETENTION_UNREAD_MESSAGE_DAYS` | var | Días que se guardan los no leídos (30) |
| `RETENTION_CHECKPOINT_DAYS` | var | Días de checkpoints. El último de cada repo nunca se borra (30) |
