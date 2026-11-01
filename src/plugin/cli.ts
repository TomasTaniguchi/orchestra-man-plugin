import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { type HookInput, parseHookInput, postCompact, runCheckpoint, sessionEnd, sessionStart, subagentStop, watch } from "./commands";
import { type Config, CONFIG_KEYS, coerce, configPath, readConfigFile, redactConfig, writeConfigFile } from "./config";
import { configErrorReport, diagnose, formatReport, hasErrors } from "./doctor";
import { createRuntime, type Runtime, type RuntimeOptions } from "./runtime";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  readStdin: () => Promise<string>;
}

export const USAGE = `orchestra-man <command>

  session-start            Open the session, sync, checkpoint and print context (SessionStart hook)
  post-compact             Print recovery steps and memory after a compaction (SessionStart "compact")
  session-end              Close the session, final sync and checkpoint (SessionEnd hook)
  subagent-stop            Save "Key Learnings" from a subagent's output (SubagentStop hook)
  watch                    Monitor loop: inbox notifications and periodic checkpoints
  doctor                   Diagnose configuration, backend, memory and other repos (what /orchestra-man:help shows)
  sync                     Sync and checkpoint now, print the result
  status                   Print the effective configuration (secrets shortened)
  configure [options]      Edit ~/.config/orchestra-man/config.json (0600)
    --set key=value        Set a key (repeatable). Keys: ${CONFIG_KEYS.join(", ")}
    --token-stdin          Read the Worker token from stdin (keeps it out of history)
    --show                 Print the file (secrets shortened)`;

/** Hooks must never break a session: they explain the problem in one line and exit 0. */
async function hookSafe(io: CliIo, run: () => Promise<void>): Promise<number> {
  try {
    await run();
  } catch (error) {
    io.out(`orchestra-man: ${(error as Error).message}`);
  }
  return 0;
}

function configure(args: string[], env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { set: { type: "string", multiple: true }, "token-stdin": { type: "boolean" }, show: { type: "boolean" } },
  });
  const path = configPath(env, homedir());
  return (async () => {
    const patch: Partial<Record<keyof Config, unknown>> = {};
    for (const pair of values.set ?? []) {
      const [key, ...rest] = pair.split("=");
      if (!CONFIG_KEYS.includes(key as keyof Config)) throw new Error(`unknown key "${key}". Keys: ${CONFIG_KEYS.join(", ")}`);
      if (key === "token") throw new Error("use --token-stdin for the token so it never appears in shell history");
      patch[key as keyof Config] = coerce(key as keyof Config, rest.join("="));
    }
    if (values["token-stdin"]) {
      const token = (await io.readStdin()).trim();
      if (!token) throw new Error("no token received on stdin");
      patch.token = token;
    }
    const written = Object.keys(patch).length || !values.show ? writeConfigFile(path, patch as Partial<Config>) : readConfigFile(path);
    io.out(`${path}\n${JSON.stringify(redactConfig(written), null, 2)}`);
    return 0;
  })().catch((error: Error) => {
    io.err(`orchestra-man configure: ${error.message}`);
    return 1;
  });
}

/** Entry point shared by the bundled bin and the tests. Returns the exit code. */
export async function runCli(argv: string[], io: CliIo, options: RuntimeOptions = {}): Promise<number> {
  const [command, ...rest] = argv;
  const env = options.env ?? process.env;
  const runtime = (cwd?: string): Runtime => createRuntime(cwd ? { ...options, cwd } : options);
  /** Hooks receive Claude Code's event JSON on stdin; its cwd is the most reliable project dir. */
  const hook = (run: (rt: Runtime, input: HookInput) => Promise<void>) =>
    hookSafe(io, async () => {
      const input = parseHookInput(await io.readStdin());
      await run(runtime(input.cwd), input);
    });
  switch (command) {
    case "session-start":
      return hook(async (rt, input) => io.out(await sessionStart(rt, input)));
    case "post-compact":
      return hook(async (rt, input) => io.out(await postCompact(rt, input)));
    case "session-end":
      return hook(async (rt, input) => sessionEnd(rt, input));
    case "subagent-stop":
      return hook(async (rt, input) => void subagentStop(rt, input));
    case "watch":
      return hookSafe(io, () => watch(runtime(), { print: io.out, sleep: (ms) => sleep(ms) }));
    case "sync": {
      const result = await runCheckpoint(runtime());
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    case "doctor": {
      // Read-only. Never fails on bad configuration: that is exactly what it has to explain.
      let rt: Runtime | undefined;
      try {
        rt = runtime();
      } catch (error) {
        io.out(formatReport(configErrorReport(error, configPath(env, options.home ?? homedir()), new Date())));
        return 1;
      }
      const report = await diagnose(rt);
      io.out(formatReport(report));
      return hasErrors(report) ? 1 : 0;
    }
    case "status": {
      const rt = runtime();
      io.out(JSON.stringify({ agent: rt.identity.agent, syncTarget: rt.syncTarget, config: redactConfig(rt.config) }, null, 2));
      return 0;
    }
    case "configure":
      return configure(rest, env, io);
    default:
      io.out(USAGE);
      return command === undefined || command === "help" ? 0 : 1;
  }
}
