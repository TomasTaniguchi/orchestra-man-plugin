import { describe, expect, it } from "vitest";
import { agentA, testService } from "../../test/helpers/fixtures";
import { createMasker, maskDeep } from "./masker";
import { maskedRemote } from "./masked-remote";
import { customRules, DEFAULT_RULES } from "./rules";

const mask = createMasker({ salt: "test-salt" });

const SENSITIVE = `
Customer jane.doe@acme.com (+54 9 11 4567-8901) reported a failed charge.
Support line (011) 4567-8901, US +1 415 555 0132.
Order id 3f2c8a10-5b7e-4c1d-9a2b-0c7d8e9f1a2b, user_id=8812345.
curl -H "Authorization: Bearer abcdefghijklmnop1234567890" https://admin:hunter2pass@db.internal:5432/app
export STRIPE_KEY=sk_live_51HxYzAbCdEfGhIjKl
password: "S3cr3tP@ss!"
GITHUB_TOKEN ghp_abcdefghijklmnopqrstuvwxyz0123456789
AWS AKIAIOSFODNN7EXAMPLE
jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA
-----END RSA PRIVATE KEY-----
`;

const HARMLESS = `
Deployed v2.14.3 on 2026-10-31 at 12:00:00Z, commit 8690028a1b2c3d4e5f60718293a4b5c6d7e8f901.
Service listens on port 8080 and retries 3 times with 250ms backoff; batch size 50, unix 1793448000000.
Function getInvoiceById(id: number) lives in src/billing/invoices.ts:42.
`;

describe("default rules", () => {
  it("redacts secrets and personal data (snapshot)", () => {
    expect(mask(SENSITIVE)).toMatchSnapshot();
  });

  it("leaves versions, dates, ports, SHAs and code untouched", () => {
    expect(mask(HARMLESS)).toBe(HARMLESS);
  });

  it("is deterministic per salt, so placeholders correlate across memories", () => {
    expect(mask("mail jane@acme.com")).toBe(mask("again jane@acme.com").replace("again", "mail"));
    expect(createMasker({ salt: "other" })("jane@acme.com")).not.toBe(mask("jane@acme.com"));
  });

  it("refuses an empty salt", () => {
    expect(() => createMasker({ salt: "" })).toThrow(/salt/);
  });
});

describe("custom rules", () => {
  it("adds user patterns and reports invalid ones", () => {
    const withCustom = createMasker({ salt: "s", rules: [...DEFAULT_RULES, ...customRules(["CUST-\\d{6}", " "])] });
    expect(withCustom("ticket CUST-123456")).toMatch(/^ticket <custom:[0-9a-f]{8}>$/);
    expect(() => customRules(["("])).toThrow(/invalid mask pattern/);
  });
});

describe("maskDeep", () => {
  it("masks strings at any depth and keeps the shape", () => {
    const state = { phase: "plan", notes: ["ping jane@acme.com"], nested: { n: 1, ok: true, empty: null } };
    expect(maskDeep(state, mask)).toEqual({
      phase: "plan",
      notes: [expect.stringMatching(/^ping <email:[0-9a-f]{8}>$/)],
      nested: { n: 1, ok: true, empty: null },
    });
  });
});

describe("maskedRemote", () => {
  it("masks free text before it reaches the backend and keeps identifiers", async () => {
    const { service } = testService();
    const remote = maskedRemote(service, mask);
    await remote.registerAgent(agentA);
    await remote.upsertMemories({
      agentId: agentA.id,
      repo: agentA.repo,
      items: [
        {
          sourceId: "obs-1",
          type: "bugfix",
          title: "Email jane@acme.com bounced",
          content: "Customer jane@acme.com",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    const message = await remote.sendMessage({
      fromAgent: agentA.id,
      fromRepo: agentA.repo,
      toRepo: "acme/billing",
      kind: "note",
      body: "call +54 9 11 4567-8901",
    });
    const task = await remote.createTask({ agentId: agentA.id, title: "fix jane@acme.com", repos: [agentA.repo], state: { goal: "jane@acme.com" } });
    const [hit] = await remote.searchMemories({ q: "bounced" });

    expect(hit?.title).toMatch(/^Email <email:[0-9a-f]{8}> bounced$/);
    expect(message.body).toMatch(/^call <phone:[0-9a-f]{8}>$/);
    expect(message.toRepo).toBe("acme/billing");
    expect(JSON.stringify(task)).not.toContain("jane@acme.com");
    expect(await remote.listAgents()).toHaveLength(1);
  });
});
