# Usage

Examples with three repos that make up one product: `acme/api` (orders), `acme/billing` (invoices, in a codespace) and `acme/web` (frontend).

## When you open Claude Code

The start hook injects your repo's memory and a block like this into the context:

```
## Memoria de sesiones anteriores (acme/api)

### Recientes
- [decision] Elegido D1 sobre KV (#4, decision/storage)
- [bugfix] Corregido N+1 en OrderList (#3)

# orchestra-man
Agente acme/api#laptop (local) · backend d1 · memorias sincronizadas: 3.

## Otros repositorios
- acme/billing: offline · cs-billing (codespace) · último checkpoint 2026-10-31T11:40:00.000Z en main@4f2a9c1
- acme/web: online · laptop (local) · último checkpoint 2026-10-31T12:01:00.000Z en feat/cart@91be0d2

## Bandeja (1 sin leer)
- [investigate-request] de acme/web · tarea task_… · id msg_…: Tarea …: Mostrar el estado de pago en el checkout…
```

## Help at any time

```
/orchestra-man:help            # diagnosis + guide with examples
/orchestra-man:help tasks      # a single topic: memory, repos, tasks, messages, config
```

The diagnosis looks like this:

```
# orchestra-man · diagnóstico

✓ Configuración: modo d1 · https://orchestra-man.tomas.workers.dev
✓ Backend: responde (versión 0.2.0)
✓ Agente: acme/api#laptop (local) · registrado
✓ Memoria de este repo: 14 compartidas, 2 personales, 1 fijada, 6 sesiones · 3 cambios sin publicar (se publican en la próxima sincronización, o ya con orchestra_sync) · último cambio 2026-11-01T14:02:11.000Z

## Otros repositorios
- acme/billing: offline · cs-billing (codespace) · último checkpoint 2026-11-01T09:40:00.000Z en main@4f2a9c1
- acme/web: online · laptop (local) · último checkpoint 2026-11-01T13:58:00.000Z en feat/cart@91be0d2

## Bandeja: 1 sin leer (orchestra_inbox para verlos)

## Estado
Todo en orden.
```

If something fails, the "Estado" (status) section says what to do, for example "El token fue rechazado: emití uno nuevo…" (the token was rejected: issue a new one) or "Actualizá el Worker…" (update the Worker).

## 1. Your repo's memory

Claude saves only what is worth keeping (the `memory` skill): decisions, root causes, contracts. You can also ask for it:

> Save that the invoice endpoint returns invoiceId and status, and that we decided not to expose the amount.

It uses `orchestra_save` with a `topicKey` such as `architecture/invoice-api`. If it changes tomorrow, it is saved with the same key: it is updated and the previous version stays in the history. For something that is only yours ("my git alias…"), Claude uses `scope=personal` and it never leaves your machine.

> What did we decide last week about webhook retries?

Claude searches `orchestra_context` first, then `orchestra_search`, and reads the full entry with `orchestra_get`.

If the conversation is compacted, Claude is told to save the summary before continuing, so the work done is not lost.

## 2. Ask about another service

> What does billing return when I create an invoice? Does it retry webhooks?

Claude searches the shared memory with `orchestra_recall` (the billing codespace may be stopped) and cites the checkpoint the information comes from. If that is not enough, it offers to send an `investigate-request` or to start the codespace.

## 3. A cross-repo task

> Orders need to store the invoiceId from billing, and web needs to show the receipt link. Coordinate it.

1. **Investigate.** `orchestra_task_start` gathers the memory and checkpoints of the three repos, and sends investigation requests to billing and web.
2. **Responses.** The Claude sessions in billing and web get notified by the monitor, investigate their code and reply. In api, Claude reads the replies with `orchestra_inbox`.
3. **Plan.** Claude shows you a plan per repo: files, changes, risks and how to verify.
4. **Your decision.** You answer "approved", "change X" or "I only want the plan". Claude calls `orchestra_task_approve` and Claude Code asks you for permission for that tool.
5. **Edit.** Each repo works on a new branch. Billing and web receive an `edit-request` and **also ask for confirmation in their own session**.
6. **Verify.** Tests, lint and build. If something fails, it is fixed and verified again. After 3 failures, it goes back to the plan and asks for your authorization again.
7. **Propose.** One pull request per repo. It never merges.

At any time: "cancel the task" or "what's the status of task task_…?" (`orchestra_task_get` shows the full log).

## 4. When you get a request

The monitor writes a line like:

```
[orchestra-man] Mensaje investigate-request de acme/api (tarea task_…), id msg_…: Tarea …: Link orders to invoices…
```

Claude reads it, investigates your repo and replies. For an `edit-request` it asks you before editing, even if the user of the other repo already approved it.

## 5. A stopped repo you need to touch

If a task needs to **run or edit** in a stopped codespace, Claude offers you `orchestra_wake`, which starts it through the GitHub API (it needs `GITHUB_TOKEN` in the Worker). Starting a codespace costs money; reading its memory does not.

## 6. If a machine goes to sleep mid-task

The orchestrator lease lasts 10 minutes and is renewed at every step. If your laptop suspends, from another repo you can say "continue task task_…": once the lease has expired, that Claude takes it over and the log records the change. When your laptop comes back, it gets a notice that another agent is orchestrating the task.

## Best practices

- Save memory actively (`orchestra_save` after decisions, contracts and bugfixes): that is what others will be able to recall. The `memory` skill tells Claude when to do it.
- Check the checkpoint date before trusting context from an offline repo.
- Do not paste secrets into plans or messages. Masking covers known formats, not everything.
