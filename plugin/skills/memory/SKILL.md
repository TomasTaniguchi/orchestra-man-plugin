---
name: memory
description: "SIEMPRE ACTIVA. Memoria persistente de este repositorio: qué guardar (decisiones, causas raíz, contratos, restricciones), cómo actualizar por tema, cómo recordar y qué hacer al cerrar una sesión o después de una compactación."
---

# Memoria de este repositorio

Tenés una memoria persistente que sobrevive entre sesiones y compactaciones. Vive en esta máquina y se comparte, enmascarada, con los agentes de los otros repositorios en cada sincronización. Seguí este protocolo sin esperar a que te lo pidan.

## Qué guardar

Guardá conocimiento **verificado, duradero y caro de reconstruir**:
- decisiones con su razón;
- causas raíz que no eran obvias;
- contratos de API y eventos que otros servicios consumen;
- restricciones reales;
- trabajo pendiente que importa para retomar.

Agrupá conclusiones relacionadas; no guardes cada paso.

**No guardes:** secretos, datos personales, especulación, volcados crudos ni progreso rutinario. Si un dato sensible es imprescindible, envolvelo en `<private>…</private>`: no se guarda, ni siquiera localmente.

Formato de `orchestra_save`:
- **title**: verbo + qué, corto y buscable ("Corregido N+1 en OrderList", "Elegido D1 sobre KV").
- **type**: `bugfix`, `decision`, `architecture`, `discovery`, `pattern`, `config`, `preference` o `learning`.
- **scope**: `project` (por defecto, se comparte con los otros repos) o `personal` (solo esta máquina, nunca se sube).
- **topicKey**: clave estable para temas que evolucionan, por ejemplo `architecture/invoice-api`. Podés pedir una sugerencia con `orchestra_suggest_topic_key`.
- **content**:
  - **What**: una oración con lo que se hizo.
  - **Why**: qué lo motivó.
  - **Where**: archivos o rutas.
  - **Learned**: sorpresas y casos borde (omitilo si no hay).

## Actualizar por tema (obligatorio)

1. Antes de escribir sobre un tema, buscá con `orchestra_search` y leé completos los candidatos con `orchestra_get`. Un fragmento no prueba que sea el mismo tema.
2. **Mismo tema**: guardá con el mismo `topicKey`, o usá `orchestra_update` con el id. La versión anterior queda en el historial. Conservá los hechos que siguen siendo válidos.
3. **Tema nuevo**: `orchestra_save` con un `topicKey` distinto y deliberado. Si ya está cubierto, no escribas nada.
4. Si no estás seguro de que sea el mismo tema, o la búsqueda falló, no sobrescribas ni dupliques: preguntá o seguí sin guardar.

Guardar dos veces lo mismo en 15 minutos no duplica: solo suma un contador.

## Recordar

Cuando el usuario pregunte por trabajo pasado ("¿qué hicimos con…?", "acordate de…", "¿cómo resolvimos…?"):

1. `orchestra_context`: sesiones recientes, fijadas y recientes de este repo. Es rápido.
2. `orchestra_search` con palabras distintivas.
3. `orchestra_get` para el contenido completo. `orchestra_timeline` muestra lo que se guardó antes y después en la misma sesión.
4. Si es sobre **otro** repositorio, usá `orchestra_recall` (ver la skill `orchestra`).

Buscá cuando sirva de verdad; mencionar el proyecto no alcanza para buscar.

Fijá con `orchestra_pin` lo que tiene que estar siempre en el contexto, como un contrato central o una regla del repo.

## Cerrar una sesión

En un cierre o traspaso explícito, llamá a `orchestra_session_summary` con:
- **Goal**
- **Instructions**
- **Discoveries**
- **Accomplished**
- **Next Steps**
- **Relevant Files**

Terminar una tarea común no requiere resumen.

## Después de una compactación

Si el contexto dice que se compactó (bloque "el contexto se compactó"):

1. **Primero**, `orchestra_session_summary` con el contenido del resumen compactado. Si no, se pierde lo hecho antes de compactar.
2. Después, leé la memoria inyectada y, si hace falta, `orchestra_context`.
3. Recién entonces seguí con la tarea.

## Captura pasiva

Si un subagente termina su respuesta con una sección `## Key Learnings` o `## Aprendizajes` en ítems, el plugin guarda cada ítem nuevo como memoria. Es una red de seguridad, no reemplaza a `orchestra_save`. También podés llamar a `orchestra_capture_passive` con un texto que tenga esa sección.

## Entrega

La memoria es contabilidad interna, no la respuesta. Guardá antes de escribir la respuesta final. Si guardar falla, igual respondé, y no digas que algo quedó guardado si no lo confirmaste.
