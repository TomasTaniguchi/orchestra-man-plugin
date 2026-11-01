import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { runCheckpoint, sessionContext, watch } from "./commands";
import { type Config, CONFIG_KEYS, coerce, configPath, readConfigFile, redactConfig, writeConfigFile } from "./config";
import { createRuntime, type Runtime, type RuntimeOptions } from "./runtime";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  readStdin: () => Promise<string>;
}

export const USAGE = `orchestra-man <command>

  session-start            Register, sync, checkpoint and print context (SessionStart hook)
  session-end              Final sync and checkpoint (SessionEnd hook)
  watch                    Monitor loop: inbox notifications and periodic checkpoints
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
  const runtime = (): Runtime => createRuntime(options);
  switch (command) {
    case "session-start":
      return hookSafe(io, async () => io.out(await sessionContext(runtime())));
    case "session-end":
      return hookSafe(io, async () => void (await runCheckpoint(runtime())));
    case "watch":
      return hookSafe(io, () => watch(runtime(), { print: io.out, sleep: (ms) => sleep(ms) }));
    case "sync": {
      const result = await runCheckpoint(runtime());
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    case "status": {
      const rt = runtime();
      io.out(JSON.stringify({ agent: rt.identity.agent, project: rt.project, config: redactConfig(rt.config) }, null, 2));
      return 0;
    }
    case "configure":
      return configure(rest, env, io);
    default:
      io.out(USAGE);
      return command === undefined || command === "help" ? 0 : 1;
  }
}
