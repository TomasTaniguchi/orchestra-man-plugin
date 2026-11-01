# Enmascarado

Código: `src/masking/`. Se aplica en el cliente, **antes** de cualquier petición de red, mediante el decorador `maskedRemote`, que `createRuntime` aplica siempre.

## Qué se enmascara

Los campos de texto libre: título y contenido de memorias, resumen de checkpoints, cuerpo de mensajes, título de tareas y todo string dentro del estado de una tarea. Los identificadores (repo, agente, ids de tareas y mensajes) **no** se enmascaran, porque se usan para enrutar.

## Reglas por defecto

En orden de aplicación (`DEFAULT_RULES` en `src/masking/rules.ts`):

| Regla | Ejemplo | Resultado |
| --- | --- | --- |
| `private_key` | `-----BEGIN RSA PRIVATE KEY----- …` | `<private_key:…>` |
| `jwt` | `eyJhbGciOi….eyJzdWIi….dozj…` | `<jwt:…>` |
| `url_credentials` | `https://admin:hunter2@db:5432` | `https://<url_credentials:…>@db:5432` |
| `bearer` | `Bearer abcdefghijklmnop1234` | `Bearer <bearer:…>` |
| `secret_assignment` | `password: "S3cr3t"`, `api_key=…`, `token=…` | `password: "<secret_assignment:…>"` |
| `github_token` | `ghp_…`, `github_pat_…` | `<github_token:…>` |
| `aws_access_key` | `AKIAIOSFODNN7EXAMPLE` | `<aws_access_key:…>` |
| `api_key` | `sk_live_…`, `sk-…`, `xoxb-…`, tokens `om_…` | `<api_key:…>` |
| `email` | `jane.doe@acme.com` | `<email:…>` |
| `phone` | `+54 9 11 4567-8901`, `(011) 4567-8901` | `<phone:…>` |
| `uuid` | `3f2c8a10-5b7e-…` | `<uuid:…>` |
| `id` | `user_id=8812345`, `"customerId": 123456` | `user_id=<id:…>` |

El snapshot de `src/masking/masking.test.ts` muestra el resultado exacto sobre un texto de ejemplo, y otro test garantiza que versiones, fechas, puertos, SHAs de git y código **no** se tocan.

## Placeholders

`<regla:hash>`, donde `hash` son los primeros 8 caracteres hex de `HMAC-SHA256(salt, valor)`.

- **Deterministas**: el mismo valor da siempre el mismo placeholder, así los agentes pueden decir "el cliente `<email:bab800ec>` aparece en el incidente y en la factura".
- **No reversibles sin el salt**: un HMAC con salt secreto evita que se pruebe un diccionario de emails o teléfonos.
- **Mismo salt en todas las máquinas**: si no, el mismo valor da placeholders distintos en cada repo.

## Reglas propias

```bash
cli.mjs configure --set 'maskPatterns=["CUST-\\d{6}", "\\bAR\\d{11}\\b"]'
```

O la variable `ORCHESTRA_MASK_PATTERNS` con el mismo array JSON. Se aplican después de las reglas por defecto y producen `<custom:…>`. Un patrón inválido hace fallar la carga de configuración con un mensaje que lo nombra.

## Límites conocidos

`shortcut`: el enmascarado es por expresiones regulares.

- **No detecta**: nombres de personas, direcciones postales, números de documento sin contexto, tarjetas de crédito, ni datos sensibles en texto libre sin un formato reconocible.
- **Teléfonos**: solo internacionales con `+` o locales con código de área entre paréntesis. Las secuencias de dígitos sueltas se dejan porque suelen ser ids, puertos o timestamps.
- **IDs numéricos**: solo cuando están asignados a una clave con forma de id (`*_id`, `*Id`, `id`, `ID`) y tienen 4 dígitos o más.

Si la política de datos de tu empresa exige más, el siguiente paso es sumar un detector de entidades (NER) en `createMasker`. La interfaz `Mask` (`(text) => text`) no cambia.
