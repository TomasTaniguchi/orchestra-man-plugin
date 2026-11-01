import type { Remote } from "../../src/core/remote";
import { createMasker } from "../../src/masking/masker";
import { maskedRemote } from "../../src/masking/masked-remote";
import { type Config, resolveConfig } from "../../src/plugin/config";
import type { EngramClient, EngramObservation } from "../../src/plugin/engram";
import type { Exec } from "../../src/plugin/identity";
import type { Runtime } from "../../src/plugin/runtime";
import { manualClock, testService } from "./fixtures";

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

export const fakeEngram = (observations: EngramObservation[] | Error): EngramClient => ({
  recentObservations: async () => {
    if (observations instanceof Error) throw observations;
    return observations;
  },
});

/**
 * A Runtime wired like production (masked remote, real identity detection) but over
 * an injected backend, fake git and fake Engram. Pass `remote` to share a backend between agents.
 */
export function testRuntime(
  options: {
    repo?: string;
    machine?: string;
    codespace?: boolean;
    remote?: Remote;
    clock?: ReturnType<typeof manualClock>;
    observations?: EngramObservation[] | Error;
    git?: { branch?: string; sha?: string; status?: string };
    config?: Partial<Config>;
  } = {},
) {
  const local = testService();
  const repo = options.repo ?? "acme/api";
  const machine = options.machine ?? "laptop";
  const clock = options.clock ?? local.clock;
  const config = testConfig(options.config);
  const exec = fakeGit(repo, options.git);
  const mask = createMasker({ salt: config.maskSalt });
  const repoRoot = `/work/${repo.split("/")[1]}`;
  const rt: Runtime = {
    config,
    identity: {
      repoRoot,
      agent: {
        id: `${repo}#${machine}`,
        repo,
        machine,
        kind: options.codespace ? "codespace" : "local",
        codespaceName: options.codespace ? machine : null,
      },
    },
    remote: maskedRemote(options.remote ?? local.service, mask),
    engram: fakeEngram(options.observations ?? []),
    mask,
    project: repo.split("/")[1] ?? repo,
    exec,
    clock,
  };
  return { rt, service: local.service, clock };
}
