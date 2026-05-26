#!/usr/bin/env bash
# ============================================================
# Varolyn Healthcare — Start simplified system
# Usage:  ./start-v2.sh
# Stop:   ./start-v2.sh stop
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PIDFILE="/tmp/varolyn-v2-pids.txt"

# ── Stop ─────────────────────────────────────────────────
if [ "${1:-}" = "stop" ]; then
  echo "Stopping Varolyn..."
  if [ -f "$PIDFILE" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  echo "Stopped."
  exit 0
fi

# ── Env ──────────────────────────────────────────────────
export PORT=8080
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DB=varolyn_tracker
export POSTGRES_USER="${USER}"
export POSTGRES_PASSWORD=""
export REDIS_URL=redis://localhost:6379

echo "╔══════════════════════════════════════════════╗"
echo "║   Varolyn Healthcare — Live Location Sharing  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

> "$PIDFILE"

# ── DB setup (idempotent) ────────────────────────────────
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
echo "Setting up database..."
psql -d varolyn_tracker -f db/schema-v2.sql 2>/dev/null || {
  createdb varolyn_tracker 2>/dev/null || true
  psql -d varolyn_tracker -f db/schema-v2.sql
}
echo "  ✅ Database ready"

# ── Install deps ────────────────────────────────────────
echo ""
echo "Installing dependencies..."
cd server && npm install --silent 2>/dev/null && cd ..
cd web/app && npm install --silent 2>/dev/null && cd ../..
echo "  ✅ Dependencies installed"

# ── Start backend ───────────────────────────────────────
echo ""
echo "Starting backend (port $PORT)..."
cd server
node index.js > /tmp/varolyn-server.log 2>&1 &
echo "$!" >> "$PIDFILE"
cd ..
sleep 2

if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
  echo "  ✅ Backend running"
else
  echo "  ⚠️  Backend starting up..."
fi

# ── Start frontend ──────────────────────────────────────
echo ""
echo "Starting frontend (port 3000)..."
cd web/app
npx vite --port 3000 --host > /tmp/varolyn-web.log 2>&1 &
echo "$!" >> "$PIDFILE"
cd ../..
sleep 3

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  🚀 Varolyn Healthcare is running!                    ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                       ║"
echo "║  📱 Open app:  http://localhost:3000                   ║"
echo "║                                                       ║"
echo "║  Steps:                                                ║"
echo "║  1. Enter your name, phone, email                     ║"
echo "║  2. Check consent → Start Sharing                     ║"
echo "║  3. Send tracking link via WhatsApp/SMS/Copy          ║"
echo "║  4. Recipient opens link → sees live map              ║"
echo "║                                                       ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  To stop:  ./start-v2.sh stop                          ║"
echo "║  Logs:     tail -f /tmp/varolyn-server.log             ║"
echo "╚══════════════════════════════════════════════════════╝"
