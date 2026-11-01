# Decisiones de arquitectura (ADR)

Cada ADR registra una decisión, su contexto y sus consecuencias. Si una decisión cambia, se agrega un ADR nuevo que reemplaza al anterior; no se reescribe la historia.

| # | Decisión |
| --- | --- |
| [0001](0001-typescript-en-todo.md) | TypeScript en el Worker, el plugin y la orquestación |
| [0002](0002-un-sql-dos-backends.md) | Una interfaz con forma de D1 para correr el mismo SQL en D1 y en SQLite local |
| [0003](0003-extender-engram-sin-fork.md) | ~~Extender Engram leyendo su API~~ (reemplazada por 0008) |
| [0004](0004-langgraph-sin-checkpointer.md) | LangGraph un paso por invocación; el estado vive en el backend con lease |
| [0005](0005-configuracion-archivo-y-entorno.md) | Configuración por archivo 0600 y variables de entorno, no `userConfig` |
| [0006](0006-enmascarado-en-el-cliente.md) | Enmascarado en el cliente con placeholders HMAC |
| [0007](0007-bundle-versionado.md) | Bundle del plugin versionado en `plugin/dist` |
| [0008](0008-memoria-propia-local-primero.md) | Memoria propia, local primero, sin depender de Engram |
