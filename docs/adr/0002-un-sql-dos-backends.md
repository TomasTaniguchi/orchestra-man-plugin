# 0002. Un SQL, dos backends

**Estado**: aceptada (2026-10-31)

## Contexto

Se pidieron dos modos: D1 a través de un Worker (compartido entre máquinas) y SQLite local (sin nube). Implementar la lógica dos veces duplicaría reglas delicadas: leases, versiones, idempotencia.

## Decisión

- `SqlDatabase` (`src/core/db.ts`) es el subconjunto de la API de D1 que usamos. El binding de D1 la cumple tal cual; `openNodeSqlite` la implementa sobre `node:sqlite`.
- Repositorios y `OrchestraService` dependen solo de esa interfaz.
- Un único esquema (`migrations/`) lo aplican wrangler a D1 y `applyMigrations` al SQLite local.
- El Worker es un adaptador HTTP sobre el mismo servicio.

## Consecuencias

- Toda regla de negocio existe una sola vez.
- El esquema debe ser SQLite portable (lo es: FTS5, upsert y funciones ventana están en ambos).
- Los tests corren el Worker real en proceso sobre `node:sqlite`, y el escenario e2e exige resultados idénticos en ambos backends. La migración también se verificó contra el D1 local de wrangler (workerd).
- El modo local solo coordina procesos de la misma máquina (archivo con WAL y `busy_timeout`).
