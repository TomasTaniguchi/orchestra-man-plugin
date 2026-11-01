# 0006. Enmascarado en el cliente con placeholders HMAC

**Estado**: aceptada (2026-10-31)

## Contexto

Se permite subir código y contexto de la empresa, pero se deben ocultar IDs y datos personales (emails, teléfonos), además de secretos. Para la primera versión alcanza con un enmascarado suficiente, que se mejorará iterando.

## Decisión

- Enmascarar en el cliente, antes de la red: lo que no sale no se puede filtrar.
- Un único punto de aplicación: el decorador `maskedRemote`, que `createRuntime` aplica siempre.
- Reglas regex ordenadas y extensibles por configuración.
- Placeholders `<regla:hmac8>` con un salt local: deterministas (los agentes correlacionan) y no reversibles por diccionario sin el salt.

## Consecuencias

- Hay falsos negativos (nombres, direcciones, texto libre). Están documentados en `docs/reference/masking.md`.
- Todas las máquinas deben compartir el salt.
- Los identificadores de enrutamiento (repo, agente, ids) no se enmascaran.
- Para subir el nivel, se puede sumar un detector de entidades sin cambiar la interfaz `Mask`.
