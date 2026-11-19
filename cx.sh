#!/usr/bin/env bash
# cx.sh - setup checks, corrections and admin tools for NQ Chopper.
#
# Usage:
#   ./cx.sh                       interactive menu (when run in a terminal)
#   ./cx.sh --check               report problems only
#   ./cx.sh --fix                 report and apply corrections
#   ./cx.sh admins                list admins
#   ./cx.sh admin-add EMAIL       grant admin (Ops page) to an email
#   ./cx.sh admin-remove EMAIL    revoke admin
#   ./cx.sh users [SEARCH]        list users (newest first), optional name/email search
#   ./cx.sh password EMAIL        set a new password for a user
#   ./cx.sh stats                 players, runs, matches
#   ./cx.sh migrate | caches | log | down | up
#
# Checks: PHP binary and version, Composer, vendor/ and its platform check,
# .env and APP_KEY (generated if missing), SQLite database, storage permissions.

set -u

cd "$(dirname "$0")"

FIX=0

PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
problems=0

ok()   { echo "${GREEN}[ok]${RESET}   $*"; }
warn() { echo "${YELLOW}[warn]${RESET} $*"; }
fail() { echo "${RED}[fail]${RESET} $*"; problems=$((problems + 1)); }
fixed() { echo "${GREEN}[fixed]${RESET} $*"; }

run_checks() {
problems=0
# --- PHP ------------------------------------------------------------------
if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
    fail "PHP not found (PHP_BIN=$PHP_BIN). Install PHP 8.4+ or set PHP_BIN."
    return 1
fi
PHP_VERSION=$("$PHP_BIN" -r 'echo PHP_VERSION;')
PHP_VERSION_ID=$("$PHP_BIN" -r 'echo PHP_VERSION_ID;')
ok "PHP $PHP_VERSION at $(command -v "$PHP_BIN")"

# Minimum version is whatever composer.lock resolved for "php".
REQUIRED_ID=80400
if [ -f vendor/composer/platform_check.php ]; then
    found=$(grep -oE 'PHP_VERSION_ID >= [0-9]+' vendor/composer/platform_check.php | grep -oE '[0-9]+$' || true)
    [ -n "$found" ] && REQUIRED_ID=$found
fi
if [ "$PHP_VERSION_ID" -lt "$REQUIRED_ID" ]; then
    fail "PHP $PHP_VERSION is below the version required by vendor/ (ID $REQUIRED_ID)."
    echo "       The web server may use a different PHP than the CLI. Check phpinfo() in the browser."
    echo "       Then either raise the server PHP version, or reinstall vendor/ for the server PHP."
fi

for ext in pdo_sqlite mbstring openssl tokenizer xml ctype json fileinfo; do
    if "$PHP_BIN" -m | grep -qi "^$ext$"; then
        ok "ext: $ext"
    else
        fail "PHP extension missing: $ext"
    fi
done

# --- Composer -------------------------------------------------------------
if command -v "$COMPOSER_BIN" >/dev/null 2>&1; then
    ok "Composer $("$COMPOSER_BIN" --version 2>/dev/null | grep -oE 'version [0-9.]+' | cut -d' ' -f2)"
else
    fail "Composer not found (COMPOSER_BIN=$COMPOSER_BIN)."
fi

# A stale platform.php override in composer.json pins installs to the wrong PHP.
if "$COMPOSER_BIN" config platform.php >/dev/null 2>&1; then
    pinned=$("$COMPOSER_BIN" config platform.php 2>/dev/null)
    warn "composer.json pins platform.php=$pinned"
    if [ "$FIX" -eq 1 ]; then
        "$COMPOSER_BIN" config --unset platform.php && fixed "removed platform.php pin"
    fi
fi

if [ ! -d vendor ] || [ ! -f vendor/autoload.php ]; then
    fail "vendor/ missing. Run: $COMPOSER_BIN install"
    if [ "$FIX" -eq 1 ]; then
        "$COMPOSER_BIN" install --no-interaction --prefer-dist && fixed "composer install"
    fi
else
    # Run Composer's own platform check with this PHP.
    if "$PHP_BIN" -r 'require "vendor/composer/platform_check.php";' >/dev/null 2>&1; then
        ok "vendor/ platform check passes"
    else
        fail "vendor/ platform check fails for PHP $PHP_VERSION"
        if [ "$FIX" -eq 1 ]; then
            echo "       Reinstalling vendor/ against PHP $PHP_VERSION ..."
            "$COMPOSER_BIN" install --no-interaction --prefer-dist && fixed "composer install"
        fi
    fi
fi

# --- .env -----------------------------------------------------------------
if [ ! -f .env ]; then
    fail ".env missing"
    if [ "$FIX" -eq 1 ]; then
        cp .env.example .env && fixed "copied .env.example to .env"
    fi
else
    ok ".env present"
fi

if [ -f .env ]; then
    # APP_KEY is always generated when missing; the app cannot boot without it.
    if ! grep -qE '^APP_KEY=.+' .env; then
        if [ -f vendor/autoload.php ]; then
            if "$PHP_BIN" artisan key:generate --force --no-interaction >/dev/null; then
                fixed "APP_KEY generated"
            else
                fail "APP_KEY missing and key:generate failed"
            fi
        else
            fail "APP_KEY missing (install vendor/ first, then re-run)"
        fi
    else
        ok "APP_KEY set"
    fi

    app_env=$(grep -E '^APP_ENV=' .env | cut -d= -f2-)
    app_debug=$(grep -E '^APP_DEBUG=' .env | cut -d= -f2-)
    if [ "$app_env" = "production" ] && [ "$app_debug" = "true" ]; then
        warn "APP_DEBUG=true in production"
    fi

    db_conn=$(grep -E '^DB_CONNECTION=' .env | cut -d= -f2-)
    if [ "$db_conn" = "sqlite" ]; then
        db_file=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2-)
        db_file=${db_file:-database/database.sqlite}
        if [ -f "$db_file" ]; then
            ok "SQLite database $db_file"
        else
            fail "SQLite database $db_file missing"
            if [ "$FIX" -eq 1 ]; then
                touch "$db_file" && fixed "created $db_file"
            fi
        fi
    fi
fi

# --- storage / cache permissions -----------------------------------------
for dir in storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache; do
    if [ ! -d "$dir" ]; then
        fail "$dir missing"
        [ "$FIX" -eq 1 ] && mkdir -p "$dir" && fixed "created $dir"
    elif [ ! -w "$dir" ]; then
        fail "$dir not writable"
        [ "$FIX" -eq 1 ] && chmod -R u+rwX,g+rwX "$dir" && fixed "chmod $dir"
    else
        ok "$dir writable"
    fi
done

# --- summary --------------------------------------------------------------
echo
if [ "$problems" -eq 0 ]; then
    echo "${GREEN}All checks passed.${RESET}"
else
    echo "${RED}$problems problem(s) found.${RESET}"
    [ "$FIX" -eq 0 ] && echo "Re-run with --fix to apply corrections."
    return 1
fi
}

# --- admin tools ------------------------------------------------------------
need_app() {
    if [ ! -f vendor/autoload.php ] || [ ! -f .env ]; then
        fail "App not installed yet: run ./cx.sh --fix first."; return 1
    fi
}
# Run PHP inside the booted app. Arguments travel in CX_* env vars, never spliced into code.
app_php() {
    "$PHP_BIN" -r '
        require "vendor/autoload.php";
        $app = require "bootstrap/app.php";
        $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
        '"$1"
}
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
env_set() {
    local key=$1 val=$2 tmp
    tmp=$(mktemp)
    if grep -qE "^$key=" .env; then
        awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' .env >"$tmp"
    else
        cat .env >"$tmp"; echo "$key=$val" >>"$tmp"
    fi
    cat "$tmp" >.env; rm -f "$tmp"
}
# Settings are cached on production: rebuild the cache so a change takes effect.
refresh_config() {
    if [ -f bootstrap/cache/config.php ]; then
        "$PHP_BIN" artisan config:cache >/dev/null && ok "config cache rebuilt"
    fi
}
valid_email() { [[ "$1" =~ ^[^[:space:],@]+@[^[:space:],@]+\.[^[:space:],@]+$ ]]; }

admins_list() {
    need_app || return 1
    local list; list=$(env_get ADMIN_EMAILS)
    if [ -z "$list" ]; then echo "No admins set (ADMIN_EMAILS is empty)."; return 0; fi
    echo "Admins (ADMIN_EMAILS):"
    echo "$list" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | while read -r e; do
        if CX_EMAIL="$e" app_php 'exit(App\Models\User::whereRaw("lower(email) = ?", [strtolower(getenv("CX_EMAIL"))])->exists() ? 0 : 1);' 2>/dev/null; then
            echo "  $e"
        else
            echo "  $e  ${YELLOW}(no account with this email yet)${RESET}"
        fi
    done
}
admin_add() {
    need_app || return 1
    local email; email=$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')
    valid_email "$email" || { fail "Not a valid email: ${1:-}"; return 1; }
    local list; list=$(env_get ADMIN_EMAILS | tr '[:upper:]' '[:lower:]')
    if echo ",$list," | tr -d ' ' | grep -qF ",$email,"; then warn "$email is already an admin"; return 0; fi
    env_set ADMIN_EMAILS "${list:+$list,}$email"
    fixed "$email is now an admin"
    CX_EMAIL="$email" app_php 'exit(App\Models\User::whereRaw("lower(email) = ?", [getenv("CX_EMAIL")])->exists() ? 0 : 1);' 2>/dev/null \
        || warn "No account uses $email yet; it takes effect when one does."
    refresh_config
}
admin_remove() {
    need_app || return 1
    local email; email=$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')
    [ -n "$email" ] || { fail "Give an email"; return 1; }
    local list new
    list=$(env_get ADMIN_EMAILS)
    new=$(echo "$list" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | grep -viFx "$email" | paste -sd, -)
    if [ "$new" = "$(echo "$list" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | paste -sd, -)" ]; then
        warn "$email is not an admin"; return 0
    fi
    env_set ADMIN_EMAILS "$new"
    fixed "$email is no longer an admin"
    refresh_config
}
users_list() {
    need_app || return 1
    CX_Q="${1:-}" app_php '
        $q = App\Models\User::latest();
        if (($s = getenv("CX_Q")) !== "") $q->where(fn ($w) => $w->where("name", "like", "%$s%")->orWhere("email", "like", "%$s%"));
        $users = $q->limit(25)->get();
        if ($users->isEmpty()) { echo "No users found.\n"; exit; }
        printf("%-6s %-20s %-34s %-8s %s\n", "ID", "NAME", "EMAIL", "NIKNIQ", "JOINED");
        foreach ($users as $u) printf("%-6s %-20s %-34s %-8s %s%s\n", $u->id, mb_strimwidth($u->name, 0, 20), mb_strimwidth($u->email, 0, 34), $u->nikniq_id ? "yes" : "", $u->created_at?->format("Y-m-d"), App\Http\Controllers\AdminController::isAdmin($u) ? "  [admin]" : "");
        echo "Total users: ".App\Models\User::count()."\n";'
}
user_password() {
    need_app || return 1
    local email=${1:-} pw pw2
    [ -n "$email" ] || { fail "Give an email"; return 1; }
    read -rsp "New password for $email (min 8): " pw; echo
    read -rsp "Repeat: " pw2; echo
    [ "$pw" = "$pw2" ] || { fail "Passwords do not match"; return 1; }
    [ ${#pw} -ge 8 ] || { fail "Too short"; return 1; }
    CX_EMAIL="$email" CX_PW="$pw" app_php '
        $u = App\Models\User::whereRaw("lower(email) = ?", [strtolower(getenv("CX_EMAIL"))])->first();
        if (! $u) { fwrite(STDERR, "No user with that email\n"); exit(1); }
        $u->password = getenv("CX_PW"); $u->save(); echo "Password updated for {$u->name}\n";'
}
stats() {
    need_app || return 1
    app_php '
        $d = now()->startOfDay();
        printf("Users     %d (%d this week)\n", App\Models\User::count(), App\Models\User::where("created_at", ">=", now()->subWeek())->count());
        printf("Runs      %d (%d today)\n", App\Models\Score::count(), App\Models\Score::where("created_at", ">=", $d)->count());
        printf("Matches   %d waiting, %d active, %d finished\n", App\Models\GameMatch::where("status","waiting")->count(), App\Models\GameMatch::where("status","active")->count(), App\Models\GameMatch::where("status","finished")->count());'
}
do_migrate() { need_app && "$PHP_BIN" artisan migrate --force; }
do_caches()  { need_app && "$PHP_BIN" artisan optimize:clear >/dev/null && "$PHP_BIN" artisan optimize >/dev/null && ok "caches cleared and rebuilt"; }
do_log()     { local f; f=$(ls -t storage/logs/*.log 2>/dev/null | head -1); [ -n "$f" ] && tail -n 40 "$f" || echo "No log files."; }
do_down()    { need_app && "$PHP_BIN" artisan down --retry=60 && ok "site is in maintenance mode"; }
do_up()      { need_app && "$PHP_BIN" artisan up && ok "site is live"; }

ask() { local a; read -rp "$1: " a; echo "$a"; }
menu() {
    while true; do
        echo
        echo "${GREEN}NQ Chopper — cx.sh${RESET}"
        echo "  Setup"
        echo "    1) Check setup              2) Check and fix"
        echo "  Admins"
        echo "    3) List admins              4) Add admin"
        echo "    5) Remove admin"
        echo "  Users"
        echo "    6) List / search users      7) Set a user's password"
        echo "    8) Stats"
        echo "  Maintenance"
        echo "    9) Run migrations          10) Clear and rebuild caches"
        echo "   11) Show recent log         12) Maintenance mode on"
        echo "   13) Maintenance mode off"
        echo "    q) Quit"
        local c; read -rp "Choose: " c || return 0
        echo
        case "$c" in
            1) FIX=0 run_checks ;;
            2) FIX=1 run_checks ;;
            3) admins_list ;;
            4) admin_add "$(ask "Email to make admin")" ;;
            5) admins_list; admin_remove "$(ask "Email to remove")" ;;
            6) users_list "$(ask "Search name/email (blank for newest)")" ;;
            7) user_password "$(ask "User email")" ;;
            8) stats ;;
            9) do_migrate ;;
            10) do_caches ;;
            11) do_log ;;
            12) do_down ;;
            13) do_up ;;
            q|Q|"") return 0 ;;
            *) echo "Unknown choice: $c" ;;
        esac
    done
}

case "${1:-}" in
    --fix) FIX=1; run_checks; exit $? ;;
    --check) run_checks; exit $? ;;
    admins) admins_list ;;
    admin-add) admin_add "${2:-}" ;;
    admin-remove) admin_remove "${2:-}" ;;
    users) users_list "${2:-}" ;;
    password) user_password "${2:-}" ;;
    stats) stats ;;
    migrate) do_migrate ;;
    caches) do_caches ;;
    log) do_log ;;
    down) do_down ;;
    up) do_up ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
    "") if [ -t 0 ]; then menu; else run_checks; exit $?; fi ;;
    *) echo "Unknown command: $1 (try --help)"; exit 2 ;;
esac

