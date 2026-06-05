#!/usr/bin/env bash
# Moolah — one-click launcher (single window).
#
# Starts the app stack (Postgres + Next), opens Moolah in a dedicated Edge
# app-style window, and BLOCKS until you close that window — then shuts the
# whole stack down cleanly. So there's just one icon: open it to start, close
# the window to stop. No separate "stop" shortcut needed.
#
# A second click while it's already running just opens another window and won't
# start (or stop) a second server.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
ROOT="$(pwd)"
PIDFILE="$ROOT/.launch.pid"
LOG="$ROOT/.launch.log"
URL="http://localhost:3000"
# Persistent browser profile so your Moolah login survives across launches.
PROFILE_WIN='$env:LOCALAPPDATA\Moolah\browser'

open_log() { powershell.exe -NoProfile -Command "Start-Process notepad '$(wslpath -w "$LOG")'" >/dev/null 2>&1 || true; }

find_edge() {
  local p
  for p in "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
           "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; do
    [ -f "$p" ] && { wslpath -w "$p"; return 0; }
  done
  return 1
}

owner=""
# Start the stack only if nothing is already serving on the port.
if ! curl -sf -o /dev/null "$URL"; then
  : > "$LOG"
  rm -f "$PIDFILE"   # _serve.sh records its own (process-group) pid on startup
  setsid bash "$ROOT/scripts/_serve.sh" >>"$LOG" 2>&1 </dev/null &
  owner=1
  ready=""
  for _ in $(seq 1 300); do
    curl -sf -o /dev/null "$URL" && { ready=1; break; }
    # If _serve.sh has written its pid and that process is already gone, it died.
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && break
    sleep 1
  done
  if [ -z "$ready" ]; then
    open_log
    bash "$ROOT/scripts/stop.sh" >>"$LOG" 2>&1
    exit 1
  fi
fi

# Open Moolah in a dedicated app window and wait until it's closed.
EDGE="$(find_edge || true)"
if [ -n "$EDGE" ]; then
  powershell.exe -NoProfile -Command \
    "Start-Process -Wait -FilePath \"$EDGE\" -ArgumentList '--app=$URL', \"--user-data-dir=$PROFILE_WIN\", '--no-first-run', '--no-default-browser-check'" \
    >/dev/null 2>&1
else
  # No Edge found — fall back to the default browser (no close-to-quit).
  powershell.exe -NoProfile -Command "Start-Process '$URL'" >/dev/null 2>&1 || true
fi

# Window closed → shut the stack down (only if this launch started it).
if [ -n "$owner" ]; then
  bash "$ROOT/scripts/stop.sh" >>"$LOG" 2>&1
fi
