/** Time and identity sources. Injected everywhere so tests are deterministic. */
export interface Clock {
  now(): Date;
}

export interface Ids {
  /** A unique, URL-safe identifier with a readable prefix, e.g. `task_…`. */
  id(prefix: string): string;
  /** A high-entropy secret for API tokens. */
  secret(): string;
}

export const systemClock: Clock = { now: () => new Date() };

export const randomIds: Ids = {
  id: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`,
  secret: () => `om_${toHex(crypto.getRandomValues(new Uint8Array(32)))}`,
};

const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const iso = (date: Date): string => date.toISOString();
export const addSeconds = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

export async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
