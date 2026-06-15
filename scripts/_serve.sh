#!/usr/bin/env bash
# Internal: brings up the production app stack. Invoked detached by launch.sh —
# don't run directly; use launch.sh / the Moolah desktop shortcut.
#
# On each launch it: starts embedded Postgres, applies any pending DB migrations,
# writes a throttled automatic backup, rebuilds only if the source changed, then
# runs the Next production server. Loads nvm because launchers don't inherit an
# interactive PATH.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
ROOT="$(pwd)"

# We're the session leader (launched via `setsid`), so our PID is the process
# group id. Record it so stop.sh can take down the whole tree (db + web). It
# survives the `exec` at the end, since exec keeps the same PID.
echo $$ > "$ROOT/.launch.pid"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

DB_PORT=5433
log() { echo "[serve $(date +%H:%M:%S)] $*"; }

# 1) Embedded Postgres in the background (same session, so stop.sh's group kill
#    takes it down too — and shuts it down cleanly via its SIGTERM handler).
log "starting database…"
npm run db:local &
for _ in $(seq 1 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$DB_PORT") 2>/dev/null && { exec 3>&- 3<&-; break; }
  sleep 1
done

# 2) Apply pending migrations (safe: only applies forward, never resets data).
log "applying migrations…"
npx prisma migrate deploy 2>&1 | sed 's/^/[migrate] /' || log "migrate deploy failed (continuing)"

# 3) Throttled automatic backup: skip if one was written in the last 12h; keep
#    only the 10 most recent. Backups hold Plaid tokens — backups/ is gitignored.
if [ -z "$(find backups -name '*.json' -mmin -720 2>/dev/null | head -1)" ]; then
  log "writing automatic backup…"
  if npm run db:backup >/dev/null 2>&1; then
    ls -1t backups/*.json 2>/dev/null | tail -n +11 | xargs -r rm -f
  else
    log "auto-backup failed (continuing)"
  fi
fi

# 4) Rebuild only when something that affects the build changed since last build.
if [ ! -f .next/BUILD_ID ] || \
   [ -n "$(find src prisma public package.json next.config.ts -type f -newer .next/BUILD_ID 2>/dev/null | head -1)" ]; then
  log "building (source changed)…"
  npm run build || { log "build failed"; exit 1; }
else
  log "build up to date — skipping."
fi

# 5) Stage static assets into the standalone bundle. Next's `output: standalone`
#    emits .next/standalone/server.js but does NOT copy .next/static or public/
#    next to it; we have to do that ourselves or every chunk 404s.
log "staging standalone assets…"
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public

# 6) Web server in the foreground (this process tree is what stop.sh kills).
#    Must run the standalone entrypoint, not `next start`, which is incompatible
#    with output: standalone and renders a broken server. server.js binds to
#    HOSTNAME, which defaults to 0.0.0.0 — pin it to localhost so post-login
#    redirects don't send the browser to http://0.0.0.0:3000 (ERR_ADDRESS_INVALID).
log "starting web server…"
exec env HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
