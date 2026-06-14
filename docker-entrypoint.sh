#!/bin/sh
# Apply any pending database migrations, then hand off to the server (CMD).
# Waits briefly for Postgres so `docker compose up` works without a healthcheck
# race on first boot.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set." >&2
  exit 1
fi
if [ -z "$AUTH_SECRET" ] || [ "$AUTH_SECRET" = "build-time-placeholder" ]; then
  echo "FATAL: AUTH_SECRET must be set to a real secret (see .env.example)." >&2
  exit 1
fi

echo "Applying database migrations…"
attempt=1
# Run from the self-contained migration tree (/app/migrate) so prisma.config.ts
# and its full dependency closure resolve. Invoke the CLI via node directly so we
# don't depend on the .bin symlink surviving the image copy.
cd /app/migrate
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$attempt" -ge 10 ]; then
    echo "FATAL: could not reach the database after $attempt attempts." >&2
    exit 1
  fi
  echo "Database not ready (attempt $attempt) — retrying in 3s…"
  attempt=$((attempt + 1))
  sleep 3
done

echo "Migrations applied. Starting Moolah."
cd /app
exec "$@"
