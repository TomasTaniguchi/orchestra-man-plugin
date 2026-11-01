# 0001. TypeScript en todo

**Estado**: aceptada (2026-10-31)

## Contexto

Hay tres piezas: un Worker de Cloudflare, un plugin de Claude Code (servidor MCP, hooks, monitor) y la orquestación con LangGraph. Engram, que reutilizamos, está escrito en Go.

## Decisión

Las tres piezas se escriben en TypeScript, en un solo paquete:

- Workers corre JavaScript de forma nativa.
- LangGraph tiene versión JavaScript oficial.
- El SDK de MCP para TypeScript es el de referencia.
- Un solo lenguaje permite **un único contrato** (`src/core/contract.ts`) que validan el servidor y el cliente, y una única capa de datos.

## Consecuencias

- No se reutiliza código Go de Engram; se reutiliza Engram como servicio (ver [0003](0003-extender-engram-sin-fork.md)).
- El plugin requiere Node.js 22.13 o superior, por `node:sqlite`.
- Un solo `package.json` en lugar de un monorepo con workspaces: menos configuración, y cada artefacto (Worker y bundle del plugin) toma solo lo que importa.
