import type { ErrorCode } from "./contract";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

/** The only error type that crosses layers. Carries a contract error code. */
export class OrchestraError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrchestraError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const statusOf = (code: ErrorCode): number => STATUS[code];

export function codeForStatus(status: number): ErrorCode {
  const match = (Object.entries(STATUS) as [ErrorCode, number][]).find(([, s]) => s === status);
  return match ? match[0] : "internal";
}
