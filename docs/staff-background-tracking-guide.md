# Staff Background Tracking Guide

## How Location Sharing Works

The Varolyn Staff Tracker is a **Progressive Web App (PWA)** that runs in your phone's browser. It uses your phone's GPS to share your location with patients in real-time during healthcare visits.

## The Background Tracking Challenge

Web browsers limit what apps can do when the screen is locked or the browser is in the background. Unlike native apps (like Google Maps), a web app cannot continuously access GPS when you switch away from it.

### What Happens When You Lock Your Screen

| Scenario | Location Sharing | What the Patient Sees |
|----------|-----------------|----------------------|
| App open, screen on | Continuous (every 2-5 seconds) | Smooth real-time movement |
| App open, screen locked | **Paused** (no GPS access) | Last known position + "Location may be outdated" |
| App in background (switched to another app) | **Paused** | Last known position + warning |
| App returns to foreground | **Immediately resumes** | Live tracking resumes |

### What We Do to Maximize Background Tracking

The app uses a **layered approach** to keep tracking as reliable as possible:

#### Layer 1: Screen Wake Lock
When you start tracking, the app requests a **Screen Wake Lock** that prevents your screen from automatically dimming or turning off. This keeps the GPS active as long as you don't manually lock your phone.

#### Layer 2: Push Notifications
If the server detects that it hasn't received your location for 2+ minutes, it sends a **high-priority push notification** to your phone:
- "Location Sharing Paused — tap to resume"
- Tapping this notification brings the app back to the foreground
- GPS immediately resumes

#### Layer 3: Periodic Background Sync
On Android with Chrome, if you've installed the PWA, the browser can periodically wake up the app in the background. This allows us to send any buffered location data.

#### Layer 4: Offline Buffering
If you lose internet connection, the app stores location points locally and sends them all when connectivity resumes.

## Best Practices for Staff

### During Active Tracking:

1. **Keep the app open and visible** during your journey to the patient
2. **Don't manually lock your screen** while en route — the wake lock will keep it on
3. If you must lock your screen, **tap the push notification** when it appears to resume tracking
4. **Install the PWA**: When Chrome shows "Add to Home Screen", tap it. This enables better background support.

### Battery Tips:

- The app uses **adaptive intervals**: it sends locations more frequently when you're moving fast, less when stationary
- Battery impact is similar to using Google Maps navigation
- Average impact: ~5-8% per hour of active tracking
- Tracking automatically stops when you mark the visit as complete

### Troubleshooting:

| Problem | Solution |
|---------|----------|
| "GPS Error" message | Check that Location permission is set to "Allow" in browser settings |
| No push notifications | Ensure Notifications are enabled in browser settings |
| Location accuracy poor | Move away from tall buildings; wait for GPS lock (usually 5-10 seconds) |
| WebSocket disconnected | Check internet connection; the app will auto-reconnect |

## Optional: Install as Android APK (for true background tracking)

For **guaranteed continuous background tracking**, even with the screen locked, you can install a thin APK wrapper that runs the same web app with a native background location service.

### Steps to Generate APK (Free, using Bubblewrap):

```bash
# 1. Install Bubblewrap
npm install -g @nicolo-ribaudo/bubblewrap

# 2. Initialize the project
bubblewrap init --manifest https://your-domain/staff/manifest.json

# 3. Edit twa-manifest.json to add location permissions:
#    "enableLocationDelegation": true

# 4. Build the APK
bubblewrap build

# 5. Sign and install
#    The generated APK uses a Trusted Web Activity (TWA)
#    which runs your exact web app with full background location.
```

The APK is **free to build** and doesn't require a Play Store listing — you can distribute it directly to staff via your admin portal.

### Key Advantage of APK:
- Background location continues even with screen locked
- Uses the exact same web app (no separate codebase)
- Uses Android's foreground service for persistent GPS access
- Shows a persistent notification: "Varolyn Tracker — sharing your location"

## Privacy & Security

- Your location is **only shared during active tracking sessions**
- Location data is **encrypted** in transit (TLS 1.3) and at rest (AES-256-GCM)
- All location data is **automatically deleted within 24 hours**
- Patients must **explicitly consent** before they can see your location
- You can **stop tracking at any time** by tapping "Complete & Stop"
