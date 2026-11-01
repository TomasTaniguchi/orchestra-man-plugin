import { createHmac } from "node:crypto";
import { DEFAULT_RULES, type MaskRule } from "./rules";

export type Mask = (text: string) => string;

export interface MaskerOptions {
  /** Local secret. The same value always maps to the same placeholder, but cannot be reversed without it. */
  salt: string;
  rules?: readonly MaskRule[];
}

const placeholder = (salt: string, rule: string, value: string): string =>
  `<${rule}:${createHmac("sha256", salt).update(value).digest("hex").slice(0, 8)}>`;

export function createMasker({ salt, rules = DEFAULT_RULES }: MaskerOptions): Mask {
  if (!salt) throw new Error("mask salt must not be empty");
  return (text) => rules.reduce((out, r) => out.replace(r.pattern, (match) => placeholder(salt, r.name, match)), text);
}

/** Masks every string inside a JSON-like value, keeping its shape. Object keys are left as they are. */
export function maskDeep<T>(value: T, mask: Mask): T {
  if (typeof value === "string") return mask(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, mask)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, mask)])) as T;
  }
  return value;
}
