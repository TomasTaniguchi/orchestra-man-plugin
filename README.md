# orchestra-man

Plugin de Claude Code para **generar y corregir código entre varios repositorios a la vez**, con agentes que se hablan entre sí y una memoria compartida que sobrevive a que un codespace esté apagado.

```
 codespace acme/billing          clon local acme/api (acá preguntás)        clon local acme/web
 ┌──────────────────────┐        ┌──────────────────────────────┐          ┌──────────────────────┐
 │ Claude Code          │        │ Claude Code  ← orquestador   │          │ Claude Code          │
 │ + orchestra-man      │        │ + orchestra-man (LangGraph)  │          │ + orchestra-man      │
 │ + memoria local      │        │ + memoria local              │          │ + memoria local      │
 └──────────┬───────────┘        └──────────────┬───────────────┘          └──────────┬───────────┘
            │       memoria enmascarada · checkpoints · mensajes · tareas con lease    │
            └──────────────────────────────┬────────────────────────────────────────────┘
                                           ▼
                       Tu Worker de Cloudflare + D1   (o SQLite local)
```

## Qué resuelve

Trabajamos con microservicios en repositorios separados que funcionan como un solo producto. Cada Claude Code solo ve su repo, así que:

- **Olvida todo al cerrar la sesión.** Cada repo tiene su propia memoria persistente: decisiones, causas raíz y contratos que Claude guarda y recupera entre sesiones y después de compactar el contexto.
- **No sabe cómo es el otro servicio.** orchestra-man publica la memoria de cada repo en una base compartida. Desde `acme/api` podés preguntar cómo funciona el endpoint de `acme/billing` **aunque su codespace esté apagado**.
- **Un cambio cruza varios repos.** El Claude donde arrancás la consulta pasa a ser el **orquestador**: investiga con los demás, arma un plan, te pide autorización y coordina las ediciones. Cualquier repo puede ser orquestador, y si una máquina se duerme a mitad de tarea, otra puede tomarla.
- **Los agentes se hablan en ambos sentidos.** Cada repo tiene una bandeja. Un monitor del plugin avisa a Claude cuando llega un pedido de otro repo, y la respuesta vuelve por el mismo canal.
- **No querés que salgan datos sensibles.** Todo lo que sale de tu máquina pasa antes por un enmascarado: emails, teléfonos, tokens, claves y IDs se reemplazan por placeholders estables como `<email:1a2b3c4d>`.

## Cómo funciona

| Pieza | Qué hace |
| --- | --- |
| **Memoria** | Cada repo guarda en un SQLite local lo que vale la pena recordar: actualizaciones por tema con historial, sin duplicados, búsqueda de texto completo, sesiones con resumen y recuperación tras compactar. Diseño inspirado en [Engram](https://github.com/Gentleman-Programming/engram), sin necesidad de instalarlo. Lo `personal` nunca sale de la máquina. |
| **Sincronización** | Al abrir Claude Code, cada 5 minutos y al cerrar: publica solo los cambios nuevos (enmascarados, en lotes) y guarda un *checkpoint* con rama, commit y archivos sin commitear. |
| **Backend** | Tu Worker de Cloudflare con D1 (compartido entre máquinas) o un SQLite local (varios Claude en la misma máquina). Mismo código y mismo esquema en ambos. |
| **Orquestación** | Un grafo de LangGraph: `investigate → plan → approve → edit → verify → propose`. Si la verificación falla, vuelve a `edit`; tras 3 fallos vuelve a `plan` y te pide autorización otra vez. LangGraph solo ordena pasos y llama herramientas: **el razonamiento lo hace Claude Code**, así que no hay costo extra de API. |
| **Autorización** | Nada se edita sin tu decisión explícita (`approve`, `revise` o `plan-only`). Es una herramienta MCP aparte, así que Claude Code te pide permiso. Los cambios van siempre a ramas nuevas y terminan en pull requests, nunca en `main`. |

Más detalle en [docs/architecture/overview.md](docs/architecture/overview.md).

## Requisitos

- Claude Code.
- Node.js **22.13 o superior** (usa `node:sqlite`).
- Para el modo compartido: una cuenta de Cloudflare (el plan Free alcanza para empezar).

## Instalación rápida

### 1. Instalar el plugin

Dentro de Claude Code:

```
/plugin marketplace add TomasTaniguchi/orchestra-man-plugin
/plugin install orchestra-man@orchestra-man
```

Instalalo en **cada** codespace y clon local que quieras conectar.

### 2. Elegí el backend

**Solo en esta máquina (sin nube):**

```
/orchestra-man:configure local
```

**Compartido entre máquinas (recomendado):** primero desplegá tu Worker con `npm run worker:setup` ([guía](docs/guides/deploy-worker.md)); en la máquina donde lo corrés, el script ya deja el plugin configurado. En las demás:

```
/orchestra-man:configure d1
```

El token **nunca se pega en el chat**: la skill te indica un comando para correr en tu terminal. En codespaces se usan secretos de GitHub Codespaces. Ver [docs/guides/install-plugin.md](docs/guides/install-plugin.md).

### 3. Reiniciá Claude Code

Al abrir la sesión vas a ver la memoria de tu repo y un bloque `# orchestra-man` con los otros repos (online u offline), su último checkpoint y tu bandeja. Para confirmar que todo está bien: `/orchestra-man:help`.

## Armar el Worker con D1 (resumen)

Cada persona despliega **su propio** Worker desde este repo. Es de uso personal: tus datos quedan en tu cuenta. Un script interactivo hace todo, en macOS, Linux y Windows (Git Bash o WSL):

```bash
git clone https://github.com/TomasTaniguchi/orchestra-man-plugin && cd orchestra-man-plugin && npm ci
npm run worker:setup
```

El script inicia sesión en Cloudflare, crea la base D1 (o reutiliza una existente), aplica el esquema, despliega y carga los secretos. Al final emite un token para tu máquina y configura el plugin. Te pregunta los nombres, si querés generar el `ADMIN_TOKEN` y, opcionalmente, un `GITHUB_TOKEN` (PAT clásico con scope `codespace`) para que `orchestra_wake` pueda encender codespaces apagados. Tu configuración personal queda en `worker/wrangler.local.jsonc`, que git ignora.

Los pasos manuales, cómo emitir tokens para otras máquinas, los límites de D1 y los backups están en [docs/guides/deploy-worker.md](docs/guides/deploy-worker.md).

## Ayuda

```
/orchestra-man:help              # diagnóstico + guía completa
/orchestra-man:help memoria      # solo un tema: memoria, repos, tareas, mensajes, configuracion
```

Muestra cómo está el plugin en esta máquina y, si algo falla, qué hacer:

```
# orchestra-man · diagnóstico

✓ Configuración: modo d1 · https://orchestra-man.tomas.workers.dev
✓ Backend: responde (versión 0.2.0)
✓ Agente: acme/api#laptop (local) · registrado
✓ Memoria de este repo: 14 compartidas, 2 personales, 1 fijada, 6 sesiones · 3 cambios sin publicar (se publican en la próxima sincronización, o ya con orchestra_sync) · último cambio 2026-11-01T14:02:11.000Z

## Otros repositorios
- acme/billing: offline · cs-billing (codespace) · último checkpoint 2026-11-01T09:40:00.000Z en main@4f2a9c1
- acme/web: online · laptop (local) · último checkpoint 2026-11-01T13:58:00.000Z en feat/cart@91be0d2

## Bandeja: 1 sin leer (orchestra_inbox para verlos)

## Estado
Todo en orden.
```

Después muestra una guía corta con ejemplos de qué pedirle a Claude. Solo se ejecuta cuando la invocás, así que no ocupa contexto en tus conversaciones. Desde la terminal, `node <ruta-del-plugin>/dist/cli.mjs doctor` da el mismo diagnóstico.

## Uso

**Recordar** (memoria de este repo, entre sesiones):

> ¿Qué decidimos sobre los reintentos de webhooks?

Claude busca en la memoria local (`orchestra_context`, `orchestra_search`). Lo que guarda lo decide la skill `memory`: decisiones, causas raíz, contratos; nunca secretos ni progreso rutinario.

**Preguntar por otro servicio** (funciona con su codespace apagado):

> ¿Cómo crea facturas el servicio de billing y qué devuelve?

Claude usa `orchestra_recall` sobre la memoria de `acme/billing` y te dice la fecha del checkpoint en que se basa.

**Un cambio que cruza repos:**

> Quiero que las órdenes guarden el invoiceId de billing y que web muestre el link al recibo. Coordinalo con billing y web.

1. Claude arranca la tarea (`orchestra_task_start`) y pide investigación a `acme/billing` y `acme/web`.
2. Los Claude de esos repos reciben el aviso, investigan su código y responden.
3. Te muestra un plan por repo y **espera tu decisión**.
4. Si aprobás, cada repo edita su parte en una rama, verifica y abre un PR.

**Cuando te llega un pedido** de otro repo, el monitor te avisa con una línea `[orchestra-man] Mensaje ...`. Claude lo lee, investiga o edita (y en ese caso te pide confirmación acá también) y responde.

Más ejemplos en [docs/guides/usage.md](docs/guides/usage.md) y en `/orchestra-man:help`. Las 23 herramientas MCP están en [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md).

## Seguridad y datos

- **Enmascarado en el cliente**, antes de cualquier petición de red: emails, teléfonos, JWT, tokens Bearer, credenciales en URLs, asignaciones de secretos, claves de GitHub, AWS y Stripe, UUIDs e IDs numéricos. Los placeholders son HMAC con un *salt* local: el mismo valor da el mismo placeholder (los agentes pueden correlacionar), pero no se puede revertir sin el salt. Podés sumar tus propias reglas. Es una primera versión basada en reglas: **no detecta nombres, direcciones ni texto libre sensible**. Ver [docs/reference/masking.md](docs/reference/masking.md).
- **Tokens por máquina**, revocables. El Worker guarda solo su SHA-256.
- **El código nunca se sube.** Git sigue siendo la fuente de verdad. Solo viajan memorias, checkpoints, mensajes y estado de tareas.
- **Memorias personales y `<private>`.** Una memoria `personal` nunca sale de tu máquina, y si pasa a personal se retira del backend. Lo que esté entre `<private>…</private>` no se guarda, ni siquiera localmente. Las bajas viajan sin contenido.
- Modelo de amenazas completo en [docs/security.md](docs/security.md).

## Desarrollo

```bash
npm ci
npm run check        # typecheck + 119 tests (unitarios + end-to-end con snapshots) + build
```

Los tests end-to-end corren el escenario completo de tres repos contra **los dos backends** (Worker en proceso sobre SQLite y SQLite local), exigen resultados idénticos y verifican que ningún dato sensible llegue a la base. También ejecutan el bundle real (`plugin/dist`) como procesos, con MCP por stdio. Ver [docs/guides/development.md](docs/guides/development.md).

Este repo está pensado para trabajar con agentes: empezá por [AGENTS.md](AGENTS.md).

## Limitaciones conocidas (v0.1)

- El contexto de un repo apagado es el de su **último checkpoint**: puede estar desactualizado.
- Lo que guarda un repo llega a los demás en la siguiente sincronización (hasta 5 minutos, o al instante con `orchestra_sync`).
- Si quien venía usando Engram quiere traer sus memorias, hoy no hay importador.
- El enmascarado es por reglas (ver arriba).
- `orchestra_wake` solo funciona con el backend D1 y un `GITHUB_TOKEN` del dueño de los codespaces.
- En el plan Free de Cloudflare: 500 MB por base y 50 consultas por invocación. El plugin está dimensionado para eso ([docs/reference/d1-limits.md](docs/reference/d1-limits.md)).

## Licencia

MIT

## Agradecimientos

Gracias a [Alan Buscaglia (Gentleman Programming)](https://github.com/Alan-TheGentleman) por crear [Engram](https://github.com/Gentleman-Programming/engram). La memoria de orchestra-man toma sus conceptos:
- memoria curada por el agente;
- actualización por tema con historial;
- deduplicación;
- `<private>`;
- recuperación tras compactación;
- captura pasiva de aprendizajes;
- su protocolo de memoria.

Varias funciones de `src/memory/text.ts` están portadas de su código, que se distribuye bajo licencia MIT.
