# 0005. Configuración por archivo y entorno, no `userConfig`

**Estado**: aceptada (2026-10-31). Reemplaza la idea inicial de guardar las credenciales en `userConfig` del plugin.

## Contexto

`plugin.json` permite declarar `userConfig` y guarda los valores sensibles en el llavero del sistema. Según la referencia del manifest, esos valores llegan a hooks y servidores MCP, pero **no a los monitores**: "Monitor processes don't receive `CLAUDE_PLUGIN_OPTION_<KEY>`". El monitor necesita el token para leer la bandeja y sincronizar.

## Decisión

- Una sola fuente para todos los procesos: variables de entorno por encima de `~/.config/orchestra-man/config.json` (permisos 0600, directorio 0700).
- En codespaces, secretos de GitHub Codespaces (`ORCHESTRA_URL`, `ORCHESTRA_TOKEN`, `ORCHESTRA_MASK_SALT`).
- En máquinas locales, `configure --token-stdin`: el token no pasa por la conversación ni por el historial del shell. `--set token=` se rechaza.

## Consecuencias

- El token local queda en un archivo privado, como lo hacen wrangler o la CLI de AWS, en lugar del llavero.
- El servidor MCP, los hooks y el monitor ven exactamente la misma configuración.
- Si una versión futura de Claude Code entrega `userConfig` a los monitores, se puede reconsiderar.
