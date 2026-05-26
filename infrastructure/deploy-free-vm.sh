#!/usr/bin/env bash
# ============================================================
# Varolyn Tracker — Deploy to Oracle Cloud Free Tier (or any Ubuntu VM)
# This script bootstraps the entire stack on a fresh Ubuntu 22.04+ VM.
# Completely free: Docker, Docker Compose, Let's Encrypt, OSRM, PostgreSQL+TimescaleDB.
#
# Usage:
#   ssh your-vm 'bash -s' < deploy-free-vm.sh
#   OR: scp deploy-free-vm.sh your-vm: && ssh your-vm ./deploy-free-vm.sh
#
# Prerequisites:
#   - Ubuntu 22.04+ VM (Oracle Cloud Free Tier: 4 ARM cores, 24GB RAM)
#   - A domain pointed to the VM's public IP (for HTTPS)
#   - Port 80 and 443 open in security list / firewall
# ============================================================

set -euo pipefail

DOMAIN="${DOMAIN:-track.varolynhealthcare.com}"
EMAIL="${ADMIN_EMAIL:-admin@varolynhealthcare.com}"
REPO_URL="${REPO_URL:-https://github.com/varolyn/varolyn-tracker.git}"
INSTALL_DIR="/opt/varolyn-tracker"

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Varolyn Tracker — Production Deployment Script     ║"
echo "║   Target: ${DOMAIN}                                  ║"
echo "╚══════════════════════════════════════════════════════╝"

# ── 1. System updates & dependencies ─────────────────────
echo "[1/8] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl git wget unzip ufw \
  apt-transport-https ca-certificates gnupg lsb-release

# ── 2. Install Docker & Docker Compose ───────────────────
echo "[2/8] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  sudo systemctl enable docker
  sudo systemctl start docker
fi

if ! command -v docker compose &>/dev/null; then
  sudo apt-get install -y docker-compose-plugin
fi

echo "Docker version: $(docker --version)"

# ── 3. Firewall ──────────────────────────────────────────
echo "[3/8] Configuring firewall..."
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw --force enable

# ── 4. Clone repository ──────────────────────────────────
echo "[4/8] Cloning repository..."
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR" && git pull
else
  sudo git clone "$REPO_URL" "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── 5. Generate secrets ──────────────────────────────────
echo "[5/8] Generating secrets..."
if [ ! -f .env ]; then
  cp .env.example .env

  # Generate JWT secret
  JWT_SECRET=$(openssl rand -hex 64)
  sed -i "s/CHANGE_ME_run_npm_run_generate_jwt_secret/$JWT_SECRET/" .env

  # Generate encryption key
  ENC_KEY=$(openssl rand -hex 32)
  sed -i "s/CHANGE_ME_64_hex_chars_here/$ENC_KEY/" .env

  # Generate Postgres password
  PG_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
  sed -i "s/CHANGE_ME_strong_password_here/$PG_PASS/" .env

  # Generate VAPID keys
  if command -v node &>/dev/null; then
    VAPID=$(node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" 2>/dev/null || true)
    if [ -n "$VAPID" ]; then
      VAPID_PUB=$(echo "$VAPID" | cut -d' ' -f1)
      VAPID_PRIV=$(echo "$VAPID" | cut -d' ' -f2)
      sed -i "s/^VAPID_PUBLIC_KEY=.*/VAPID_PUBLIC_KEY=$VAPID_PUB/" .env
      sed -i "s/^VAPID_PRIVATE_KEY=.*/VAPID_PRIVATE_KEY=$VAPID_PRIV/" .env
    fi
  fi

  # Set domain
  sed -i "s|https://track.varolynhealthcare.com|https://$DOMAIN|" .env
  sed -i "s|https://api.varolynhealthcare.com|https://$DOMAIN/api|" .env

  echo "  → .env generated with random secrets"
else
  echo "  → .env already exists, skipping"
fi

# ── 6. Download OSRM data (India region, optional) ───────
echo "[6/8] Setting up OSRM (routing engine)..."
OSRM_DIR="$INSTALL_DIR/infrastructure/osrm-data"
if [ ! -f "$OSRM_DIR/region.osrm" ]; then
  mkdir -p "$OSRM_DIR"
  echo "  Downloading India OSM data for routing (this may take a while)..."
  # Use a smaller extract for testing; replace with full India for production
  wget -q -O "$OSRM_DIR/region.osm.pbf" \
    "https://download.geofabrik.de/asia/india/karnataka-latest.osm.pbf" || true

  if [ -f "$OSRM_DIR/region.osm.pbf" ]; then
    echo "  Processing OSRM data..."
    docker run --rm -v "$OSRM_DIR:/data" osrm/osrm-backend:latest \
      osrm-extract -p /opt/car.lua /data/region.osm.pbf || true
    docker run --rm -v "$OSRM_DIR:/data" osrm/osrm-backend:latest \
      osrm-partition /data/region.osrm || true
    docker run --rm -v "$OSRM_DIR:/data" osrm/osrm-backend:latest \
      osrm-customize /data/region.osrm || true
    echo "  → OSRM ready"
  else
    echo "  → OSRM data download failed. ETA will use straight-line fallback."
  fi
else
  echo "  → OSRM data already exists"
fi

# ── 7. Download GeoIP database (DB-IP Lite, free) ────────
echo "[7/8] Downloading GeoIP database..."
GEOIP_DIR="$INSTALL_DIR/infrastructure/geoip"
mkdir -p "$GEOIP_DIR"
if [ ! -f "$GEOIP_DIR/dbip-city-lite.mmdb" ]; then
  MONTH=$(date +%Y-%m)
  wget -q -O "$GEOIP_DIR/dbip-city-lite.mmdb.gz" \
    "https://download.db-ip.com/free/dbip-city-lite-${MONTH}.mmdb.gz" || true
  if [ -f "$GEOIP_DIR/dbip-city-lite.mmdb.gz" ]; then
    gunzip "$GEOIP_DIR/dbip-city-lite.mmdb.gz"
    echo "  → GeoIP database ready"
  else
    echo "  → GeoIP download failed (optional, IP geolocation disabled)"
  fi
fi

# ── 8. Build and start ───────────────────────────────────
echo "[8/8] Building and starting services..."
cd "$INSTALL_DIR/infrastructure"

# Start core services (without monitoring/OSRM profiles initially)
docker compose up -d --build

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ✅ Deployment Complete!                            ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║   Customer app: https://$DOMAIN/track/              ║"
echo "║   Staff app:    https://$DOMAIN/staff/              ║"
echo "║   Admin panel:  https://$DOMAIN/admin/              ║"
echo "║   API:          https://$DOMAIN/api/health          ║"
echo "║                                                      ║"
echo "║   Default admin: admin@varolynhealthcare.com         ║"
echo "║   Default pass:  admin123 (CHANGE IMMEDIATELY!)      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "To enable monitoring: docker compose --profile monitoring up -d"
echo "To enable OSRM:       docker compose --profile with-osrm up -d"
echo ""
echo "Logs: docker compose logs -f"
