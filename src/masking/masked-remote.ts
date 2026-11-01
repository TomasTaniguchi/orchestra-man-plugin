import { type Remote, REMOTE_METHODS } from "../core/remote";
import { type Mask, maskDeep } from "./masker";

/**
 * Decorates a Remote so every free-text field is masked before it is sent.
 * Identifiers (repo, agent, task and message ids) pass through untouched so routing still works.
 */
export function maskedRemote(remote: Remote, mask: Mask): Remote {
  const delegate = Object.fromEntries(
    REMOTE_METHODS.map((name) => [name, (remote[name] as (...a: unknown[]) => unknown).bind(remote)]),
  ) as unknown as Remote;

  return {
    ...delegate,
    upsertMemories: (batch) =>
      remote.upsertMemories({
        ...batch,
        items: batch.items.map((item) => ({ ...item, title: mask(item.title), content: mask(item.content) })),
      }),
    saveCheckpoint: (checkpoint) => remote.saveCheckpoint({ ...checkpoint, summary: mask(checkpoint.summary) }),
    createTask: (task) => remote.createTask({ ...task, title: mask(task.title), state: maskDeep(task.state, mask) }),
    updateTask: (id, update) => remote.updateTask(id, { ...update, state: maskDeep(update.state, mask) }),
    sendMessage: (message) => remote.sendMessage({ ...message, body: mask(message.body) }),
  };
}
