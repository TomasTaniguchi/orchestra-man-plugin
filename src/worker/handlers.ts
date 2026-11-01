import type { Operation } from "../core/routes";
import type { OrchestraService } from "../core/service";

export interface HandlerInput {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

type Handler = (service: OrchestraService, input: HandlerInput) => Promise<unknown>;

const bodyField = (body: unknown, key: string): unknown =>
  body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;

/** Unpacks an HTTP request into a service call. The inverse lives in plugin/http-remote.ts. */
export const HANDLERS: Record<Operation, Handler> = {
  health: (s) => s.health(),
  registerAgent: (s, { body }) => s.registerAgent(body),
  listAgents: (s) => s.listAgents(),
  wake: (s, { body }) => s.wake(bodyField(body, "repo")),
  upsertMemories: (s, { body }) => s.upsertMemories(body),
  searchMemories: (s, { query }) => s.searchMemories(query),
  saveCheckpoint: (s, { body }) => s.saveCheckpoint(body),
  latestCheckpoints: (s, { query }) => s.latestCheckpoints(query.repo),
  createTask: (s, { body }) => s.createTask(body),
  getTask: (s, { params }) => s.getTask(params.id ?? ""),
  acquireLease: (s, { params, body }) => s.acquireLease(params.id ?? "", body),
  updateTask: (s, { params, body }) => s.updateTask(params.id ?? "", body),
  sendMessage: (s, { body }) => s.sendMessage(body),
  inbox: (s, { query }) => s.inbox(query),
  ackMessage: (s, { params, body }) => s.ackMessage(params.id ?? "", body),
  createToken: (s, { body }) => s.createToken(body),
  revokeToken: (s, { params }) => s.revokeToken(params.id ?? ""),
};
