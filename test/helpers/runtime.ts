import type { Remote } from "../../src/core/remote";
import { createMasker } from "../../src/masking/masker";
import { maskedRemote } from "../../src/masking/masked-remote";
import { type SaveInput, MemoryStore } from "../../src/memory/store";
import { type Config, resolveConfig } from "../../src/plugin/config";
import type { Exec } from "../../src/plugin/identity";
import { openLocalDb, type Runtime, syncTargetOf } from "../../src/plugin/runtime";
import { manualClock, MIGRATIONS_DIR, testService } from "./fixtures";

export const TEST_SALT = "test-salt-0123456789";

export const testConfig = (overrides: Partial<Config> = {}): Config =>
  resolveConfig({ maskSalt: TEST_SALT, localDbPath: ":memory:", ...overrides }, {}, "/home/test");

/** A fake `git` that answers like a clone of `repo` on `branch`. */
export const fakeGit =
  (repo: string, git: { branch?: string; sha?: string; status?: string } = {}): Exec =>
  (_cmd, args) =>
    ({
      "rev-parse --show-toplevel": `/work/${repo.split("/")[1]}`,
      "remote get-url origin": `git@github.com:${repo}.git`,
      "rev-parse --abbrev-ref HEAD": git.branch ?? "main",
      "rev-parse HEAD": git.sha ?? "0123456789abcdef0123456789abcdef01234567",
      "status --porcelain": git.status ?? "",
    })[args.join(" ")] ?? null;

export type Memory = Omit<SaveInput, "project">;

/**
 * A Runtime wired like production (masked remote, local memory store) over an injected backend,
 * fake git and a manual clock. Each call is one machine with its own local memory.
 * Pass `remote` to share a backend between agents.
 */
export function testRuntime(
  options: {
    repo?: string;
    machine?: string;
    codespace?: boolean;
    remote?: Remote;
    clock?: ReturnType<typeof manualClock>;
    memories?: Memory[];
    git?: { branch?: string; sha?: string; status?: string };
    config?: Partial<Config>;
  } = {},
) {
  const local = testService();
  const repo = options.repo ?? "acme/api";
  const machine = options.machine ?? "laptop";
  const clock = options.clock ?? local.clock;
  const config = testConfig(options.config);
  const mask = createMasker({ salt: config.maskSalt });
  let syncIds = 0;
  const store = new MemoryStore(openLocalDb(":memory:", MIGRATIONS_DIR, clock), clock, () => `${repo}:obs-${++syncIds}`);
  for (const memory of options.memories ?? []) store.save({ project: repo, ...memory });
  const rt: Runtime = {
    config,
    identity: {
      repoRoot: `/work/${repo.split("/")[1]}`,
      agent: {
        id: `${repo}#${machine}`,
        repo,
        machine,
        kind: options.codespace ? "codespace" : "local",
        codespaceName: options.codespace ? machine : null,
      },
    },
    remote: maskedRemote(options.remote ?? local.service, mask),
    store,
    syncTarget: syncTargetOf(config),
    mask,
    exec: fakeGit(repo, options.git),
    clock,
  };
  return { rt, service: local.service, clock, store };
}
