# Architecture Document

## System Overview

Varolyn Tracker is a real-time healthcare staff location tracking system, architecturally similar to food delivery tracking (Zomato/Swiggy) but purpose-built for home healthcare visits. It is 100% web-based (PWA), fully self-hosted, and free to operate.

## Architecture Diagram

```
                                    ┌─────────────────────┐
                                    │   Patient's Phone   │
                                    │  (Customer PWA)     │
                                    │  MapLibre + SSE     │
                                    └────────┬────────────┘
                                             │ SSE (Server-Sent Events)
                                             ▼
┌─────────────────────┐           ┌──────────────────────┐
│   Staff's Phone     │           │    Traefik Gateway   │
│  (Staff PWA)        │           │   (Reverse Proxy)    │
│  GPS + Wake Lock    │           │   HTTPS / WSS / SSE  │
│  + Service Worker   │           └──────────┬───────────┘
└────────┬────────────┘                      │
         │ WebSocket (wss://)                │ Routes to services
         ▼                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Microservices                      │
│                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ Tracking │ │ Consent  │ │Appointment│ │ Notification │   │
│  │ Service  │ │ Service  │ │ Service   │ │  Service     │   │
│  │ WS + SSE │ │ SHA-256  │ │ CRUD     │ │ Web Push +   │   │
│  │ Kalman   │ │ Chain    │ │ + Links  │ │ Email        │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘   │
│       │             │            │               │           │
│       └─────────────┴────────────┴───────────────┘           │
│                            │                                  │
│                    ┌───────┴───────┐                          │
│                    │ Redis Pub/Sub │                          │
│                    └───────┬───────┘                          │
│                            │                                  │
│  ┌──────────┐ ┌──────────┐│┌──────────┐ ┌──────────┐       │
│  │  Audit   │ │   Link   │││  Admin   │ │  OSINT   │       │
│  │ Service  │ │  Service │││ Service  │ │ Service  │       │
│  └──────────┘ └──────────┘│└──────────┘ └──────────┘       │
└───────────────────────────┼──────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
     ┌────────▼──────┐ ┌───▼───┐  ┌──────▼──────┐
     │ PostgreSQL +  │ │ Redis │  │    OSRM     │
     │ TimescaleDB   │ │       │  │ (Routing)   │
     │               │ │       │  │             │
     └───────────────┘ └───────┘  └─────────────┘
```

## Real-Time Data Flow

### Location Ingestion (Staff → Server → Patient)

```
1. Staff PWA: navigator.geolocation.watchPosition()
   ↓ (3-5 second intervals, adaptive based on speed)
2. WebSocket message: { type: "location", lat, lng, accuracy, speed, heading }
   ↓
3. Tracking Service:
   a. Validate coordinates (bounds check, type check)
   b. Apply server-side Kalman filter (reject outliers, smooth jitter)
   c. Batch insert into TimescaleDB (location_history hypertable)
   d. Publish to Redis channel: tracking:{appointmentId}
   e. Cache latest position in Redis: latest:{appointmentId} (TTL 120s)
   f. Compute ETA via OSRM every 30s (or on >50m deviation)
   ↓
4. Redis Pub/Sub broadcasts to all subscribers
   ↓
5. SSE endpoint for patient:
   a. Subscribes to tracking:{appointmentId} Redis channel
   b. Forwards events as SSE: event: location_update\ndata: {...}\n\n
   ↓
6. Customer PWA:
   a. Receives SSE event
   b. Smooth marker animation (cubic ease-out, dead-reckoning between updates)
   c. Updates ETA display
```

### Background Tracking Strategy

```
Priority 1: Screen Wake Lock API
  → Prevents screen dim/off while app is in foreground
  → Released when user manually locks screen

Priority 2: Web Push Notifications
  → Server detects no location for 2+ minutes
  → Sends high-priority push: "Tap to resume tracking"
  → Notification click brings PWA to foreground → GPS resumes

Priority 3: Periodic Background Sync
  → Chrome Android with installed PWA
  → Fires every ~15 minutes
  → Sends buffered locations, shows re-engagement notification

Priority 4: Offline IndexedDB Buffer
  → Locations stored locally when offline
  → Background Sync API sends batch when online

Fallback: Graceful degradation
  → Patient sees last known position + "may be outdated" warning
  → Timestamp shows age of last location
```

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite | Fast builds, excellent PWA support |
| Maps | MapLibre GL JS + OSM tiles | Free, no API keys needed |
| Backend | Node.js + Fastify | High-performance, low overhead |
| Database | PostgreSQL 16 + TimescaleDB | Time-series optimized for location data |
| Cache/PubSub | Redis 7 | Sub-millisecond pub/sub for real-time |
| Routing/ETA | OSRM | Free, self-hosted, accurate routing |
| Push | web-push (VAPID) | Self-hosted, no third-party dependency |
| Email | Nodemailer + SMTP | Works with any SMTP provider |
| Proxy | Traefik | Auto HTTPS via Let's Encrypt |
| Container | Docker Compose | Single-command deployment |

## Security Architecture

### Zero-Trust Principles

1. **All traffic encrypted**: TLS 1.3 via Traefik + Let's Encrypt
2. **JWT authentication**: Short-lived tokens (24h), role-based
3. **Input validation**: All inputs validated at the API gateway
4. **Rate limiting**: 100 req/min per IP at gateway level
5. **CORS**: Strict origin validation
6. **CSP**: Content Security Policy headers
7. **PII encryption**: AES-256-GCM at rest for all personal data
8. **Consent immutability**: SHA-256 chain with DB mutation triggers blocked

### Geolocation Security

- GPS coordinates come from the browser's Geolocation API (trusted context)
- Server-side Kalman filter rejects impossible jumps (>200 km/h)
- Accuracy metadata is stored and displayed to patients
- No mock/spoof detection needed — browser API is the trust boundary

## Scalability

The architecture supports horizontal scaling:

- **Stateless services**: All microservices can be replicated behind a load balancer
- **TimescaleDB**: Automatic time-based partitioning (1-hour chunks)
- **Redis Pub/Sub**: Handles millions of messages/second
- **SSE**: Each connection is lightweight (~4KB memory)
- **Auto-purge**: Data retention policy prevents unbounded growth

For a single VM (Oracle Cloud Free Tier: 4 ARM cores, 24GB RAM), this supports approximately:
- 500+ concurrent tracking sessions
- 10,000+ location points per minute
- 1,000+ SSE connections
