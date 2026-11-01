/**
 * Redaction rules applied before anything leaves the machine. Order matters:
 * structured secrets first, then personal data, then identifiers.
 * shortcut: regex rules miss free-form PII (names, addresses, card numbers); add an NER pass if policy requires it.
 */
export interface MaskRule {
  name: string;
  pattern: RegExp;
}

const rule = (name: string, pattern: RegExp): MaskRule => ({ name, pattern });

export const DEFAULT_RULES: readonly MaskRule[] = [
  rule("private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g),
  rule("jwt", /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g),
  rule("url_credentials", /(?<=\b[a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+(?=@)/gi),
  rule("bearer", /(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g),
  rule(
    "secret_assignment",
    /(?<=\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|token)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
  ),
  rule("github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g),
  rule("aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g),
  rule(
    "api_key",
    /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|om_[a-f0-9]{64})\b/g,
  ),
  rule("email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g),
  // International numbers need a leading +; local ones need an area code in parentheses.
  // Bare digit runs are left alone: they are usually ids, ports or timestamps.
  rule("phone", /(?<![\w+])\+\d{1,3}(?:[\s.-]?(?:\(\d{1,4}\)|\d{1,4})){2,5}(?!\w)/g),
  rule("phone", /(?<!\w)\(\d{2,4}\)\s?\d{3,4}[\s-]?\d{4}(?!\w)/g),
  rule("uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi),
  // Numeric ids assigned to an id-like key: user_id=8812345, "customerId": 123456.
  rule("id", /(?<=\b(?:\w+_id|\w+Id|id|ID)["']?\s*[:=]\s*["']?)\d{4,}\b/g),
];

/** Compiles user-provided regex sources into rules named `custom`. Throws on an invalid pattern. */
export function customRules(sources: readonly string[]): MaskRule[] {
  return sources
    .map((source) => source.trim())
    .filter(Boolean)
    .map((source) => {
      try {
        return rule("custom", new RegExp(source, "g"));
      } catch (error) {
        throw new Error(`invalid mask pattern ${JSON.stringify(source)}: ${(error as Error).message}`);
      }
    });
}
