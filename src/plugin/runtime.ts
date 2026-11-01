import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Clock, type Ids, iso, randomIds, systemClock } from "../core/clock";
import { applyMigrations, loadMigrations } from "../core/migrations";
import { type NodeSqliteDatabase, openNodeSqlite } from "../core/node-sqlite";
import type { Remote } from "../core/remote";
import { OrchestraService } from "../core/service";
import { createMasker, type Mask } from "../masking/masker";
import { maskedRemote } from "../masking/masked-remote";
import { customRules, DEFAULT_RULES } from "../masking/rules";
import { MEMORY_MIGRATIONS } from "../memory/schema";
import { MemoryStore } from "../memory/store";
import { type Config, loadConfig } from "./config";
import { httpRemote } from "./http-remote";
import { detectIdentity, type Exec, type Identity, systemExec } from "./identity";

/** In the bundle, migrations are copied next to dist/*.mjs by scripts/build-plugin.mjs. */
export const BUNDLED_MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export interface Runtime {
  config: Config;
  identity: Identity;
  /** Always masked: plugin code never sees an unmasked Remote. */
  remote: Remote;
  /** This machine's memory of this repository (never leaves the machine unmasked). */
  store: MemoryStore;
  /** Identifies the backend for the incremental sync cursor. */
  syncTarget: string;
  mask: Mask;
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

/** The local SQLite file: memory store always, plus the shared tables used by local mode. */
export function openLocalDb(path: string, migrationsDir: string, clock: Clock): NodeSqliteDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = openNodeSqlite(path);
  applyMigrations(db, [...loadMigrations(migrationsDir), ...MEMORY_MIGRATIONS], iso(clock.now()));
  return db;
}

export function buildRemote(config: Config, db: NodeSqliteDatabase, deps: { fetch: typeof fetch; clock: Clock; ids: Ids }): Remote {
  if (config.mode === "d1") {
    return httpRemote({ baseUrl: config.workerUrl as string, token: config.token as string, fetch: deps.fetch });
  }
  return new OrchestraService({ db, clock: deps.clock, ids: deps.ids });
}

export const syncTargetOf = (config: Config): string =>
  config.mode === "d1" ? `d1:${config.workerUrl}` : `local:${config.localDbPath}`;

/** Composition root: the only place that knows about concrete implementations. */
export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const env = options.env ?? process.env;
  const clock = options.clock ?? systemClock;
  const exec = options.exec ?? systemExec;
  const config = options.config ?? loadConfig(env, options.home ?? homedir());
  const identity = detectIdentity(options.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd(), env, exec);
  const mask = createMasker({ salt: config.maskSalt, rules: [...DEFAULT_RULES, ...customRules(config.maskPatterns)] });
  const db = openLocalDb(config.localDbPath, options.migrationsDir ?? BUNDLED_MIGRATIONS, clock);
  const raw = buildRemote(config, db, { fetch: options.fetch ?? fetch, clock, ids: options.ids ?? randomIds });
  return {
    config,
    identity,
    remote: maskedRemote(raw, mask),
    store: new MemoryStore(db, clock),
    syncTarget: syncTargetOf(config),
    mask,
    exec,
    clock,
  };
}
