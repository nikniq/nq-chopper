#!/usr/bin/env bash
# deploy.sh - release NQ Chopper on the server (SiteGround, web root public_html/).
#
# Run on the server from the project root, usually over SSH:
#   ssh user@host 'cd ~/www/example.com && ./deploy.sh'
#
# Environment overrides:
#   PHP_BIN       php binary to use           (default: php)
#   COMPOSER_BIN  composer binary to use      (default: composer)
#   BRANCH        git branch to deploy        (default: main)
#   SKIP_GIT=1    do not git pull (for uploads done by other means)

set -euo pipefail

cd "$(dirname "$0")"

PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"
BRANCH="${BRANCH:-main}"

step() { echo; echo "==> $*"; }

step "PHP $("$PHP_BIN" -r 'echo PHP_VERSION;') at $(command -v "$PHP_BIN")"

if [ ! -f .env ]; then
    echo "No .env on the server. Copy .env.example to .env, set APP_ENV=production and APP_URL, then re-run." >&2
    exit 1
fi

"$PHP_BIN" artisan down --retry=10 || true

if [ "${SKIP_GIT:-0}" != "1" ] && [ -d .git ]; then
    step "Pulling $BRANCH"
    git fetch origin "$BRANCH"
    git checkout -q "$BRANCH"
    git reset --hard "origin/$BRANCH"
fi

step "Backing up the database"
"$PHP_BIN" artisan db:backup --keep=14 || echo "  (backup skipped)"

step "Installing Composer dependencies"
"$COMPOSER_BIN" install --no-dev --no-interaction --prefer-dist --optimize-autoloader --no-progress

step "Preparing storage"
mkdir -p storage/framework/{cache,sessions,views} storage/logs bootstrap/cache
chmod -R u+rwX,g+rwX storage bootstrap/cache

if grep -qE '^DB_CONNECTION=sqlite' .env; then
    db_file=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2- || true)
    touch "${db_file:-database/database.sqlite}"
fi

step "Running migrations"
"$PHP_BIN" artisan migrate --force --no-interaction

step "Rebuilding caches"
"$PHP_BIN" artisan optimize:clear
"$PHP_BIN" artisan optimize

"$PHP_BIN" artisan up

step "Deployed $(git rev-parse --short HEAD 2>/dev/null || echo '(no git)') on branch $BRANCH"
