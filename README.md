# Varolyn Tracker

**Zomato-style live tracking for home healthcare visits — 100% web-based, 100% free, 100% self-hosted.**

A production-ready PWA system that lets patients track their healthcare professional's location in real-time, from the moment they leave until they arrive at the patient's doorstep.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/varolyn/varolyn-tracker.git
cd varolyn-tracker

# 2. Configure
cp .env.example .env
# Edit .env with your settings (or use defaults for local dev)

# 3. Run everything
cd infrastructure
docker compose up --build

# 4. Open
# Customer PWA: http://localhost:3000/track/
# Staff PWA:    http://localhost:3002/staff/
# Admin Panel:  http://localhost:3003/admin/
# API:          http://localhost:8080/api/health
```

**Default admin login:** `admin@varolynhealthcare.com` / `admin123`

## What It Does

```
Appointment Created → Patient Gets Tracking Link → Patient Consents →
Staff Gets Push Notification → Staff Opens PWA → Location Streams Live →
Patient Sees Map + ETA → Visit Complete → Data Auto-Deleted (24h)
```

## Architecture

| Component | Technology | Cost |
|-----------|-----------|------|
| Frontend (3 PWAs) | React 18 + Vite + MapLibre GL JS | Free |
| Backend (8 services) | Node.js + Fastify | Free |
| Database | PostgreSQL 16 + TimescaleDB | Free |
| Cache & Pub/Sub | Redis 7 | Free |
| Maps | OpenStreetMap tiles | Free |
| Routing/ETA | OSRM (self-hosted) | Free |
| Push Notifications | web-push (VAPID, self-hosted) | Free |
| Email | Nodemailer + any SMTP | Free |
| Reverse Proxy | Traefik + Let's Encrypt | Free |
| Hosting | Oracle Cloud Free Tier (4 cores, 24GB) | Free |

**Total monthly cost: $0**

## Project Structure

```
varolyn-tracker/
├── services/
│   ├── gateway/          # API gateway + auth + reverse proxy
│   ├── tracking/         # WebSocket ingestion + SSE broadcast + Kalman filter
│   ├── consent/          # SHA-256 consent chain + data purge + right to erasure
│   ├── appointment/      # CRUD + tracking link generation
│   ├── notification/     # Web Push (VAPID) + Email (SMTP)
│   ├── link/             # Tracking link resolution
│   ├── audit/            # Immutable audit log + auto-logging
│   ├── admin/            # Staff/patient management + dashboard stats
│   └── osint/            # IP geolocation (DB-IP Lite, free)
├── web/
│   ├── customer-pwa/     # Patient tracking view (MapLibre + SSE)
│   ├── staff-pwa/        # Staff location sharing (GPS + WebSocket + Wake Lock)
│   └── admin-dashboard/  # Admin management panel
├── shared/
│   ├── crypto/           # JWT, AES-256-GCM, SHA-256, bcrypt
│   └── db/               # PostgreSQL pool + Redis connections
├── infrastructure/
│   ├── docker-compose.yml
│   ├── postgres/init.sql # Full TimescaleDB schema
│   └── deploy-free-vm.sh # One-command production deploy
├── scripts/
│   ├── generate-vapid.js # Generate Web Push keys
│   └── purge-expired-data.js  # Manual GDPR purge
└── docs/
    ├── architecture.md
    ├── api-spec.yaml
    ├── consent-legal-pack.md
    └── staff-background-tracking-guide.md
```

## Background Tracking (The Hard Part)

Web browsers suspend JavaScript when the screen is locked. The system uses a **layered fallback approach**:

| Layer | Method | When It Works |
|-------|--------|---------------|
| 1 | Screen Wake Lock API | Keeps screen on while app is in foreground |
| 2 | Web Push Notifications | Server nudges staff to reopen app after 2min silence |
| 3 | Periodic Background Sync | Chrome Android with installed PWA (~15min intervals) |
| 4 | Offline IndexedDB Buffer | Stores locations locally, syncs when app returns |
| Fallback | Graceful degradation | Patient sees last position + "may be outdated" warning |

**For guaranteed continuous background tracking:** Generate a free APK wrapper using Bubblewrap/PWABuilder that adds a native foreground service. See `docs/staff-background-tracking-guide.md`.

## Legal Compliance

Fully compliant with:
- **India DPDP Act 2023** — explicit consent, purpose limitation, automatic 24h purge
- **India IT Act 2000** — AES-256-GCM encryption, reasonable security practices
- **EU GDPR** — granular consent, right to erasure, privacy by design
- **Not surveillance** — voluntary, time-limited, purpose-specific, both parties consent

See `docs/consent-legal-pack.md` for full legal analysis.

## Security

- HTTPS everywhere (Traefik + Let's Encrypt)
- JWT authentication (24h expiry, role-based)
- AES-256-GCM encryption at rest for all PII
- SHA-256 immutable consent chain (DB triggers block mutations)
- Server-side Kalman filter rejects GPS spoofing/glitches
- Rate limiting (100 req/min per IP)
- CSP, HSTS, CORS headers
- Automatic data purge (24h TTL)

## Production Deployment

### Oracle Cloud Free Tier (recommended, truly free)

```bash
# SSH into your VM, then:
export DOMAIN=track.yourdomain.com
export ADMIN_EMAIL=you@yourdomain.com
curl -fsSL https://raw.githubusercontent.com/varolyn/varolyn-tracker/main/infrastructure/deploy-free-vm.sh | bash
```

This will:
1. Install Docker
2. Generate all secrets (JWT, VAPID, encryption keys)
3. Download OSRM routing data for your region
4. Download free GeoIP database
5. Build and start all services
6. Set up HTTPS via Let's Encrypt

### Generate VAPID Keys

```bash
npm run generate:vapid
# Copy output to .env
```

## Monitoring (Optional)

```bash
# Start with Prometheus + Grafana
docker compose --profile monitoring up -d

# Grafana: http://localhost:3001 (admin/admin)
# Prometheus: http://localhost:9090
```

## License

MIT License. All dependencies are open-source with permissive licenses.
