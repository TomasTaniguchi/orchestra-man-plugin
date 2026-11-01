import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVICE_VERSION } from "../../core/service";
import { createMcpServer } from "../mcp";
import { createRuntime, type Runtime } from "../runtime";

let runtime: Runtime | undefined;
const getRuntime = (): Runtime => (runtime ??= createRuntime());

await createMcpServer(getRuntime, SERVICE_VERSION).connect(new StdioServerTransport());
