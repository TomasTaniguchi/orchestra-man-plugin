# 0004. LangGraph un paso por invocación, estado en el backend

**Estado**: aceptada (2026-10-31)

## Contexto

- LangGraph debe solo orquestar herramientas; el razonamiento lo hace Claude Code, para no sumar costo de API.
- El orquestador puede cambiar de máquina, y una máquina puede apagarse a mitad de tarea.
- El checkpointer de LangGraph guarda estado en un almacenamiento propio y no conoce nuestro lease.

## Decisión

- Cada llamada a `orchestra_task_*` ejecuta **un paso**: `START → route() → nodo de la fase → END`.
- El estado del grafo es el `state` de la tarea en nuestro backend. Antes del paso se toma el lease; después se guarda con control de versión.
- Los nodos no llaman modelos: validan lo que Claude reportó, llaman herramientas inyectadas (`GraphTools`) y devuelven una instrucción.
- La aprobación humana es una herramienta MCP aparte, no un `interrupt` de LangGraph.

## Consecuencias

- Cualquier agente con el lease puede continuar la tarea; la rotación es natural.
- No hay un segundo almacenamiento que sincronizar.
- La puerta humana depende del sistema de permisos de Claude Code, que es visible y configurable por el usuario.
- No se usan funciones de LangGraph que dependen del checkpointer (time travel, `interrupt`). La bitácora `actions` cubre la trazabilidad.
