/**
 * The HTTP surface of the contract. Shared by the Worker router (server) and
 * `httpRemote` (client); `test/e2e/contract.test.ts` checks it against docs/api/openapi.yaml.
 * Paths use OpenAPI `{param}` syntax.
 */
export type Auth = "none" | "agent" | "admin";
export type Method = "GET" | "POST" | "PUT";

export interface RouteDef {
  method: Method;
  path: string;
  auth: Auth;
  status: 200 | 201;
}

const route = (method: Method, path: string, auth: Auth = "agent", status: 200 | 201 = 200): RouteDef => ({
  method,
  path,
  auth,
  status,
});

export const ROUTES = {
  health: route("GET", "/v1/health", "none"),
  registerAgent: route("POST", "/v1/agents"),
  listAgents: route("GET", "/v1/agents"),
  wake: route("POST", "/v1/wake"),
  upsertMemories: route("PUT", "/v1/memories"),
  searchMemories: route("GET", "/v1/memories/search"),
  saveCheckpoint: route("POST", "/v1/checkpoints", "agent", 201),
  latestCheckpoints: route("GET", "/v1/checkpoints/latest"),
  createTask: route("POST", "/v1/tasks", "agent", 201),
  getTask: route("GET", "/v1/tasks/{id}"),
  acquireLease: route("POST", "/v1/tasks/{id}/lease"),
  updateTask: route("PUT", "/v1/tasks/{id}"),
  sendMessage: route("POST", "/v1/messages", "agent", 201),
  inbox: route("GET", "/v1/messages"),
  ackMessage: route("POST", "/v1/messages/{id}/ack"),
  createToken: route("POST", "/v1/admin/tokens", "admin", 201),
  revokeToken: route("POST", "/v1/admin/tokens/{id}/revoke", "admin"),
} as const satisfies Record<string, RouteDef>;

export type Operation = keyof typeof ROUTES;

/** Fills `{param}` placeholders, URL-encoding each value. */
export const buildPath = (path: string, params: Record<string, string> = {}): string =>
  path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));

/** Matches a concrete pathname against a route path, returning decoded params or null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const names: string[] = [];
  const regex = new RegExp(
    `^${pattern.replace(/\{(\w+)\}/g, (_, name: string) => (names.push(name), "([^/]+)"))}$`,
  );
  const match = regex.exec(pathname);
  if (!match) return null;
  return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1] ?? "")]));
}

export function findRoute(
  method: string,
  pathname: string,
): { operation: Operation; def: RouteDef; params: Record<string, string> } | null {
  for (const [operation, def] of Object.entries(ROUTES) as [Operation, RouteDef][]) {
    if (def.method !== method) continue;
    const params = matchPath(def.path, pathname);
    if (params) return { operation, def, params };
  }
  return null;
}
