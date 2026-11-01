# Instalar y configurar el plugin

Instalalo en **cada** codespace y clon local que quieras conectar. Todos deben apuntar al mismo backend y usar el **mismo salt de enmascarado**.

No hace falta nada más: la memoria de cada repo viene incluida en el plugin. Solo se necesita Node.js 22.13 o superior (los codespaces con la imagen universal ya lo traen; si no, agregá la feature `node` en `devcontainer.json`).

## 1. Instalar

En Claude Code:

```
/plugin marketplace add TomasTaniguchi/orchestra-man-plugin
/plugin install orchestra-man@orchestra-man
```

Para todos los que trabajan en un repo, podés instalarlo con alcance de proyecto (queda en `.claude/settings.json` del repo). Cada persona lo instala igual en su máquina.

## 2. Configurar

La configuración vive en `~/.config/orchestra-man/config.json` (permisos 0600) y las variables de entorno tienen prioridad. Detalle de cada clave en [configuration.md](../reference/configuration.md).

### Clon local, modo compartido (D1)

En Claude Code:

```
/orchestra-man:configure d1
```

La skill configura el modo y la URL. El token lo cargás vos en **tu terminal** (no en el chat), así no queda en ningún historial:

```bash
node ~/.claude/plugins/<ruta-que-te-indica-la-skill>/dist/cli.mjs configure --token-stdin
# pegá el token, Enter, Ctrl-D
```

### Codespace

En codespaces no hace falta archivo. Creá secretos de **GitHub Codespaces** (Settings → Codespaces → Secrets) y asignalos a los repos que corresponda:

| Secreto | Valor |
| --- | --- |
| `ORCHESTRA_URL` | URL de tu Worker |
| `ORCHESTRA_TOKEN` | Token emitido para codespaces |
| `ORCHESTRA_MASK_SALT` | El mismo salt que usás en tus otras máquinas |

Los procesos del plugin (servidor MCP, hooks y monitor) leen estas variables. Reiniciá el codespace después de crearlos. GitHub expone `CODESPACES` y `CODESPACE_NAME`, y el plugin los usa para registrarse como agente de codespace (eso habilita `orchestra_wake`).

### Solo esta máquina (modo local)

```
/orchestra-man:configure local
```

Usa un SQLite en `~/.local/share/orchestra-man/orchestra.db`. Sirve para varios clones locales en la misma máquina sin nube.

### El salt de enmascarado

La primera vez se genera un `maskSalt` aleatorio. **Copialo igual a todas tus máquinas** (archivo o secreto `ORCHESTRA_MASK_SALT`): si dos máquinas usan salts distintos, el mismo email produce placeholders distintos y los agentes no pueden correlacionarlos. No lo compartas fuera de tus máquinas.

## 3. Verificar

Reiniciá la sesión de Claude Code y corré:

```
/orchestra-man:help
```

Si la sección "Estado" dice "Todo en orden.", está listo. Si no, cada punto dice qué hacer. Al abrir cada sesión vas a ver además el bloque `# orchestra-man`.

## Permisos

Claude Code te pedirá permiso para las herramientas MCP la primera vez. Recomendación:

- Permití sin preguntar las de lectura (`orchestra_status`, `orchestra_recall`, `orchestra_checkpoints`, `orchestra_inbox`, `orchestra_task_get`).
- **No** agregues `orchestra_task_approve` a la lista de permitidas: ese permiso es tu confirmación de que se puede editar código.
