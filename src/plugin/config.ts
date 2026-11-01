import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * Configuration precedence: environment variables > config file > defaults.
 * Env vars let codespaces use GitHub Codespaces secrets; the file (0600) serves local machines.
 * Every process (MCP server, hooks, monitor) reads the same file, which is why secrets are not in
 * plugin userConfig: monitors do not receive userConfig values.
 */
export const ConfigSchema = z.object({
  mode: z.enum(["d1", "local"]),
  workerUrl: z.url().nullable(),
  token: z.string().min(1).nullable(),
  localDbPath: z.string().min(1),
  maskSalt: z.string().min(16, "maskSalt must be at least 16 characters"),
  maskPatterns: z.array(z.string()),
  engramUrl: z.url(),
  engramProject: z.string().min(1).nullable(),
  checkpointIntervalSec: z.number().int().min(60),
  inboxPollSec: z.number().int().min(10),
  agentStaleMinutes: z.number().int().min(1),
});
export type Config = z.infer<typeof ConfigSchema>;

export const CONFIG_KEYS = Object.keys(ConfigSchema.shape) as (keyof Config)[];

/** Env var → config key. Values are strings; `coerce` turns them into the right type. */
const ENV_KEYS: Record<string, keyof Config> = {
  ORCHESTRA_MODE: "mode",
  ORCHESTRA_URL: "workerUrl",
  ORCHESTRA_TOKEN: "token",
  ORCHESTRA_LOCAL_DB: "localDbPath",
  ORCHESTRA_MASK_SALT: "maskSalt",
  ORCHESTRA_MASK_PATTERNS: "maskPatterns",
  ENGRAM_URL: "engramUrl",
  ORCHESTRA_ENGRAM_PROJECT: "engramProject",
  ORCHESTRA_CHECKPOINT_INTERVAL: "checkpointIntervalSec",
  ORCHESTRA_INBOX_POLL: "inboxPollSec",
  ORCHESTRA_AGENT_STALE_MINUTES: "agentStaleMinutes",
};

const NUMERIC = new Set<keyof Config>(["checkpointIntervalSec", "inboxPollSec", "agentStaleMinutes"]);

/** Converts a CLI/env string into the typed value for `key`. `maskPatterns` takes a JSON array. */
export function coerce(key: keyof Config, raw: string): unknown {
  if (NUMERIC.has(key)) return Number(raw);
  if (key === "maskPatterns") return JSON.parse(raw);
  return raw === "" ? null : raw;
}

export const configPath = (env: NodeJS.ProcessEnv, home: string): string =>
  env.ORCHESTRA_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "orchestra-man", "config.json");

const defaults = (home: string, env: NodeJS.ProcessEnv): Partial<Config> => ({
  workerUrl: null,
  token: null,
  localDbPath: join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "orchestra-man", "orchestra.db"),
  maskPatterns: [],
  engramUrl: "http://127.0.0.1:7437",
  engramProject: null,
  checkpointIntervalSec: 300,
  inboxPollSec: 30,
  agentStaleMinutes: 15,
});

/** Pure: merges the layers and validates. Throws a readable error naming what to fix. */
export function resolveConfig(file: Partial<Config>, env: NodeJS.ProcessEnv, home: string): Config {
  const fromEnv = Object.fromEntries(
    Object.entries(ENV_KEYS)
      .filter(([name]) => env[name] !== undefined)
      .map(([name, key]) => [key, coerce(key, env[name] as string)]),
  );
  const merged = { ...defaults(home, env), ...file, ...fromEnv } as Partial<Config>;
  merged.mode ??= merged.workerUrl && merged.token ? "d1" : "local";
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`orchestra-man is not configured correctly (${problems}). Run /orchestra-man:configure.`);
  }
  if (result.data.mode === "d1" && (!result.data.workerUrl || !result.data.token)) {
    throw new Error("orchestra-man mode is d1 but workerUrl or token is missing. Run /orchestra-man:configure.");
  }
  return result.data;
}

export function readConfigFile(path: string): Partial<Config> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Partial<Config>) : {};
}

export function loadConfig(env: NodeJS.ProcessEnv, home: string): Config {
  return resolveConfig(readConfigFile(configPath(env, home)), env, home);
}

export const newSalt = (): string => randomBytes(24).toString("hex");

/** Merges `patch` into the config file (creating it with a fresh salt) and keeps it private (0600). */
export function writeConfigFile(path: string, patch: Partial<Config>): Partial<Config> {
  const current = readConfigFile(path);
  const next = { maskSalt: newSalt(), ...current, ...patch };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return next;
}

/** A printable view: secrets are shortened so the output is safe in a transcript. */
export const redactConfig = (config: Partial<Config>): Record<string, unknown> => ({
  ...config,
  token: config.token ? `${config.token.slice(0, 6)}…` : null,
  maskSalt: config.maskSalt ? `${config.maskSalt.slice(0, 4)}…` : null,
});
