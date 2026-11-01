# 0007. Bundle del plugin versionado

**Estado**: aceptada (2026-10-31)

## Contexto

Claude Code instala un plugin copiando su directorio. No ejecuta `npm install`. El runtime necesita zod, el SDK de MCP y LangGraph.

## Decisión

- `scripts/build-plugin.mjs` empaqueta con esbuild dos entradas autocontenidas, `plugin/dist/mcp.mjs` y `plugin/dist/cli.mjs` (minificadas, con nombres conservados), y copia `migrations/` al lado.
- `plugin/dist/` se commitea.
- CI regenera el bundle y falla si difiere del commiteado.

## Consecuencias

- Instalar el plugin no requiere build ni red.
- Cada cambio en `src/` debe ir acompañado de `npm run build`.
- El test `test/e2e/bundle.e2e.test.ts` ejecuta el bundle real, no el código fuente.
