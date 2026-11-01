# Uso

Ejemplos con tres repos que forman un producto: `acme/api` (órdenes), `acme/billing` (facturas, en un codespace) y `acme/web` (frontend).

## Al abrir Claude Code

El hook de inicio inyecta la memoria de tu repo y un bloque como este en el contexto:

```
## Memoria de sesiones anteriores (acme/api)

### Recientes
- [decision] Elegido D1 sobre KV (#4, decision/storage)
- [bugfix] Corregido N+1 en OrderList (#3)

# orchestra-man
Agente acme/api#laptop (local) · backend d1 · memorias sincronizadas: 3.

## Otros repositorios
- acme/billing: offline · cs-billing (codespace) · último checkpoint 2026-10-31T11:40:00.000Z en main@4f2a9c1
- acme/web: online · laptop (local) · último checkpoint 2026-10-31T12:01:00.000Z en feat/cart@91be0d2

## Bandeja (1 sin leer)
- [investigate-request] de acme/web · tarea task_… · id msg_…: Tarea …: Mostrar el estado de pago en el checkout…
```

## 1. Memoria de tu repo

Claude guarda solo lo que vale la pena (skill `memory`): decisiones, causas raíz, contratos. También podés pedirlo:

> Guardá que el endpoint de facturas devuelve invoiceId y status, y que la decisión fue no exponer el monto.

Usa `orchestra_save` con un `topicKey` como `architecture/invoice-api`. Si mañana cambia, se guarda con la misma clave: se actualiza y la versión anterior queda en el historial. Para algo solo tuyo ("mi alias de git…"), Claude usa `scope=personal` y nunca sale de tu máquina.

> ¿Qué decidimos la semana pasada sobre los reintentos de webhooks?

Claude busca primero en `orchestra_context`, después en `orchestra_search`, y lee completo con `orchestra_get`.

Si la conversación se compacta, Claude recibe la instrucción de guardar el resumen antes de seguir, así no se pierde lo hecho.

## 2. Preguntar por otro servicio

> ¿Qué devuelve billing cuando creo una factura? ¿Reintenta los webhooks?

Claude busca en la memoria compartida con `orchestra_recall` (el codespace de billing puede estar apagado) y cita el checkpoint del que sale la información. Si no alcanza, te ofrece mandar un `investigate-request` o encender el codespace.

## 3. Una tarea entre repos

> Las órdenes tienen que guardar el invoiceId de billing y web tiene que mostrar el link al recibo. Coordinalo.

1. **Investigar.** `orchestra_task_start` junta la memoria y los checkpoints de los tres repos, y manda pedidos de investigación a billing y web.
2. **Respuestas.** Los Claude de billing y web reciben el aviso del monitor, investigan su código y responden. En api, Claude las lee con `orchestra_inbox`.
3. **Plan.** Claude te muestra un plan por repo: archivos, cambios, riesgos y cómo verificar.
4. **Tu decisión.** Respondés "aprobado", "cambiá X" o "solo quiero el plan". Claude llama a `orchestra_task_approve` y Claude Code te pide permiso para esa herramienta.
5. **Editar.** Cada repo trabaja en una rama nueva. Billing y web reciben un `edit-request` y **también piden confirmación en su sesión**.
6. **Verificar.** Tests, lint y build. Si algo falla, se corrige y se vuelve a verificar. Tras 3 fallos, vuelve al plan y te pide autorización otra vez.
7. **Proponer.** Un pull request por repo. Nunca hace merge.

En cualquier momento: "cancelá la tarea" o "¿en qué quedó la tarea task_…?" (`orchestra_task_get` muestra la bitácora completa).

## 4. Cuando te llega un pedido

El monitor escribe una línea como:

```
[orchestra-man] Mensaje investigate-request de acme/api (tarea task_…), id msg_…: Tarea …: Link orders to invoices…
```

Claude lo lee, investiga en tu repo y responde. Para un `edit-request` te pregunta antes de editar, aunque el usuario del otro repo ya lo haya aprobado.

## 5. Un repo apagado que hay que tocar

Si una tarea necesita **ejecutar o editar** en un codespace apagado, Claude te ofrece `orchestra_wake`, que lo enciende con la API de GitHub (necesita `GITHUB_TOKEN` en el Worker). Encender un codespace tiene costo; leer su memoria no.

## 6. Si una máquina se duerme a mitad de tarea

El lease del orquestador dura 10 minutos y se renueva en cada paso. Si tu laptop se suspende, desde otro repo podés decir "seguí la tarea task_…": cuando el lease venció, ese Claude la toma y la bitácora registra el cambio. Al volver, tu laptop recibe un aviso de que otro agente la está orquestando.

## Buenas prácticas

- Guardá memoria activamente (`orchestra_save` después de decisiones, contratos y bugfixes): es lo que los demás van a poder recordar. La skill `memory` le indica a Claude cuándo hacerlo.
- Revisá la fecha del checkpoint antes de confiar en contexto de un repo offline.
- No pegues secretos en planes ni mensajes. El enmascarado cubre los formatos conocidos, no todo.
