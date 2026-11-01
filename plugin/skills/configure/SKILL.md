---
name: configure
description: Configura orchestra-man en esta máquina (modo D1 con tu Worker o SQLite local, URL, token, salt de enmascarado, intervalos). Usalo cuando el usuario pida configurar orchestra-man o cuando una herramienta diga que no está configurado.
disable-model-invocation: true
argument-hint: "[d1|local]"
---

# Configurar orchestra-man

La configuración vive en `~/.config/orchestra-man/config.json` (permisos 0600) y las variables de entorno la pisan. La CLI es:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" configure --show
```

Seguí estos pasos con el usuario. Argumento recibido: `$ARGUMENTS`.

## 1. Elegir modo

- **d1**: memoria y coordinación compartidas entre máquinas a través del Worker del usuario. Requiere haber desplegado el Worker (guía `docs/guides/deploy-worker.md` del repo del plugin).
- **local**: SQLite en esta máquina. Sirve para varios Claude locales en la misma máquina, o para probar sin nube.

## 2. Valores no secretos

Ejecutalos vos con Bash, por ejemplo:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" configure --set mode=d1 --set workerUrl=https://orchestra-man.<subdominio>.workers.dev
```

Otras claves: `engramUrl`, `engramProject`, `checkpointIntervalSec` (mínimo 60), `inboxPollSec`, `agentStaleMinutes`, `localDbPath`, `maskPatterns` (array JSON de regex extra, por ejemplo `'["CUST-\\d{6}"]'`).

## 3. El token: nunca por el chat

**No le pidas el token al usuario en la conversación ni lo pongas en un comando tuyo**: quedaría en el historial. Pedile que lo ejecute en su propia terminal y pegue el token, terminando con Ctrl-D:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" configure --token-stdin
```

En un **codespace**, lo recomendado es no usar archivo: crear los secretos de GitHub Codespaces `ORCHESTRA_URL`, `ORCHESTRA_TOKEN` y `ORCHESTRA_MASK_SALT` para los repos que correspondan, y reiniciar el codespace.

## 4. Mismo salt en todas las máquinas

El salt de enmascarado (`maskSalt`) se genera solo la primera vez. Para que un mismo email produzca el mismo placeholder en todos los repos, **todas las máquinas deben usar el mismo salt**. Indicale al usuario que copie el valor de `maskSalt` de su archivo a las demás máquinas (o al secreto `ORCHESTRA_MASK_SALT`). No lo imprimas completo vos.

## 5. Verificar

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" status
```

Después llamá a la herramienta `orchestra_status`. Si responde con el `backend` en `ok`, está listo. Recordale al usuario que reinicie la sesión de Claude Code para que el hook de inicio y el monitor tomen la configuración.
