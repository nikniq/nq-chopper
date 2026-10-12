#!/usr/bin/env bash
# cx.sh - setup checks and corrections for NQ Chopper.
#
# Usage:
#   ./cx.sh          report problems only
#   ./cx.sh --fix    report and apply corrections
#
# Checks: PHP binary and version, Composer, vendor/ and its platform check,
# .env and APP_KEY, SQLite database, storage permissions.

set -u

cd "$(dirname "$0")"

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
problems=0

ok()   { echo "${GREEN}[ok]${RESET}   $*"; }
warn() { echo "${YELLOW}[warn]${RESET} $*"; }
fail() { echo "${RED}[fail]${RESET} $*"; problems=$((problems + 1)); }
fixed() { echo "${GREEN}[fixed]${RESET} $*"; }

# --- PHP ------------------------------------------------------------------
if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
    fail "PHP not found (PHP_BIN=$PHP_BIN). Install PHP 8.4+ or set PHP_BIN."
    exit 1
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
    if grep -qE '^APP_KEY=\s*$' .env; then
        fail "APP_KEY is empty"
        if [ "$FIX" -eq 1 ] && [ -f vendor/autoload.php ]; then
            "$PHP_BIN" artisan key:generate --force --no-interaction && fixed "APP_KEY generated"
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
    exit 1
fi
