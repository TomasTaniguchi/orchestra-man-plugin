# Masking

Code: `src/masking/`. It runs on the client, **before** any network request, through the `maskedRemote` decorator, which `createRuntime` always applies.

## What gets masked

Free-text fields: memory title and content, checkpoint summary, message body, task title, and every string inside a task's state. Identifiers (repo, agent, task and message ids) are **not** masked, because they are used for routing.

## Default rules

In order of application (`DEFAULT_RULES` in `src/masking/rules.ts`):

| Rule | Example | Result |
| --- | --- | --- |
| `private_key` | `-----BEGIN RSA PRIVATE KEY----- …` | `<private_key:…>` |
| `jwt` | `eyJhbGciOi….eyJzdWIi….dozj…` | `<jwt:…>` |
| `url_credentials` | `https://admin:hunter2@db:5432` | `https://<url_credentials:…>@db:5432` |
| `bearer` | `Bearer abcdefghijklmnop1234` | `Bearer <bearer:…>` |
| `secret_assignment` | `password: "S3cr3t"`, `api_key=…`, `token=…` | `password: "<secret_assignment:…>"` |
| `github_token` | `ghp_…`, `github_pat_…` | `<github_token:…>` |
| `aws_access_key` | `AKIAIOSFODNN7EXAMPLE` | `<aws_access_key:…>` |
| `api_key` | `sk_live_…`, `sk-…`, `xoxb-…`, `om_…` tokens | `<api_key:…>` |
| `email` | `jane.doe@acme.com` | `<email:…>` |
| `phone` | `+54 9 11 4567-8901`, `(011) 4567-8901` | `<phone:…>` |
| `uuid` | `3f2c8a10-5b7e-…` | `<uuid:…>` |
| `id` | `user_id=8812345`, `"customerId": 123456` | `user_id=<id:…>` |

The snapshot in `src/masking/masking.test.ts` shows the exact result on a sample text, and another test guarantees that versions, dates, ports, git SHAs and code are **not** touched.

## Placeholders

`<rule:hash>`, where `hash` is the first 8 hex characters of `HMAC-SHA256(salt, value)`.

- **Deterministic**: the same value always yields the same placeholder, so agents can say "customer `<email:bab800ec>` appears in the incident and in the invoice".
- **Not reversible without the salt**: an HMAC with a secret salt prevents dictionary attacks on emails or phone numbers.
- **Same salt on every machine**: otherwise the same value yields different placeholders in each repo.

## Custom rules

```bash
cli.mjs configure --set 'maskPatterns=["CUST-\\d{6}", "\\bAR\\d{11}\\b"]'
```

Or the `ORCHESTRA_MASK_PATTERNS` variable with the same JSON array. They run after the default rules and produce `<custom:…>`. An invalid pattern makes configuration loading fail with a message that names it.

## Known limits

`shortcut`: masking is based on regular expressions.

- **Not detected**: people's names, postal addresses, ID numbers without context, credit cards, or sensitive data in free text without a recognizable format.
- **Phone numbers**: only international ones with `+` or local ones with an area code in parentheses. Loose digit sequences are left alone because they are usually ids, ports or timestamps.
- **Numeric IDs**: only when assigned to an id-shaped key (`*_id`, `*Id`, `id`, `ID`) and 4 or more digits long.

If your company's data policy requires more, the next step is to add an entity detector (NER) in `createMasker`. The `Mask` interface (`(text) => text`) does not change.
