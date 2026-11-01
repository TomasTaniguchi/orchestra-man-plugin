import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Clock, type Ids, iso, randomIds, systemClock } from "../core/clock";
import { applyMigrations, loadMigrations } from "../core/migrations";
import { openNodeSqlite } from "../core/node-sqlite";
import type { Remote } from "../core/remote";
import { OrchestraService } from "../core/service";
import { createMasker, type Mask } from "../masking/masker";
import { maskedRemote } from "../masking/masked-remote";
import { customRules, DEFAULT_RULES } from "../masking/rules";
import { type Config, loadConfig } from "./config";
import { type EngramClient, engramClient } from "./engram";
import { httpRemote } from "./http-remote";
import { detectIdentity, type Exec, type Identity, systemExec } from "./identity";

/** In the bundle, migrations are copied next to dist/*.js by scripts/build-plugin.mjs. */
export const BUNDLED_MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export interface Runtime {
  config: Config;
  identity: Identity;
  /** Always masked: plugin code never sees an unmasked Remote. */
  remote: Remote;
  engram: EngramClient;
  mask: Mask;
  project: string;
  exec: Exec;
  clock: Clock;
}

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  config?: Config;
  fetch?: typeof fetch;
  exec?: Exec;
  clock?: Clock;
  ids?: Ids;
  migrationsDir?: string;
}

export function localService(path: string, migrationsDir: string, clock: Clock, ids: Ids): OrchestraService {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = openNodeSqlite(path);
  applyMigrations(db, loadMigrations(migrationsDir), iso(clock.now()));
  return new OrchestraService({ db, clock, ids });
}

export function buildRemote(config: Config, options: Required<Pick<RuntimeOptions, "fetch" | "clock" | "ids" | "migrationsDir">>): Remote {
  if (config.mode === "d1") {
    return httpRemote({ baseUrl: config.workerUrl as string, token: config.token as string, fetch: options.fetch });
  }
  return localService(config.localDbPath, options.migrationsDir, options.clock, options.ids);
}

/** Composition root: the only place that knows about concrete implementations. */
export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const env = options.env ?? process.env;
  const fetchFn = options.fetch ?? fetch;
  const exec = options.exec ?? systemExec;
  const clock = options.clock ?? systemClock;
  const config = options.config ?? loadConfig(env, options.home ?? homedir());
  const identity = detectIdentity(options.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd(), env, exec);
  const mask = createMasker({ salt: config.maskSalt, rules: [...DEFAULT_RULES, ...customRules(config.maskPatterns)] });
  const raw = buildRemote(config, {
    fetch: fetchFn,
    clock,
    ids: options.ids ?? randomIds,
    migrationsDir: options.migrationsDir ?? BUNDLED_MIGRATIONS,
  });
  return {
    config,
    identity,
    remote: maskedRemote(raw, mask),
    engram: engramClient(config.engramUrl, fetchFn),
    mask,
    // Engram names a project after the repository directory by default.
    project: config.engramProject ?? identity.agent.repo.split("/")[1] ?? identity.agent.repo,
    exec,
    clock,
  };
}
