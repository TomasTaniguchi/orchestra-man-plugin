---
name: help
description: Ayuda de orchestra-man. Diagnostica cómo está el plugin en esta máquina (configuración, backend, memoria, otros repos, bandeja) y muestra una guía corta con ejemplos de qué pedir.
disable-model-invocation: true
argument-hint: "[memoria | repos | tareas | mensajes | configuracion]"
---

# Ayuda de orchestra-man

Tema pedido: `$ARGUMENTS` (vacío = todo).

## 1. Diagnóstico

Llamá a la herramienta `orchestra_status`. Si no está disponible (por ejemplo, el servidor MCP no arrancó), ejecutá:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" doctor
```

Mostrale al usuario el reporte **tal cual**, dentro de un bloque de código. Si la sección "Estado" tiene problemas (✗ o !), explicá primero qué hacer con cada uno, en una línea, y ofrecé hacerlo vos cuando sea posible. Por ejemplo, para "sin configurar" ofrecé `/orchestra-man:configure`. Nunca muestres ni pidas tokens en el chat.

## 2. Guía rápida

Después del diagnóstico, mostrá la guía de abajo. Si se pidió un tema, solo esa sección y "Comandos". No inventes funciones que no estén acá.

### Memoria de este repo

Claude guarda solo lo que vale la pena recordar: decisiones, causas raíz, contratos y pendientes. Sobrevive entre sesiones y a la compactación del contexto.

| Pedile | Qué hace |
| --- | --- |
| "Guardá que el endpoint de facturas devuelve invoiceId y status" | `orchestra_save`, con un tema estable (`topicKey`) para poder actualizarlo después |
| "Actualizá la decisión sobre los reintentos: ahora son 5" | Mismo tema: actualiza la memoria y la versión anterior queda en el historial |
| "Guardá como personal que uso el puerto 5433 para postgres" | `scope=personal`: nunca sale de esta máquina |
| "¿Qué decidimos sobre los webhooks?" | `orchestra_context`, `orchestra_search` y `orchestra_get` |
| "Fijá la memoria del contrato de facturas" | `orchestra_pin`: aparece siempre al abrir la sesión |
| "Borrá la memoria #12" | `orchestra_delete` (soft); también se retira de los demás repos |

Para que algo no se guarde nunca, ni localmente, envolvelo en `<private>…</private>`.

### Otros repositorios

| Pedile | Qué hace |
| --- | --- |
| "¿Cómo crea facturas el servicio de billing?" | `orchestra_recall` sobre la memoria compartida. Funciona con su codespace apagado |
| "¿En qué rama quedó web?" | `orchestra_checkpoints` |
| "Prendé el codespace de billing" | `orchestra_wake`. Solo con backend D1 y `GITHUB_TOKEN` en el Worker; tiene costo |

Lo que guarda otro repo llega en su próxima sincronización (cada 5 minutos). `orchestra_sync` publica lo tuyo al instante.

### Tareas entre repos

> "Las órdenes tienen que guardar el invoiceId de billing y web tiene que mostrar el recibo. Coordinalo."

1. Investiga en todos los repos y les pide ayuda a los otros agentes.
2. Te muestra un plan por repo y **espera tu decisión**: aprobar, revisar o quedarse solo con el plan.
3. Si aprobás, cada repo edita en una rama nueva, verifica y abre un PR. Nunca hace merge.

Otros pedidos: "¿en qué quedó la tarea task_…?", "cancelá la tarea", "seguí la tarea task_…" (si el orquestador original se fue).

### Mensajes

| Pedile | Qué hace |
| --- | --- |
| "Preguntale a billing qué códigos de error devuelve /invoices" | `orchestra_send` |
| "¿Tengo mensajes?" | `orchestra_inbox` |

Cuando llega un pedido de otro repo, aparece una línea `[orchestra-man] Mensaje …` y Claude lo atiende. Antes de editar código te pregunta, aunque el otro repo ya lo haya aprobado.

### Configuración

| Para | Usá |
| --- | --- |
| Desplegar tu Worker (una vez) | `npm run worker:setup` en el repo del plugin |
| Configurar esta máquina | `/orchestra-man:configure` |
| Ver el estado | `/orchestra-man:help` |
| Publicar la memoria ya | "sincronizá" (`orchestra_sync`) |

Todas tus máquinas deben usar el mismo `maskSalt`. Lo explica `/orchestra-man:configure`.

### Comandos

- `/orchestra-man:help [tema]`: este diagnóstico y la guía. Temas: `memoria`, `repos`, `tareas`, `mensajes`, `configuracion`.
- `/orchestra-man:configure [d1|local]`: configurar el backend, la URL, el token y el enmascarado.

Documentación completa: https://github.com/TomasTaniguchi/orchestra-man-plugin/tree/main/docs (problemas frecuentes en `docs/troubleshooting.md`).
