# Desplegar tu Worker con D1

Cada persona despliega **su propio** Worker. Es de uso personal: la memoria, los mensajes y las tareas quedan en tu cuenta de Cloudflare, y vos decidís qué máquinas tienen token.

Tiempo estimado: 10 minutos. Alcanza con el plan Free para empezar (ver [límites](../reference/d1-limits.md)).

## Requisitos

- Cuenta de Cloudflare.
- Node.js 22.13 o superior.
- Este repositorio clonado.

```bash
git clone https://github.com/TomasTaniguchi/orchestra-man-plugin
cd orchestra-man-plugin
npm ci
```

## 1. Iniciar sesión en Cloudflare

```bash
npx wrangler login
```

## 2. Crear la base D1

```bash
npx wrangler d1 create orchestra-man
```

El comando imprime un `database_id`. Copialo en `worker/wrangler.jsonc`, en lugar de `REPLACE_WITH_YOUR_DATABASE_ID`. Si usás otro nombre de base, cambiá también `database_name` y el nombre en los scripts `worker:migrate:*` de `package.json`.

> No commitees tu `database_id` en un fork público si no querés exponer el identificador. No da acceso por sí solo, pero no hace falta publicarlo.

## 3. Aplicar el esquema

```bash
npm run worker:migrate:remote
```

Aplica `migrations/0001_init.sql`: tablas, índices, la tabla FTS5 de búsqueda y sus triggers.

## 4. Crear el secreto de administración

El `ADMIN_TOKEN` solo sirve para emitir y revocar tokens de máquina. Generá uno largo y guardalo en tu gestor de contraseñas:

```bash
openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN -c worker/wrangler.jsonc
```

## 5. (Opcional) Habilitar el encendido de codespaces

Para que `orchestra_wake` pueda encender un codespace apagado, el Worker necesita un **PAT clásico** de GitHub con scope `codespace`, del mismo usuario dueño de los codespaces. La API de GitHub no documenta qué permiso necesitan los tokens de grano fino para esta operación.

```bash
npx wrangler secret put GITHUB_TOKEN -c worker/wrangler.jsonc
```

Sin este secreto todo funciona igual, salvo `orchestra_wake`, que responde `unavailable`.

## 6. Desplegar

```bash
npm run worker:deploy
```

Anotá la URL que imprime, por ejemplo `https://orchestra-man.<tu-subdominio>.workers.dev`, y verificá:

```bash
curl https://orchestra-man.<tu-subdominio>.workers.dev/v1/health
# {"status":"ok","service":"orchestra-man","version":"0.2.0"}
```

## 7. Emitir un token por máquina

Un token por laptop o codespace, así podés revocarlos por separado:

```bash
export ORCHESTRA_URL=https://orchestra-man.<tu-subdominio>.workers.dev
export ADMIN_TOKEN=<el valor del paso 4>

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

## 8. Configurar el plugin

Seguí [install-plugin.md](install-plugin.md) con la URL y el token.

## Mantenimiento automático

El Worker trae un Cron Trigger diario (`17 3 * * *`, UTC) que:

- borra mensajes leídos tras `RETENTION_ACKED_MESSAGE_DAYS` (7) y no leídos tras `RETENTION_UNREAD_MESSAGE_DAYS` (30);
- borra checkpoints de más de `RETENTION_CHECKPOINT_DAYS` (30), **conservando siempre el último de cada repo**;
- libera leases vencidos.

Los valores están en `vars` de `worker/wrangler.jsonc`. Las memorias no expiran: se actualizan por upsert.

## Desarrollo local del Worker

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
DB="orchestra-man -c worker/wrangler.jsonc --remote"
npx wrangler d1 execute $DB --command "DROP TRIGGER memories_ai; DROP TRIGGER memories_ad; DROP TRIGGER memories_au; DROP TABLE memories_fts;"
npx wrangler d1 export $DB --output backup.sql
# Recreá la tabla y los triggers copiando su bloque de migrations/0001_init.sql, y después:
npx wrangler d1 execute $DB --command "INSERT INTO memories_fts(memories_fts) VALUES('rebuild');"
```

Mientras la tabla no existe, la búsqueda falla y las escrituras de memorias también. Hacelo con las sesiones cerradas.
