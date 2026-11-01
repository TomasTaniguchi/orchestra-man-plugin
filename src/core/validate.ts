import type { z } from "zod";
import { OrchestraError } from "./errors";

/** Parses untrusted input against a contract schema, failing with a 400-mapped error. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  throw new OrchestraError("bad_request", detail);
}
