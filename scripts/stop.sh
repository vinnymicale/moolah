#!/usr/bin/env bash
# Stops the app started by launch.sh: gracefully terminates the whole process
# group (Next server + embedded Postgres), giving Postgres time to shut down
# cleanly, then a port-based safety net guarantees nothing is left listening.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
ROOT="$(pwd)"
PIDFILE="$ROOT/.launch.pid"

PID="$(cat "$PIDFILE" 2>/dev/null || true)"
if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
  # Negative PID targets the process group (_serve.sh is the session leader).
  kill -TERM -"$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null
  for _ in $(seq 1 15); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  kill -KILL -"$PID" 2>/dev/null || true
fi
rm -f "$PIDFILE"

# Safety net: ensure the web (3000) and database (5433) ports are released, even
# if the pid file was stale or a process escaped the group.
for port in 3000 5433; do
  fuser -k -TERM "${port}/tcp" 2>/dev/null || true
done

echo "Stopped."
