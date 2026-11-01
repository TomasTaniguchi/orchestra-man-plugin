# Desarrollo

## Comandos

```bash
npm ci
npm run typecheck
npm test              # unitarios + end-to-end
npm run test:unit     # src/**/*.test.ts
npm run test:e2e      # test/e2e
npm run test:update   # regenera snapshots: revisá el diff antes de commitear
npm run build         # genera plugin/dist (versionado)
npm run check         # typecheck + tests + build, lo mismo que CI
```

CI (`.github/workflows/ci.yml`) además falla si `plugin/dist` no coincide con lo que genera `npm run build`.

## Probar el plugin en tu Claude Code sin instalarlo

```bash
npm run build
claude --plugin-dir ./plugin
claude plugin validate ./plugin
```

## Estrategia de tests

| Nivel | Dónde | Qué cubre |
| --- | --- | --- |
| Unitario | `src/**/*.test.ts` | Repositorios y servicio sobre SQLite en memoria; Worker en proceso; enmascarado; grafo; config, identidad, sync, CLI y MCP con dependencias falsas |
| Contrato | `test/e2e/contract.test.ts` | `docs/api/openapi.yaml` documenta exactamente las rutas de `src/core/routes.ts` |
| Escenario | `test/e2e/multi-agent.e2e.test.ts` | Tres repos y el flujo completo **en los dos backends**, con resultados idénticos y sin datos sensibles en ninguna tabla |
| Artefacto | `test/e2e/bundle.e2e.test.ts` | `plugin/dist` ejecutado como procesos: hooks y MCP por stdio sobre dos clones git reales |

Todo es determinista: el reloj (`manualClock`) y los ids (`sequentialIds`) se inyectan desde `test/helpers/fixtures.ts`. Los snapshots no deberían cambiar entre corridas; si cambian, es un cambio de comportamiento.

Helpers:

- `testService()`: servicio sobre SQLite en memoria ya migrado.
- `inProcessWorker()` / `issueToken()`: el Worker real, en proceso.
- `makeBackend("d1" | "local")`: un backend de producción completo.
- `testRuntime({ repo, machine, codespace, remote, memories, git })`: un agente con su memoria local precargada y git falso.

## Recetas

### Agregar un endpoint

1. Esquemas en `src/core/contract.ts`.
2. Método en `OrchestraService` (validá con `parse`), y en el puerto `Remote` y `REMOTE_METHODS` si el plugin lo usa.
3. Ruta en `ROUTES` (`src/core/routes.ts`) y handler en `HANDLERS` (`src/worker/handlers.ts`).
4. Cliente en `httpRemote` (`src/plugin/http-remote.ts`). Si lleva texto libre, enmascaralo en `maskedRemote`.
5. Documentá la ruta en `docs/api/openapi.yaml`. El test de contrato falla hasta que coincidan.
6. Tests: unitario en el servicio y, si cambia un flujo, el escenario e2e.

### Agregar una herramienta MCP

1. Entrada en `TOOLS` (`src/plugin/mcp.ts`): descripción, esquema zod y `run`, que delega en un caso de uso (`src/plugin/commands.ts`) o en el `Remote`.
2. Si es una decisión humana, hacela herramienta aparte (como `orchestra_task_approve`) para que Claude Code pida permiso.
3. Documentala en `docs/reference/mcp-tools.md` y, si cambia el protocolo, en `plugin/skills/orchestra/SKILL.md`.
4. `npm run build`.

### Agregar una regla de enmascarado

1. Regla en `DEFAULT_RULES` (`src/masking/rules.ts`). Usá lookbehind y lookahead para no capturar contexto que no es sensible.
2. Agregá un caso a `SENSITIVE` y, si hay riesgo de falso positivo, otro a `HARMLESS` en `src/masking/masking.test.ts`.
3. `npm run test:update` y revisá el snapshot.

### Cambiar el esquema

Nunca edites una migración ya publicada. Agregá `migrations/0002_<nombre>.sql`: wrangler la aplica a D1 (`npm run worker:migrate:remote`) y el modo local la aplica solo al abrir la base.

### Agregar una fase al grafo

1. `Phase` y, si hace falta, un nuevo `kind` en `TaskInput` (`src/orchestration/state.ts`).
2. Nodo en `src/orchestration/nodes.ts` que valide su entrada con `requireInput` y registre la acción con `step`.
3. Registralo en `NODES` y `NODE_FOR_PHASE` (`src/orchestration/graph.ts`).
4. Actualizá `docs/architecture/orchestration.md` y la skill.
