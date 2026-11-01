#!/usr/bin/env bash
# Interactive setup of your personal orchestra-man Worker (Cloudflare Workers + D1).
# Supported: macOS (bash 3.2+), Linux and Windows (Git Bash or WSL). Requires Node.js 22.13+.
# Guide: docs/guides/deploy-worker.md
set -euo pipefail

usage() {
  cat <<'EOF'
Uso: scripts/setup-worker.sh [--yes] [--help]

Crea y despliega tu Worker de orchestra-man paso a paso:
  1. verifica Node y wrangler        5. aplica el esquema (migraciones)
  2. inicia sesión en Cloudflare     6. despliega el Worker
  3. pide los nombres                7. carga ADMIN_TOKEN y, opcional, GITHUB_TOKEN
  4. crea o reutiliza la base D1     8. emite un token para esta máquina y configura el plugin

Opciones:
  -y, --yes    No pregunta: usa los valores por defecto (y las variables OM_* definidas)
  -h, --help   Muestra esta ayuda

Cualquier respuesta se puede dar por variable de entorno:
  OM_WORKER_NAME, OM_DATABASE_NAME, OM_REUSE_DATABASE (s/n), OM_GENERATE_ADMIN_TOKEN (s/n),
  OM_ADMIN_TOKEN, OM_GITHUB_TOKEN, OM_WORKER_URL, OM_MACHINE_NAME, OM_CONFIGURE_PLUGIN (s/n),
  OM_LOCAL_CONFIG (por defecto worker/wrangler.local.jsonc), WRANGLER (comando wrangler a usar).
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

# ask VAR "Pregunta" [default]. A preset $VAR wins; --yes takes the default.
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

# ask_secret VAR "Pregunta". Input is never echoed nor printed.
ask_secret() {
  local var="$1" prompt="$2" value=""
  if [ -n "${!var:-}" ]; then
    info "$prompt: (tomado de \$$var)"
    return
  fi
  if [ "$ASSUME_YES" != 1 ]; then
    read -r -s -p "    $prompt: " value || true
    printf '\n'
  fi
  printf -v "$var" '%s' "$value"
}

# confirm VAR "Pregunta" s|n. Returns 0 for yes.
confirm() {
  local var="$1" prompt="$2" default="$3" answer="" hint="s/N"
  [ "$default" = s ] && hint="S/n"
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

printf '%sorchestra-man · configuración de tu Worker%s\n' "$BOLD" "$RESET"
info "Crea el Worker con D1 en tu cuenta de Cloudflare, emite un token para esta máquina"
info "y configura el plugin. Podés cortar con Ctrl-C en cualquier momento."

step "1/8 Requisitos"
command -v node >/dev/null 2>&1 || die "Necesitás Node.js 22.13 o superior: https://nodejs.org"
lib node-version-ok || die "Tenés Node $(node -v); necesitás 22.13 o superior."
ok "Node $(node -v) en $(detect_os)"
if [ -z "${WRANGLER:-}" ] && [ ! -d node_modules/wrangler ]; then
  info "Instalando dependencias del repo (npm ci)…"
  npm ci --no-audit --no-fund >/dev/null || die "Falló npm ci."
fi
ok "wrangler disponible"

step "2/8 Cuenta de Cloudflare"
if ! wrangler whoami --json >/dev/null 2>&1; then
  info "No hay una sesión iniciada: se abre el navegador para autorizar a wrangler."
  wrangler login || die "No se pudo iniciar sesión en Cloudflare."
  wrangler whoami --json >/dev/null 2>&1 || die "Sigue sin haber sesión en Cloudflare."
fi
ok "Sesión de Cloudflare activa"

step "3/8 Nombres"
ask OM_WORKER_NAME "Nombre del Worker (forma la URL)" "orchestra-man"
lib valid-name "$OM_WORKER_NAME" || die "Nombre de Worker inválido: minúsculas, números y guiones, hasta 63."
ask OM_DATABASE_NAME "Nombre de la base D1" "$OM_WORKER_NAME"
lib valid-name "$OM_DATABASE_NAME" || die "Nombre de base inválido: minúsculas, números y guiones, hasta 63."

step "4/8 Base D1"
list_json="$(wrangler d1 list --json)" || die "No se pudieron listar las bases D1."
database_id="$(printf '%s' "$list_json" | lib find-db "$OM_DATABASE_NAME")"
if [ -n "$database_id" ]; then
  confirm OM_REUSE_DATABASE "Ya existe la base \"$OM_DATABASE_NAME\" ($database_id). ¿La uso?" s ||
    die "Elegí otro nombre de base y volvé a correr el script."
  ok "Uso la base existente $database_id"
else
  info "Creando la base \"$OM_DATABASE_NAME\"…"
  wrangler d1 create "$OM_DATABASE_NAME" >/dev/null || die "No se pudo crear la base."
  database_id="$(wrangler d1 list --json | lib find-db "$OM_DATABASE_NAME")"
  [ -n "$database_id" ] || die "La base se creó, pero no encuentro su id en 'wrangler d1 list'."
  ok "Base creada: $database_id"
fi
lib write-config "$TEMPLATE" "$CONFIG" "$OM_WORKER_NAME" "$OM_DATABASE_NAME" "$database_id"
ok "Configuración personal en $CONFIG (ignorada por git)"

step "5/8 Esquema"
info "Si wrangler pide confirmación para aplicar migraciones, respondé que sí."
wrangler d1 migrations apply DB --remote -c "$CONFIG" || die "No se pudieron aplicar las migraciones."
ok "Esquema aplicado"

step "6/8 Despliegue"
deploy_log="$(wrangler deploy -c "$CONFIG" 2>&1)" || {
  printf '%s\n' "$deploy_log" >&2
  die "Falló el despliegue."
}
worker_url="$(printf '%s' "$deploy_log" | lib extract-url)"
if [ -z "$worker_url" ]; then
  warn "No encontré una URL *.workers.dev en la salida de wrangler."
  ask OM_WORKER_URL "URL del Worker" ""
  worker_url="$OM_WORKER_URL"
fi
[ -n "$worker_url" ] || die "Necesito la URL del Worker para continuar."
ok "Desplegado en $worker_url"

step "7/8 Secretos"
admin_generated=0
if [ -z "${OM_ADMIN_TOKEN:-}" ] &&
  confirm OM_GENERATE_ADMIN_TOKEN "¿Genero un ADMIN_TOKEN aleatorio? (si el Worker ya tenía uno, lo reemplaza)" s; then
  OM_ADMIN_TOKEN="$(lib random-hex)"
  admin_generated=1
else
  ask_secret OM_ADMIN_TOKEN "ADMIN_TOKEN (no se muestra)"
fi
[ "${#OM_ADMIN_TOKEN}" -ge 32 ] || die "El ADMIN_TOKEN debe tener al menos 32 caracteres."
printf '%s' "$OM_ADMIN_TOKEN" | wrangler secret put ADMIN_TOKEN -c "$CONFIG" >/dev/null ||
  die "No se pudo cargar ADMIN_TOKEN."
ok "ADMIN_TOKEN cargado"

info "GITHUB_TOKEN es opcional: un PAT clásico con scope 'codespace' habilita orchestra_wake."
ask_secret OM_GITHUB_TOKEN "GITHUB_TOKEN (Enter para omitir)"
if [ -n "$OM_GITHUB_TOKEN" ]; then
  printf '%s' "$OM_GITHUB_TOKEN" | wrangler secret put GITHUB_TOKEN -c "$CONFIG" >/dev/null ||
    die "No se pudo cargar GITHUB_TOKEN."
  ok "GITHUB_TOKEN cargado"
else
  info "Sin GITHUB_TOKEN: orchestra_wake no va a estar disponible (lo podés cargar después)."
fi

step "8/8 Token de esta máquina"
info "Esperando a que el Worker responda…"
lib health "$worker_url" >/dev/null || die "El Worker no responde en $worker_url/v1/health."
ok "El Worker responde"
ask OM_MACHINE_NAME "Nombre para identificar esta máquina" "$(hostname 2>/dev/null || echo maquina)"
machine_token="$(printf '%s' "$OM_ADMIN_TOKEN" | lib create-token "$worker_url" "$OM_MACHINE_NAME")" ||
  die "No se pudo emitir el token de máquina."
ok "Token emitido para \"$OM_MACHINE_NAME\""

plugin_configured=0
if confirm OM_CONFIGURE_PLUGIN "¿Configuro el plugin de esta máquina con este Worker?" s; then
  node plugin/dist/cli.mjs configure --set mode=d1 --set "workerUrl=$worker_url" >/dev/null ||
    die "No se pudo escribir la configuración del plugin."
  printf '%s' "$machine_token" | node plugin/dist/cli.mjs configure --token-stdin >/dev/null ||
    die "No se pudo guardar el token en la configuración del plugin."
  plugin_configured=1
  ok "Plugin configurado (~/.config/orchestra-man/config.json, permisos 0600)"
fi

printf '\n%sListo.%s Tu Worker: %s\n' "$BOLD$GREEN" "$RESET" "$worker_url"
if [ "$admin_generated" = 1 ]; then
  printf '\n%sGuardá este ADMIN_TOKEN en tu gestor de contraseñas; no se vuelve a mostrar:%s\n    %s\n' \
    "$YELLOW" "$RESET" "$OM_ADMIN_TOKEN"
fi
if [ "$plugin_configured" = 0 ]; then
  printf '\nToken de la máquina "%s" (se muestra una sola vez):\n    %s\n' "$OM_MACHINE_NAME" "$machine_token"
fi
cat <<EOF

Siguientes pasos:
  - Reiniciá Claude Code: al abrir la sesión vas a ver el bloque "# orchestra-man".
  - Otras máquinas: emití un token por cada una y configurá el plugin allí
    (docs/guides/deploy-worker.md, "Emitir más tokens", y docs/guides/install-plugin.md).
  - Usá el mismo maskSalt en todas tus máquinas (ver la guía de instalación).
  - Actualizar el Worker más adelante: npm run worker:migrate:remote && npm run worker:deploy
EOF
