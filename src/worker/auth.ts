import { sha256Hex } from "../core/clock";
import { OrchestraError } from "../core/errors";
import type { Auth } from "../core/routes";

export const bearerToken = (request: Request): string | null =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;

/** Compares secrets in constant time by comparing fixed-length digests. */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export interface AuthDeps {
  adminToken: string | undefined;
  isValidAgentToken: (token: string) => Promise<boolean>;
}

/** Throws `unauthorized` unless the request carries a credential valid for `auth`. */
export async function authorize(request: Request, auth: Auth, deps: AuthDeps): Promise<void> {
  if (auth === "none") return;
  const token = bearerToken(request);
  if (!token) throw new OrchestraError("unauthorized", "missing bearer token");
  if (auth === "admin") {
    if (!deps.adminToken) throw new OrchestraError("unavailable", "ADMIN_TOKEN secret is not set");
    if (await secretsEqual(token, deps.adminToken)) return;
  } else if (await deps.isValidAgentToken(token)) {
    return;
  }
  throw new OrchestraError("unauthorized", "invalid or revoked token");
}
