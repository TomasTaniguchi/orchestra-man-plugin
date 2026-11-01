// A stand-in for `wrangler`, used by test/e2e/setup-worker.e2e.test.ts through the WRANGLER env var.
// It records every call and keeps databases and secrets in the JSON file at $FAKE_WRANGLER_STATE.
import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.FAKE_WRANGLER_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const args = process.argv.slice(2);
const command = args.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
const flag = (name) => args[args.indexOf(name) + 1];

async function stdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

state.calls.push(args.join(" "));
save();

switch (true) {
  case command === "whoami":
    process.exit(state.loggedIn ? 0 : 1);
  case command === "login":
    state.loggedIn = true;
    break;
  case command === "d1 list":
    console.log(JSON.stringify(state.databases));
    break;
  case command === "d1 create": {
    const name = args[2];
    const n = String(state.databases.length + 1).padStart(12, "0");
    state.databases.push({ uuid: `00000000-0000-4000-8000-${n}`, name, version: "production" });
    console.log(`✅ Successfully created DB '${name}'`);
    break;
  }
  case command === "d1 migrations": {
    state.migrations.push({ database: args[3], remote: args.includes("--remote"), config: flag("-c") });
    console.log("🚣 14 commands executed successfully.");
    break;
  }
  case command.startsWith("deploy"):
    state.deploys.push({ config: flag("-c") });
    // No *.workers.dev URL on purpose: exercises the script's "paste the URL" fallback.
    console.log("Uploaded orchestra-test\nDeployed orchestra-test triggers\n  schedule: 17 3 * * *");
    break;
  case command === "secret put": {
    state.secrets[args[2]] = await stdin();
    console.log(`✨ Success! Uploaded secret ${args[2]}`);
    break;
  }
  default:
    console.error(`fake-wrangler: unsupported command: ${args.join(" ")}`);
    process.exit(2);
}
save();
