#!/usr/bin/env bash
# ============================================================
# Varolyn Tracker — Start all services locally (no Docker)
# Usage: ./start-local.sh
# Stop:  ./start-local.sh stop
# ============================================================

set -euo pipefail
cd "$(dirname "$0")"

PIDFILE="/tmp/varolyn-pids.txt"

# ── Stop everything ──────────────────────────────────────
if [ "${1:-}" = "stop" ]; then
  echo "Stopping all Varolyn services..."
  if [ -f "$PIDFILE" ]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  echo "All stopped."
  exit 0
fi

# ── Load env ─────────────────────────────────────────────
set -a
source .env.local
set +a

echo "╔══════════════════════════════════════════════════╗"
echo "║   Varolyn Tracker — Local Development Server     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Clear old PIDs
> "$PIDFILE"

# ── Generate VAPID keys if missing ───────────────────────
if [ -z "$VAPID_PUBLIC_KEY" ]; then
  echo "Generating VAPID keys..."
  VAPID_KEYS=$(node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")
  export VAPID_PUBLIC_KEY=$(echo "$VAPID_KEYS" | cut -d' ' -f1)
  export VAPID_PRIVATE_KEY=$(echo "$VAPID_KEYS" | cut -d' ' -f2)
  echo "VAPID keys generated."
fi

# ── Hash the default admin password properly ─────────────
echo "Ensuring admin user has correct password hash..."
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
HASH=$(node -e "require('bcryptjs').hash('admin123',12).then(h=>console.log(h))")
psql -d varolyn_tracker -c "UPDATE users SET password_hash = '$HASH' WHERE email = 'admin@varolynhealthcare.com';" 2>/dev/null || true

# ── Start backend services ───────────────────────────────
start_service() {
  local name=$1
  local dir=$2
  local port=$3
  echo "  Starting $name on port $port..."
  cd "$dir"
  node src/index.js > "/tmp/varolyn-${name}.log" 2>&1 &
  local pid=$!
  echo "$pid" >> "$PIDFILE"
  cd - > /dev/null
}

echo ""
echo "Starting backend services..."

start_service "gateway"      "services/gateway"      "$GATEWAY_PORT"
start_service "appointment"  "services/appointment"  "$APPOINTMENT_PORT"
start_service "tracking"     "services/tracking"     "$TRACKING_PORT"
start_service "consent"      "services/consent"      "$CONSENT_PORT"
start_service "link"         "services/link"          "$LINK_PORT"
start_service "notification" "services/notification" "$NOTIFICATION_PORT"
start_service "audit"        "services/audit"         "$AUDIT_PORT"
start_service "admin"        "services/admin"         "$ADMIN_PORT"

sleep 2

# ── Start web apps ───────────────────────────────────────
echo ""
echo "Starting web apps..."

echo "  Starting Customer PWA on port 3000..."
cd web/customer-pwa
VITE_API_URL=http://localhost:8080 VITE_SSE_URL=http://localhost:8082 \
  npx vite --port 3000 --host > /tmp/varolyn-customer-pwa.log 2>&1 &
echo "$!" >> "$PIDFILE"
cd - > /dev/null

echo "  Starting Staff PWA on port 3002..."
cd web/staff-pwa
VITE_API_URL=http://localhost:8080 VITE_WS_URL=ws://localhost:8082 \
  npx vite --port 3002 --host > /tmp/varolyn-staff-pwa.log 2>&1 &
echo "$!" >> "$PIDFILE"
cd - > /dev/null

echo "  Starting Admin Dashboard on port 3003..."
cd web/admin-dashboard
VITE_API_URL=http://localhost:8080 \
  npx vite --port 3003 --host > /tmp/varolyn-admin-dashboard.log 2>&1 &
echo "$!" >> "$PIDFILE"
cd - > /dev/null

sleep 3

# ── Verify ───────────────────────────────────────────────
echo ""
echo "Verifying services..."
for port in 8080 8081 8082 8083 8084 8085 8087 8088; do
  if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
    echo "  ✅ Port $port — OK"
  else
    echo "  ⚠️  Port $port — starting up..."
  fi
done

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  🚀 All services running!                            ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  🏥 Admin Dashboard:  http://localhost:3003/admin/    ║"
echo "║     Login: admin@varolynhealthcare.com / admin123    ║"
echo "║                                                      ║"
echo "║  👨‍⚕️ Staff PWA:        http://localhost:3002/staff/    ║"
echo "║                                                      ║"
echo "║  🗺️  Patient Tracker:  http://localhost:3000/track/   ║"
echo "║                                                      ║"
echo "║  📡 API Health:       http://localhost:8080/health    ║"
echo "║                                                      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  To stop: ./start-local.sh stop                      ║"
echo "║  Logs:    tail -f /tmp/varolyn-*.log                 ║"
echo "╚══════════════════════════════════════════════════════╝"
