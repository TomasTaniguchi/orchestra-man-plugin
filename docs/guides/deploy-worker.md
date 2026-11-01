# Desplegar tu Worker con D1

Cada persona despliega **su propio** Worker. Es de uso personal: la memoria, los mensajes y las tareas quedan en tu cuenta de Cloudflare, y vos decidís qué máquinas tienen token.

Alcanza con el plan Free para empezar (ver [límites](../reference/d1-limits.md)).

## Requisitos

- Cuenta de Cloudflare.
- Node.js 22.13 o superior.
- Bash:
  - **macOS**: el que viene con el sistema (3.2) alcanza.
  - **Linux**: el del sistema.
  - **Windows**: **Git Bash** (viene con [Git for Windows](https://git-scm.com/download/win)) o **WSL**. PowerShell y CMD no están soportados.
- Este repositorio clonado:

```bash
git clone https://github.com/TomasTaniguchi/orchestra-man-plugin
cd orchestra-man-plugin
npm ci
```

## Opción rápida: script interactivo (recomendado)

```bash
npm run worker:setup
# o directamente: bash scripts/setup-worker.sh
```

El script te guía en 8 pasos y pregunta solo lo necesario. Cada pregunta trae un valor por defecto: Enter lo acepta.

| Paso | Qué hace | Qué te pregunta |
| --- | --- | --- |
| 1. Requisitos | Verifica Node 22.13+ y corre `npm ci` si faltan dependencias | — |
| 2. Cuenta | Si no hay sesión de Cloudflare, abre el navegador (`wrangler login`) | — |
| 3. Nombres | Valida los nombres (minúsculas, números y guiones) | Nombre del Worker (`orchestra-man`) y de la base D1 (el mismo) |
| 4. Base D1 | La crea, o reutiliza una existente con ese nombre. Escribe tu configuración personal en `worker/wrangler.local.jsonc` (ignorada por git) | Si ya existe: ¿la reutilizo? |
| 5. Esquema | Aplica las migraciones a D1 | wrangler puede pedir confirmación: respondé que sí |
| 6. Despliegue | Despliega y detecta la URL `*.workers.dev` | La URL, solo si no la detecta |
| 7. Secretos | Carga `ADMIN_TOKEN` y, opcionalmente, `GITHUB_TOKEN` | ¿Genero el `ADMIN_TOKEN`? (si no, lo tipeás oculto) y el `GITHUB_TOKEN` (oculto, Enter para omitir) |
| 8. Esta máquina | Espera a que el Worker responda, emite un token para esta máquina y configura el plugin | Nombre de la máquina (el hostname) y ¿configuro el plugin? |

Al final muestra la URL y, **una sola vez**:
- el `ADMIN_TOKEN`, si lo generó: guardalo en tu gestor de contraseñas;
- el token de la máquina, si elegiste no configurar el plugin acá.

Los secretos que tipeás nunca se muestran ni quedan en el historial del shell.

### Volver a correrlo

Es seguro repetirlo, por ejemplo después de un error:
- la base se reutiliza;
- las migraciones solo aplican lo nuevo;
- el despliegue se actualiza.

Si elegís **generar** el `ADMIN_TOKEN`, el anterior deja de servir. Los tokens de máquina ya emitidos siguen funcionando, porque el Worker los guarda en D1.

### Sin preguntas (CI o reinstalación)

`--yes` toma todos los valores por defecto. Cualquier respuesta también se puede dar por variable de entorno:

```bash
OM_WORKER_NAME=orchestra-man OM_MACHINE_NAME=laptop-tomas bash scripts/setup-worker.sh --yes
```

| Variable | Respuesta |
| --- | --- |
| `OM_WORKER_NAME`, `OM_DATABASE_NAME` | Nombres |
| `OM_REUSE_DATABASE` | `s` o `n` |
| `OM_GENERATE_ADMIN_TOKEN` | `s` o `n` |
| `OM_ADMIN_TOKEN`, `OM_GITHUB_TOKEN` | Secretos (evitá dejarlos en el historial del shell) |
| `OM_WORKER_URL` | URL, si no se detecta |
| `OM_MACHINE_NAME` | Nombre del token de esta máquina |
| `OM_CONFIGURE_PLUGIN` | `s` o `n` |
| `OM_LOCAL_CONFIG` | Ruta de la configuración personal (por defecto `worker/wrangler.local.jsonc`) |

`bash scripts/setup-worker.sh --help` muestra el resumen.

## Opción manual

Si preferís hacerlo a mano, o el script falla en tu entorno, estos son los mismos pasos.

### 1. Iniciar sesión y crear la base

```bash
npx wrangler login
npx wrangler d1 create orchestra-man
```

### 2. Configuración personal

`worker/wrangler.jsonc` es la plantilla versionada; no pongas tu id ahí. Copiala a `worker/wrangler.local.jsonc`, que git ignora, y reemplazá `REPLACE_WITH_YOUR_DATABASE_ID` por el `database_id` que imprimió el paso anterior. Si usaste otros nombres, cambiá también `name` y `database_name`.

```bash
cp worker/wrangler.jsonc worker/wrangler.local.jsonc
```

Todos los comandos siguientes usan `-c worker/wrangler.local.jsonc`, y los scripts `npm run worker:*` ya lo hacen.

### 3. Esquema

```bash
npm run worker:migrate:remote
```

Aplica `migrations/0001_init.sql`: tablas, índices, la tabla FTS5 de búsqueda y sus triggers. Usa el binding `DB`, así que funciona con cualquier nombre de base.

### 4. Desplegar

```bash
npm run worker:deploy
```

Anotá la URL que imprime, por ejemplo `https://orchestra-man.<tu-subdominio>.workers.dev`. Se despliega antes de cargar los secretos porque `wrangler secret put` sobre un Worker que no existe pregunta si crearlo.

### 5. Secretos

El `ADMIN_TOKEN` solo sirve para emitir y revocar tokens de máquina. Generá uno largo (32 caracteres o más) y guardalo en tu gestor de contraseñas:

```bash
openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN -c worker/wrangler.local.jsonc
```

**Opcional**: para que `orchestra_wake` pueda encender un codespace apagado, cargá un **PAT clásico** de GitHub con scope `codespace`, del mismo usuario dueño de los codespaces. La API de GitHub no documenta qué permiso necesitan los tokens de grano fino para esta operación.

```bash
npx wrangler secret put GITHUB_TOKEN -c worker/wrangler.local.jsonc
```

Sin este secreto todo funciona igual, salvo `orchestra_wake`, que responde `unavailable`.

### 6. Verificar

```bash
curl https://orchestra-man.<tu-subdominio>.workers.dev/v1/health
# {"status":"ok","service":"orchestra-man","version":"0.2.0"}
```

### 7. Token de la máquina y plugin

Emití un token (ver la sección siguiente) y seguí [install-plugin.md](install-plugin.md) con la URL y el token.

## Emitir más tokens

Un token por laptop o codespace, así podés revocarlos por separado:

```bash
export ORCHESTRA_URL=https://orchestra-man.<tu-subdominio>.workers.dev
read -r -s -p "ADMIN_TOKEN: " ADMIN_TOKEN; echo

curl -s -X POST "$ORCHESTRA_URL/v1/admin/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"name":"laptop-tomas"}'
# {"id":"tok_...","name":"laptop-tomas","token":"om_...","createdAt":"..."}
```

El `token` se muestra **una sola vez**: el Worker guarda solo su SHA-256. Para revocarlo:

```bash
curl -s -X POST "$ORCHESTRA_URL/v1/admin/tokens/<id>/revoke" -H "Authorization: Bearer $ADMIN_TOKEN"
```

> Un token por máquina, pero todas tus máquinas comparten la misma base. Para compartir memoria con un colega, ambos tienen que apuntar al mismo Worker; si cada uno despliega el suyo, cada uno tiene su propia memoria.

## Mantenimiento automático

El Worker trae un Cron Trigger diario (`17 3 * * *`, UTC) que:

- borra mensajes leídos tras `RETENTION_ACKED_MESSAGE_DAYS` (7) y no leídos tras `RETENTION_UNREAD_MESSAGE_DAYS` (30);
- borra checkpoints de más de `RETENTION_CHECKPOINT_DAYS` (30), **conservando siempre el último de cada repo**;
- libera leases vencidos.

Los valores están en `vars` de `worker/wrangler.jsonc`; si los cambiás, cambialos también en tu `worker/wrangler.local.jsonc`. Las memorias no expiran: se actualizan por upsert.

## Desarrollo local del Worker

No necesita cuenta ni configuración personal: usa la plantilla y una D1 local.

```bash
cp worker/.dev.vars.example worker/.dev.vars   # y editá ADMIN_TOKEN
npm run worker:migrate:local
npm run worker:dev                             # http://localhost:8787
```

## Actualizar

```bash
git pull
npm ci
npm run worker:migrate:remote   # aplica solo migraciones nuevas
npm run worker:deploy
```

## Backups

D1 tiene Time Travel: podés restaurar la base a cualquier minuto de los últimos 7 días (Free) o 30 días (Paid) con `npx wrangler d1 time-travel restore`.

`wrangler d1 export` **no funciona con bases que tienen tablas virtuales**, y `memories_fts` lo es. El procedimiento que indica Cloudflare es borrar la tabla virtual, exportar y recrearla:

```bash
# `d1 export` pide el nombre de la base (no el binding): usá el database_name de tu configuración local.
DB="orchestra-man -c worker/wrangler.local.jsonc --remote"
npx wrangler d1 execute $DB --command "DROP TRIGGER memories_ai; DROP TRIGGER memories_ad; DROP TRIGGER memories_au; DROP TABLE memories_fts;"
npx wrangler d1 export $DB --output backup.sql
# Recreá la tabla y los triggers copiando su bloque de migrations/0001_init.sql, y después:
npx wrangler d1 execute $DB --command "INSERT INTO memories_fts(memories_fts) VALUES('rebuild');"
```

Mientras la tabla no existe, la búsqueda falla y las escrituras de memorias también. Hacelo con las sesiones cerradas.
