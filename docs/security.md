# Seguridad

## Qué sale de tu máquina

| Sale (enmascarado) | No sale |
| --- | --- |
| Memorias de Engram del repo | Código fuente |
| Checkpoints: rama, commit, nombres de archivos sin commitear, títulos de memorias | Contenido de archivos |
| Mensajes entre agentes | Credenciales de git o de GitHub |
| Estado de tareas: plan, hallazgos, ramas, URLs de PR | El salt de enmascarado |

Git sigue siendo la fuente de verdad: los cambios viajan por ramas y pull requests, no por el backend.

## Amenazas y mitigaciones

| Amenaza | Mitigación |
| --- | --- |
| Datos personales o secretos en la memoria compartida | Enmascarado en el cliente antes de enviar ([masking.md](reference/masking.md)). Placeholders con HMAC y salt local. El test e2e verifica que ningún valor sensible del escenario llegue a ninguna tabla |
| Token de máquina robado | Un token por máquina, revocable sin afectar a las demás. El Worker guarda solo su SHA-256. Se carga por stdin o como secreto de Codespaces, nunca por el chat ni en `plugin.json` |
| `ADMIN_TOKEN` robado | Solo emite y revoca tokens. Se compara en tiempo constante. Rotalo con `wrangler secret put ADMIN_TOKEN` |
| Un agente edita otro repo sin permiso | El grafo exige la decisión `approve` antes de la fase `edit`. `orchestra_task_approve` es una herramienta aparte, así que Claude Code te pide permiso. El repo que recibe un `edit-request` pide confirmación también en su sesión. Los cambios van a ramas nuevas y PRs, nunca a la rama principal |
| Dos orquestadores sobre la misma tarea | Lease con expiración y versión optimista en una sola sentencia SQL atómica |
| Instrucciones maliciosas dentro de mensajes o memorias | Los mensajes los escriben otros agentes de tus propios repos y se tratan como datos. La skill indica no editar sin confirmación local. Si conectás repos de terceros, revisá sus pedidos |
| Archivo de configuración legible por otros usuarios | Se escribe con `0600` y su directorio con `0700` |
| Payloads enormes o inválidos | Validación zod de cada entrada en el servicio, límites de tamaño por campo y 4 MB por petición |
| Encendido no deseado de codespaces | `orchestra_wake` requiere un `GITHUB_TOKEN` que vos cargás en tu Worker, y solo enciende codespaces registrados por tus agentes |

## Riesgos que quedan

- El enmascarado por reglas no detecta todo (nombres, direcciones, texto libre).
- Los nombres de archivos sin commitear y los nombres de ramas se envían tal cual.
- Si compartís un Worker con colegas, todos los que tienen token leen toda la memoria. No hay permisos por repo en v0.1.
- Antes de usarlo con código de la empresa, confirmá con el equipo de seguridad que subir este contenido enmascarado a Cloudflare está permitido.

## Reportar un problema

Abrí un issue privado (Security Advisory) en el repositorio de GitHub.
