import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { basename } from "node:path";
import type { AgentRegistration } from "../core/contract";

/** Runs a command and returns trimmed stdout, or null when it fails. Injected for tests. */
export type Exec = (command: string, args: string[], cwd: string) => string | null;

export const systemExec: Exec = (command, args, cwd) => {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

export interface Identity {
  agent: Required<AgentRegistration>;
  repoRoot: string;
}

export interface GitState {
  branch: string;
  commitSha: string;
  changedFiles: string[];
}

/** `git@github.com:acme/api.git` and `https://github.com/acme/api` both become `acme/api`. */
export function repoFromRemote(url: string | null): string | null {
  const match = url?.match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function detectIdentity(cwd: string, env: NodeJS.ProcessEnv, exec: Exec = systemExec): Identity {
  const repoRoot = exec("git", ["rev-parse", "--show-toplevel"], cwd) ?? cwd;
  const repo =
    repoFromRemote(exec("git", ["remote", "get-url", "origin"], repoRoot)) ??
    `local/${basename(repoRoot).replace(/[^\w.-]/g, "-")}`;
  const inCodespace = env.CODESPACES === "true" && Boolean(env.CODESPACE_NAME);
  const machine = (inCodespace ? env.CODESPACE_NAME : undefined) ?? hostname();
  return {
    repoRoot,
    agent: {
      id: `${repo}#${machine}`,
      repo,
      machine,
      kind: inCodespace ? "codespace" : "local",
      codespaceName: inCodespace ? (env.CODESPACE_NAME ?? null) : null,
    },
  };
}

export function readGitState(repoRoot: string, exec: Exec = systemExec): GitState {
  const status = exec("git", ["status", "--porcelain"], repoRoot) ?? "";
  return {
    branch: exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot) ?? "unknown",
    commitSha: exec("git", ["rev-parse", "HEAD"], repoRoot) ?? "unknown",
    changedFiles: status
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .slice(0, 50),
  };
}
