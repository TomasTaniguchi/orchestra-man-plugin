import { z } from "zod";

/** The subset of Engram's observation (GET /observations/recent) that orchestra-man replicates. */
export const EngramObservation = z.object({
  sync_id: z.string().min(1),
  type: z.string(),
  title: z.string(),
  content: z.string(),
  topic_key: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullish(),
});
export type EngramObservation = z.infer<typeof EngramObservation>;

export class EngramUnavailableError extends Error {
  override name = "EngramUnavailableError";
}

export interface EngramClient {
  recentObservations(project: string, limit: number): Promise<EngramObservation[]>;
}

/** Reads Engram's local HTTP API (`engram serve`, default port 7437). Read-only. */
export function engramClient(baseUrl: string, fetchFn: typeof fetch = fetch): EngramClient {
  return {
    async recentObservations(project, limit) {
      const url = new URL("/observations/recent", baseUrl);
      url.searchParams.set("project", project);
      url.searchParams.set("limit", String(limit));
      let response: Response;
      try {
        response = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
      } catch (error) {
        throw new EngramUnavailableError(`Engram is not reachable at ${baseUrl}: ${(error as Error).message}`);
      }
      if (!response.ok) throw new EngramUnavailableError(`Engram answered HTTP ${response.status} at ${url}`);
      return z.array(EngramObservation).parse(await response.json());
    },
  };
}
