---
name: orchestra
description: Protocolo multi-agente de orchestra-man. Usalo cuando una tarea toca más de un repositorio o microservicio, cuando necesitás saber cómo funciona otro servicio (métodos, endpoints, contratos), o cuando llega un mensaje de otro repo (investigate-request, edit-request) a la bandeja.
---

# orchestra-man: protocolo multi-agente

Cada repositorio tiene su propio Claude Code con este plugin. Compartís memoria enmascarada, checkpoints y una bandeja de mensajes a través del backend del usuario (su Worker con D1, o un SQLite local). Vos razonás; el grafo de LangGraph solo ordena los pasos y guarda el estado.

## Antes de preguntar o despertar a otro repo

1. `orchestra_recall` con palabras del problema (funciona aunque el codespace del otro repo esté apagado).
2. `orchestra_checkpoints` para ver en qué rama y commit quedó cada repo.
3. Si alcanza con memoria, no molestes a nadie. Decí siempre la fecha del checkpoint en el que te basás: es contexto que puede estar viejo.

Solo si hace falta **ejecutar o editar** en otro repo y está offline, ofrecé `orchestra_wake` y avisá al usuario que enciende un codespace (tiene costo).

## Cuando sos el orquestador (la consulta empezó acá)

1. `orchestra_task_start` con el objetivo y los repos involucrados. Seguí la `instruction` que devuelve cada paso.
2. **investigate**: leé el contexto, revisá tu código, juntá las respuestas `investigate-result` con `orchestra_inbox`. Reportá con `orchestra_task_advance` kind=findings.
3. **plan**: plan concreto por repo (archivos, cambios, riesgos, cómo verificar). kind=plan.
4. **approve**: mostrale el plan al usuario y esperá su decisión explícita. Recién entonces `orchestra_task_approve` con `approve`, `revise` o `plan-only`. **Nunca decidas por el usuario y nunca edites antes de este paso.**
5. **edit**: cambios en una rama nueva, nunca en la principal. Los otros repos reciben `edit-request`. kind=edits con repo, rama y resumen.
6. **verify**: tests, lint y build en cada repo tocado. kind=verification. Si falla, el grafo vuelve a edit; tras varios fallos vuelve a plan y hay que pedir autorización otra vez.
7. **propose**: un pull request por repo, sin merge. kind=pull-requests.

Si `orchestra_task_advance` devuelve `conflict` porque otro agente tiene el lease, no insistas: leé la tarea con `orchestra_task_get` y avisá al usuario quién la está orquestando.

## Cuando te llega un mensaje

El monitor del plugin te avisa con una línea `[orchestra-man] Mensaje ...`. Entonces:

- Leelo completo con `orchestra_inbox`.
- `investigate-request`: investigá solo en tu repo y respondé con `orchestra_send` kind=investigate-result, mismo `taskId`, al `fromRepo`.
- `edit-request`: el usuario ya autorizó en el repo orquestador, pero **confirmá con el usuario de esta sesión** antes de editar acá. Rama nueva, tests, y respondé kind=edit-result con rama y resultado.
- Al terminar, `orchestra_ack` con el id del mensaje.

## Datos sensibles

Todo lo que sale de esta máquina se enmascara (emails, teléfonos, tokens, claves, UUIDs, ids numéricos). Verás placeholders como `<email:1a2b3c4d>`: el mismo valor siempre da el mismo placeholder, así que podés correlacionarlos, pero no intentes reconstruir el valor. No pegues secretos en mensajes ni planes aunque el enmascarado los cubra.
