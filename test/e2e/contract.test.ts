import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../../src/core/routes";

const SPEC = readFileSync(join(import.meta.dirname, "../../docs/api/openapi.yaml"), "utf8");

/**
 * Reads `METHOD path operationId` triples from the spec. The spec keeps a fixed layout
 * (paths at 2 spaces, methods at 4, operationId at 6), so a line scan is enough and avoids a YAML dependency.
 */
function specOperations(): string[] {
  const ops: string[] = [];
  let path = "";
  let method = "";
  for (const line of SPEC.split("\n")) {
    const p = /^ {2}(\/\S+):$/.exec(line);
    if (p) path = p[1] ?? "";
    const m = /^ {4}(get|post|put|delete|patch):$/.exec(line);
    if (m) method = (m[1] ?? "").toUpperCase();
    const o = /^ {6}operationId: (\w+)$/.exec(line);
    if (o) ops.push(`${method} ${path} ${o[1]}`);
  }
  return ops.sort();
}

describe("contract", () => {
  it("docs/api/openapi.yaml documents exactly the routes the Worker serves", () => {
    const routes = Object.entries(ROUTES)
      .map(([op, def]) => `${def.method} ${def.path} ${op}`)
      .sort();
    expect(specOperations()).toEqual(routes);
  });

  it("documents the success status of every route", () => {
    for (const [op, def] of Object.entries(ROUTES)) {
      const block = SPEC.slice(SPEC.indexOf(`operationId: ${op}\n`));
      expect(block.slice(0, block.indexOf("responses:") + 40), op).toContain(`"${def.status}"`);
    }
  });
});
