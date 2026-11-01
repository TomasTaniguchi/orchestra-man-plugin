# 0003. Extender Engram sin forkearlo, con contrato propio

**Estado**: aceptada (2026-10-31)

## Contexto

Engram ya resuelve la memoria de cada repo: el agente guarda observaciones curadas en un SQLite con FTS5, con su propio protocolo y plugin de Claude Code. Su sincronización pasa por una interfaz `Transport` y tiene una nube propia sobre Postgres. Se decidió usar un **contrato propio**, no el de Engram Cloud.

## Decisión

- Engram sigue siendo la memoria local de cada repo, sin cambios.
- orchestra-man lee la API HTTP local de Engram (`GET /observations/recent`), de solo lectura, y replica las observaciones a `memories` con su propio contrato, enmascaradas.
- No forkeamos ni modificamos el binario de Go.

## Consecuencias

- Las actualizaciones de Engram no requieren mantener un fork.
- Dependemos de la forma de `/observations/recent`. El cliente valida solo los campos que usa (`src/plugin/engram.ts`) para tolerar campos nuevos.
- Sin Engram corriendo, la replicación se omite y se informa; lo demás funciona.
- `shortcut`: la replicación relee una ventana de 200 observaciones en cada sincronización. Es idempotente; si el volumen crece, conviene agregar una marca de agua.
