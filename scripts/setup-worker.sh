#!/usr/bin/env bash
# Interactive setup of your personal orchestra-man Worker (Cloudflare Workers + D1).
# Supported: macOS (bash 3.2+), Linux and Windows (Git Bash or WSL). Requires Node.js 22.13+.
# Guide: docs/guides/deploy-worker.md
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-worker.sh [--yes] [--help]

Creates and deploys your orchestra-man Worker step by step:
  1. checks Node and wrangler          5. applies the schema (migrations)
  2. logs in to Cloudflare              6. deploys the Worker
  3. asks for the names                 7. uploads ADMIN_TOKEN and, optionally, GITHUB_TOKEN
  4. creates or reuses the D1 database  8. issues a token for this machine and configures the plugin

Options:
  -y, --yes    Do not ask: use the defaults (and any OM_* variables that are set)
  -h, --help   Show this help

Any answer can be given as an environment variable:
  OM_WORKER_NAME, OM_DATABASE_NAME, OM_REUSE_DATABASE (y/n), OM_GENERATE_ADMIN_TOKEN (y/n),
  OM_ADMIN_TOKEN, OM_GITHUB_TOKEN, OM_WORKER_URL, OM_MACHINE_NAME, OM_CONFIGURE_PLUGIN (y/n),
  OM_LOCAL_CONFIG (default worker/wrangler.local.jsonc), WRANGLER (wrangler command to use).
EOF
}

case "${1:-}" in
  -h | --help) usage; exit 0 ;;
  -y | --yes) OM_ASSUME_YES=1 ;;
  "") ;;
  *) usage >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LIB="scripts/setup-worker-lib.mjs"
TEMPLATE="worker/wrangler.jsonc"
CONFIG="${OM_LOCAL_CONFIG:-worker/wrangler.local.jsonc}"
ASSUME_YES="${OM_ASSUME_YES:-0}"

if [ -t 1 ]; then
  BOLD=$'\033[1m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' RESET=$'\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

lib() { node "$LIB" "$@"; }

wrangler() {
  if [ -n "${WRANGLER:-}" ]; then
    # shellcheck disable=SC2086 # WRANGLER is a command line, e.g. "node /path/fake-wrangler.mjs"
    $WRANGLER "$@"
  else
    npx --no-install wrangler "$@"
  fi
}

# ask VAR "Question" [default]. A preset $VAR wins; --yes takes the default.
ask() {
  local var="$1" prompt="$2" default="${3:-}" value=""
  if [ -n "${!var:-}" ]; then
    info "$prompt: ${!var}"
    return
  fi
  if [ "$ASSUME_YES" = 1 ]; then
    value="$default"
  else
    read -r -p "    $prompt${default:+ [$default]}: " value || true
    value="${value:-$default}"
  fi
  printf -v "$var" '%s' "$value"
}

# ask_secret VAR "Question". Input is never echoed nor printed.
ask_secret() {
  local var="$1" prompt="$2" value=""
  if [ -n "${!var:-}" ]; then
    info "$prompt: (taken from \$$var)"
    return
  fi
  if [ "$ASSUME_YES" != 1 ]; then
    read -r -s -p "    $prompt: " value || true
    printf '\n'
  fi
  printf -v "$var" '%s' "$value"
}

# confirm VAR "Question" y|n. Returns 0 for yes (also accepts s/S, for answers given in Spanish).
confirm() {
  local var="$1" prompt="$2" default="$3" answer="" hint="y/N"
  [ "$default" = y ] && hint="Y/n"
  if [ -n "${!var:-}" ]; then
    answer="${!var}"
  elif [ "$ASSUME_YES" = 1 ]; then
    answer="$default"
  else
    read -r -p "    $prompt [$hint]: " answer || true
    answer="${answer:-$default}"
  fi
  case "$answer" in [sSyY]*) return 0 ;; *) return 1 ;; esac
}

detect_os() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Darwin) echo "macOS" ;;
    Linux) if grep -qi microsoft /proc/version 2>/dev/null; then echo "Windows (WSL)"; else echo "Linux"; fi ;;
    MINGW* | MSYS* | CYGWIN*) echo "Windows (Git Bash)" ;;
    *) uname -s ;;
  esac
}

printf '%sorchestra-man · set up your Worker%s\n' "$BOLD" "$RESET"
info "Creates the Worker with D1 in your Cloudflare account, issues a token for this machine"
info "and configures the plugin. You can stop at any time with Ctrl-C."

step "1/8 Requirements"
command -v node >/dev/null 2>&1 || die "Node.js 22.13 or later is required: https://nodejs.org"
lib node-version-ok || die "You have Node $(node -v); 22.13 or later is required."
ok "Node $(node -v) on $(detect_os)"
if [ -z "${WRANGLER:-}" ] && [ ! -d node_modules/wrangler ]; then
  info "Installing the repo dependencies (npm ci)…"
  npm ci --no-audit --no-fund >/dev/null || die "npm ci failed."
fi
ok "wrangler available"

step "2/8 Cloudflare account"
if ! wrangler whoami --json >/dev/null 2>&1; then
  info "No active session: opening the browser to authorize wrangler."
  wrangler login || die "Could not log in to Cloudflare."
  wrangler whoami --json >/dev/null 2>&1 || die "Still no Cloudflare session."
fi
ok "Cloudflare session active"

step "3/8 Names"
ask OM_WORKER_NAME "Worker name (part of the URL)" "orchestra-man"
lib valid-name "$OM_WORKER_NAME" || die "Invalid Worker name: lowercase letters, digits and dashes, up to 63."
ask OM_DATABASE_NAME "D1 database name" "$OM_WORKER_NAME"
lib valid-name "$OM_DATABASE_NAME" || die "Invalid database name: lowercase letters, digits and dashes, up to 63."

step "4/8 D1 database"
list_json="$(wrangler d1 list --json)" || die "Could not list the D1 databases."
database_id="$(printf '%s' "$list_json" | lib find-db "$OM_DATABASE_NAME")"
if [ -n "$database_id" ]; then
  confirm OM_REUSE_DATABASE "The database \"$OM_DATABASE_NAME\" already exists ($database_id). Use it?" y ||
    die "Choose another database name and run the script again."
  ok "Using the existing database $database_id"
else
  info "Creating the database \"$OM_DATABASE_NAME\"…"
  wrangler d1 create "$OM_DATABASE_NAME" >/dev/null || die "Could not create the database."
  database_id="$(wrangler d1 list --json | lib find-db "$OM_DATABASE_NAME")"
  [ -n "$database_id" ] || die "The database was created, but its id is not in 'wrangler d1 list'."
  ok "Database created: $database_id"
fi
lib write-config "$TEMPLATE" "$CONFIG" "$OM_WORKER_NAME" "$OM_DATABASE_NAME" "$database_id"
ok "Personal config in $CONFIG (ignored by git)"

step "5/8 Schema"
info "If wrangler asks for confirmation to apply migrations, answer yes."
wrangler d1 migrations apply DB --remote -c "$CONFIG" || die "Could not apply the migrations."
ok "Schema applied"

step "6/8 Deploy"
deploy_log="$(wrangler deploy -c "$CONFIG" 2>&1)" || {
  printf '%s\n' "$deploy_log" >&2
  die "The deploy failed."
}
worker_url="$(printf '%s' "$deploy_log" | lib extract-url)"
if [ -z "$worker_url" ]; then
  warn "No *.workers.dev URL found in the wrangler output."
  ask OM_WORKER_URL "Worker URL" ""
  worker_url="$OM_WORKER_URL"
fi
[ -n "$worker_url" ] || die "The Worker URL is needed to continue."
ok "Deployed at $worker_url"

step "7/8 Secrets"
admin_generated=0
if [ -z "${OM_ADMIN_TOKEN:-}" ] &&
  confirm OM_GENERATE_ADMIN_TOKEN "Generate a random ADMIN_TOKEN? (replaces the Worker's current one, if any)" y; then
  OM_ADMIN_TOKEN="$(lib random-hex)"
  admin_generated=1
else
  ask_secret OM_ADMIN_TOKEN "ADMIN_TOKEN (hidden)"
fi
[ "${#OM_ADMIN_TOKEN}" -ge 32 ] || die "ADMIN_TOKEN must be at least 32 characters long."
printf '%s' "$OM_ADMIN_TOKEN" | wrangler secret put ADMIN_TOKEN -c "$CONFIG" >/dev/null ||
  die "Could not upload ADMIN_TOKEN."
ok "ADMIN_TOKEN uploaded"

info "GITHUB_TOKEN is optional: a classic PAT with the 'codespace' scope enables orchestra_wake."
ask_secret OM_GITHUB_TOKEN "GITHUB_TOKEN (Enter to skip)"
if [ -n "$OM_GITHUB_TOKEN" ]; then
  printf '%s' "$OM_GITHUB_TOKEN" | wrangler secret put GITHUB_TOKEN -c "$CONFIG" >/dev/null ||
    die "Could not upload GITHUB_TOKEN."
  ok "GITHUB_TOKEN uploaded"
else
  info "No GITHUB_TOKEN: orchestra_wake will not be available (you can upload it later)."
fi

step "8/8 Token for this machine"
info "Waiting for the Worker to respond…"
lib health "$worker_url" >/dev/null || die "The Worker does not respond at $worker_url/v1/health."
ok "The Worker responds"
ask OM_MACHINE_NAME "Name to identify this machine" "$(hostname 2>/dev/null || echo machine)"
machine_token="$(printf '%s' "$OM_ADMIN_TOKEN" | lib create-token "$worker_url" "$OM_MACHINE_NAME")" ||
  die "Could not issue the machine token."
ok "Token issued for \"$OM_MACHINE_NAME\""

plugin_configured=0
if confirm OM_CONFIGURE_PLUGIN "Configure the plugin on this machine with this Worker?" y; then
  node plugin/dist/cli.mjs configure --set mode=d1 --set "workerUrl=$worker_url" >/dev/null ||
    die "Could not write the plugin configuration."
  printf '%s' "$machine_token" | node plugin/dist/cli.mjs configure --token-stdin >/dev/null ||
    die "Could not store the token in the plugin configuration."
  plugin_configured=1
  ok "Plugin configured (~/.config/orchestra-man/config.json, mode 0600)"
fi

printf '\n%sDone.%s Your Worker: %s\n' "$BOLD$GREEN" "$RESET" "$worker_url"
if [ "$admin_generated" = 1 ]; then
  printf '\n%sSave this ADMIN_TOKEN in your password manager; it is not shown again:%s\n    %s\n' \
    "$YELLOW" "$RESET" "$OM_ADMIN_TOKEN"
fi
if [ "$plugin_configured" = 0 ]; then
  printf '\nToken for machine "%s" (shown only once):\n    %s\n' "$OM_MACHINE_NAME" "$machine_token"
fi
cat <<EOF

Next steps:
  - Restart Claude Code: when the session opens you will see the "# orchestra-man" block.
  - Other machines: issue a token for each one and configure the plugin there
    (docs/guides/deploy-worker.md, "Issue more tokens", and docs/guides/install-plugin.md).
  - Use the same maskSalt on all your machines (see the install guide).
  - Update the Worker later: npm run worker:migrate:remote && npm run worker:deploy
EOF
