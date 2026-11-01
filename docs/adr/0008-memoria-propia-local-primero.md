# 0008. Memoria propia, local primero

**Estado**: aceptada (2026-10-31). Reemplaza a [0003](0003-extender-engram-sin-fork.md).

## Contexto

La versión 0.1 leía la memoria de Engram por su API HTTP local. En la práctica eso exigía instalar el binario de Engram y su plugin en cada clon y en cada codespace, y dependía de la forma de su API. Además, la replicación no era incremental.

## Decisión

orchestra-man trae su propia memoria, reproduciendo el comportamiento de Engram que usamos:

- guardado con tipo, alcance y `topic_key`, upsert por tema con historial de versiones, dedupe de 15 minutos, `<private>` y borrado soft o hard;
- búsqueda FTS5, contexto de sesión, pins, timeline y sugerencia de `topic_key`;
- sesiones con resumen, recuperación tras compactación y captura pasiva de "Key Learnings";
- el protocolo de memoria como skill.

La memoria vive en el mismo SQLite local del plugin, con tablas `mem_*` separadas de las del backend compartido. La sincronización es incremental por una secuencia de cambios monótona y propaga bajas sin contenido.

## Qué no se reprodujo

- Captura de cada prompt del usuario: es intrusiva y no hace falta para compartir conocimiento entre repos.
- Juez de conflictos (`mem_judge`, `mem_compare`), alias y fusión de proyectos.
- TUI, exportación a Obsidian, nube propia y `doctor`.
- Alcance `global`: el valor compartido entre repos lo da el backend.

## Consecuencias

- Instalar el plugin alcanza; no hay dependencias externas.
- La memoria propia funciona aunque el backend compartido no esté disponible.
- Quien ya tenga memorias en Engram no las ve en orchestra-man. Si hace falta, se puede agregar un importador puntual.
- `shortcut`: si hay dos sesiones del mismo repo abiertas a la vez en una máquina, las memorias guardadas por MCP se asocian a la más reciente. Engram lo resuelve inyectando el `session_id` con un hook `PreToolUse`; se puede sumar si hace falta.
