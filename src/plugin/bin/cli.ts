import { text } from "node:stream/consumers";
import { runCli } from "../cli";

const code = await runCli(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readStdin: () => text(process.stdin),
}).catch((error: Error) => {
  console.error(`orchestra-man: ${error.message}`);
  return 1;
});
process.exitCode = code;
