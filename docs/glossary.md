# Glosario

| Término | Significado |
| --- | --- |
| **Agente** | Una sesión de Claude Code con el plugin, en un repo y una máquina. Id `repo#machine` |
| **Orquestador** | El agente que tiene el lease de una tarea. Al principio, el que la creó; puede rotar |
| **Lease** | Permiso exclusivo y temporal (10 minutos, renovable) para ejecutar pasos de una tarea |
| **Backend** | Dónde se guarda lo compartido: tu Worker con D1 (modo `d1`) o un SQLite local (modo `local`) |
| **Memoria** | Una observación de Engram replicada y enmascarada en el backend |
| **Checkpoint** | Foto de un repo: rama, commit, archivos sin commitear y memorias recientes |
| **Bandeja** | Mensajes dirigidos a un repo, no a una máquina: cualquier agente de ese repo puede atenderlos |
| **Fase** | Etapa del grafo: investigate, plan, approve, edit, verify, propose, done, cancelled |
| **Instrucción** | Texto que el grafo devuelve en cada paso para indicarle a Claude qué hacer |
| **Placeholder** | Reemplazo de un dato sensible, como `<email:bab800ec>` |
| **Salt** | Secreto local que hace que los placeholders no se puedan revertir. Igual en todas tus máquinas |
| **Monitor** | Proceso del plugin que corre durante la sesión: avisa mensajes nuevos y sincroniza periódicamente |
| **Wake** | Encender un codespace apagado por la API de GitHub |
| **Puerto `Remote`** | Interfaz que usa el plugin para hablar con el backend, sea cual sea |
| **`SqlDatabase`** | Interfaz con forma de D1 que permite correr el mismo SQL en D1 y en `node:sqlite` |
