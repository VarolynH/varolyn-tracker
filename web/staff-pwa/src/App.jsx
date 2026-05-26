import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGeolocation } from './hooks/useGeolocation';
import { useWebSocket } from './hooks/useWebSocket';
import { usePushNotifications } from './hooks/usePushNotifications';

const API_BASE = import.meta.env.VITE_API_URL || '';
const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${window.location.host}`;

export default function App() {
  // ── Auth state ─────────────────────────────────────────
  const [token, setToken] = useState(() => localStorage.getItem('varolyn_token'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('varolyn_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');

  // ── Tracking state ─────────────────────────────────────
  const [activeAppointment, setActiveAppointment] = useState(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const [locationCount, setLocationCount] = useState(0);
  const [lastAck, setLastAck] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  // ── Geolocation hook ───────────────────────────────────
  const {
    position, error: geoError, isTracking, isBackground,
    wakeLockActive, batteryLevel,
  } = useGeolocation({ enabled: trackingActive, highAccuracy: true });

  // ── WebSocket hook ─────────────────────────────────────
  const wsUrl = activeAppointment
    ? `${WS_BASE}/ws/track/${activeAppointment.id}`
    : null;

  const handleWsMessage = useCallback((data) => {
    if (data.type === 'ack') {
      setLastAck(data.ts);
      setLocationCount((c) => c + 1);
    }
    if (data.type === 'tracking_complete') {
      setTrackingActive(false);
      setStatusMessage('Tracking session completed.');
    }
    if (data.type === 'authenticated') {
      setStatusMessage('Connected. Sharing location...');
    }
    if (data.type === 'outlier_rejected') {
      // GPS glitch rejected by server
    }
  }, []);

  const { status: wsStatus, send: wsSend, close: wsClose } = useWebSocket({
    url: wsUrl,
    token,
    enabled: trackingActive && !!activeAppointment,
    onMessage: handleWsMessage,
  });

  // ── Push notifications ─────────────────────────────────
  const { isSubscribed, subscribe: subscribePush } = usePushNotifications({ token });

  // ── Send location updates via WebSocket ────────────────
  const lastSentRef = useRef(0);
  useEffect(() => {
    if (!position || !trackingActive || wsStatus !== 'connected') return;

    // Adaptive interval: faster when moving, slower when stationary
    const speed = position.speed || 0;
    let minInterval = 5000; // 5s default
    if (speed > 10) minInterval = 2000;      // >36km/h: every 2s
    else if (speed > 2) minInterval = 3000;   // walking: every 3s
    else if (speed < 0.5) minInterval = 10000; // stationary: every 10s

    const now = Date.now();
    if (now - lastSentRef.current < minInterval) return;
    lastSentRef.current = now;

    wsSend({
      type: 'location',
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy,
      altitude: position.altitude,
      speed: position.speed,
      heading: position.heading,
      batteryLevel,
      isForeground: !isBackground,
      timestamp: position.timestamp,
    });
  }, [position, trackingActive, wsStatus, wsSend, isBackground, batteryLevel]);

  // ── Visibility change: notify server ───────────────────
  useEffect(() => {
    if (!trackingActive || wsStatus !== 'connected') return;
    wsSend({ type: 'visibility', visible: !isBackground });
  }, [isBackground, trackingActive, wsStatus, wsSend]);

  // ── Store tracking state in IndexedDB for SW ───────────
  useEffect(() => {
    if (!trackingActive || !activeAppointment) return;
    const storeState = async () => {
      try {
        const req = indexedDB.open('varolyn-staff', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('tracking-state', 'readwrite');
          tx.objectStore('tracking-state').put({
            active: true,
            appointmentId: activeAppointment.id,
            token,
            lastLocationTime: Date.now(),
          }, 'current');
        };
      } catch {}
    };
    storeState();
  }, [trackingActive, activeAppointment, token, position]);

  // ── Fetch active appointments ──────────────────────────
  const fetchActiveAppointments = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/appointments/staff/active`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.appointments?.length > 0) {
          setActiveAppointment(data.appointments[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchActiveAppointments();
  }, [fetchActiveAppointments]);

  // ── Subscribe to push on login ─────────────────────────
  useEffect(() => {
    if (token && !isSubscribed) {
      subscribePush();
    }
  }, [token, isSubscribed, subscribePush]);

  // ── Login handler ──────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || 'Login failed'); return; }
      localStorage.setItem('varolyn_token', data.token);
      localStorage.setItem('varolyn_user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setLoginError('Network error');
    }
  };

  // ── Start/Stop tracking ────────────────────────────────
  const startTracking = () => {
    setTrackingActive(true);
    setLocationCount(0);
    setStatusMessage('Starting location sharing...');
  };

  const stopTracking = () => {
    if (activeAppointment) {
      wsSend({ type: 'status', status: 'completed' });
    }
    setTrackingActive(false);
    setStatusMessage('Tracking stopped.');
    wsClose();
  };

  const updateStatus = (newStatus) => {
    wsSend({ type: 'status', status: newStatus });
    setStatusMessage(`Status updated: ${newStatus}`);
  };

  // ── Logout ─────────────────────────────────────────────
  const logout = () => {
    stopTracking();
    localStorage.removeItem('varolyn_token');
    localStorage.removeItem('varolyn_user');
    setToken(null);
    setUser(null);
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  // Login screen
  if (!token || !user) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.logo}>Varolyn</h1>
          <h2 style={styles.subtitle}>Staff Portal</h2>
          <form onSubmit={handleLogin} style={styles.form}>
            <input
              type="email" placeholder="Email" required
              value={loginForm.email}
              onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              style={styles.input}
            />
            <input
              type="password" placeholder="Password" required
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              style={styles.input}
            />
            <button type="submit" style={styles.btnPrimary}>Sign In</button>
            {loginError && <p style={styles.error}>{loginError}</p>}
          </form>
        </div>
      </div>
    );
  }

  // Main tracking interface
  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.headerTitle}>Varolyn Staff</h1>
          <p style={styles.headerSub}>{user.fullName}</p>
        </div>
        <button onClick={logout} style={styles.btnSmall}>Logout</button>
      </header>

      {/* Background warning banner */}
      {trackingActive && (
        <div style={styles.banner}>
          <span style={styles.bannerIcon}>📍</span>
          <span style={styles.bannerText}>
            {isBackground
              ? '⚠️ App is in background — location updates paused. Please return to this screen.'
              : wakeLockActive
                ? '✅ Screen wake lock active. Location sharing continuously.'
                : '⚠️ Keep this app open and screen active for uninterrupted tracking.'}
          </span>
        </div>
      )}

      {/* Status card */}
      <div style={styles.card}>
        {/* Connection status indicators */}
        <div style={styles.statusRow}>
          <StatusBadge label="WebSocket" status={wsStatus} />
          <StatusBadge label="GPS" status={isTracking ? 'active' : 'inactive'} />
          <StatusBadge label="Wake Lock" status={wakeLockActive ? 'active' : 'inactive'} />
          <StatusBadge label="Push" status={isSubscribed ? 'active' : 'inactive'} />
        </div>

        {statusMessage && <p style={styles.statusMsg}>{statusMessage}</p>}
        {geoError && <p style={styles.error}>GPS Error: {geoError}</p>}

        {/* Active appointment info */}
        {activeAppointment ? (
          <div style={styles.appointmentCard}>
            <h3 style={styles.apptTitle}>{activeAppointment.service_type}</h3>
            <p style={styles.apptDetail}>Patient: {activeAppointment.patient_name}</p>
            <p style={styles.apptDetail}>Address: {activeAppointment.patient_address || 'See map'}</p>
            <p style={styles.apptDetail}>
              Scheduled: {new Date(activeAppointment.scheduled_at).toLocaleString('en-IN')}
            </p>
            <p style={styles.apptDetail}>Status: <strong>{activeAppointment.status}</strong></p>
          </div>
        ) : (
          <p style={styles.noAppt}>No active appointments. You'll be notified when one starts.</p>
        )}

        {/* Tracking controls */}
        {activeAppointment && !trackingActive && (
          <button onClick={startTracking} style={styles.btnStart}>
            ▶ Start Location Sharing
          </button>
        )}

        {trackingActive && (
          <div style={styles.trackingControls}>
            <div style={styles.stats}>
              <div style={styles.stat}>
                <span style={styles.statNum}>{locationCount}</span>
                <span style={styles.statLabel}>Points Sent</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statNum}>
                  {position ? `${position.accuracy?.toFixed(0) || '?'}m` : '—'}
                </span>
                <span style={styles.statLabel}>Accuracy</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statNum}>
                  {position?.speed ? `${(position.speed * 3.6).toFixed(1)} km/h` : '0'}
                </span>
                <span style={styles.statLabel}>Speed</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statNum}>
                  {batteryLevel !== null ? `${Math.round(batteryLevel * 100)}%` : '—'}
                </span>
                <span style={styles.statLabel}>Battery</span>
              </div>
            </div>

            {/* Status update buttons */}
            <div style={styles.statusButtons}>
              <button onClick={() => updateStatus('arrived')} style={styles.btnStatus}>
                📍 Arrived
              </button>
              <button onClick={() => updateStatus('in_progress')} style={styles.btnStatus}>
                🏥 Service Started
              </button>
              <button onClick={stopTracking} style={styles.btnStop}>
                ⏹ Complete & Stop
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Position debug info */}
      {position && trackingActive && (
        <div style={styles.card}>
          <h4 style={styles.debugTitle}>Live Position</h4>
          <pre style={styles.debugPre}>
            {JSON.stringify({
              lat: position.lat?.toFixed(6),
              lng: position.lng?.toFixed(6),
              accuracy: position.accuracy?.toFixed(1),
              speed: position.speed?.toFixed(2),
              heading: position.heading?.toFixed(0),
              foreground: !isBackground,
            }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Status badge component ───────────────────────────────
function StatusBadge({ label, status }) {
  const colors = {
    connected: '#22c55e', active: '#22c55e',
    connecting: '#f59e0b',
    disconnected: '#ef4444', inactive: '#6b7280',
    error: '#ef4444',
  };
  return (
    <div style={styles.badge}>
      <span style={{ ...styles.badgeDot, background: colors[status] || '#6b7280' }} />
      <span style={styles.badgeLabel}>{label}</span>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────
const styles = {
  container: { minHeight: '100vh', background: '#f5f7fa', padding: '0' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', background: '#0066cc', color: 'white',
  },
  headerTitle: { fontSize: '20px', fontWeight: '700', margin: 0 },
  headerSub: { fontSize: '13px', opacity: 0.8, margin: 0 },
  btnSmall: {
    background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
    padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
  },
  banner: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 16px', background: '#fef3c7', borderBottom: '1px solid #f59e0b',
  },
  bannerIcon: { fontSize: '18px' },
  bannerText: { fontSize: '13px', color: '#92400e', lineHeight: 1.3 },
  card: { margin: '16px', padding: '20px', background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  logo: { fontSize: '28px', color: '#0066cc', textAlign: 'center', margin: '40px 0 4px' },
  subtitle: { fontSize: '16px', color: '#666', textAlign: 'center', marginBottom: '24px', fontWeight: '400' },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '14px 16px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', outline: 'none' },
  btnPrimary: {
    padding: '14px', background: '#0066cc', color: 'white', border: 'none',
    borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer',
  },
  error: { color: '#ef4444', fontSize: '13px', textAlign: 'center' },
  statusRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' },
  badge: { display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: '#f9fafb', borderRadius: '12px' },
  badgeDot: { width: '8px', height: '8px', borderRadius: '50%' },
  badgeLabel: { fontSize: '11px', color: '#666' },
  statusMsg: { fontSize: '13px', color: '#374151', marginBottom: '12px' },
  appointmentCard: { padding: '12px', background: '#f0f9ff', borderRadius: '8px', marginBottom: '16px' },
  apptTitle: { fontSize: '16px', color: '#0066cc', margin: '0 0 8px' },
  apptDetail: { fontSize: '13px', color: '#4b5563', margin: '4px 0' },
  noAppt: { fontSize: '14px', color: '#6b7280', textAlign: 'center', padding: '20px' },
  btnStart: {
    width: '100%', padding: '16px', background: '#22c55e', color: 'white',
    border: 'none', borderRadius: '10px', fontSize: '18px', fontWeight: '700', cursor: 'pointer',
  },
  trackingControls: {},
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' },
  stat: { textAlign: 'center', padding: '8px', background: '#f9fafb', borderRadius: '8px' },
  statNum: { display: 'block', fontSize: '16px', fontWeight: '700', color: '#111' },
  statLabel: { fontSize: '10px', color: '#6b7280' },
  statusButtons: { display: 'flex', flexDirection: 'column', gap: '8px' },
  btnStatus: {
    padding: '12px', background: '#f0f9ff', border: '1px solid #bfdbfe',
    borderRadius: '8px', fontSize: '14px', cursor: 'pointer', textAlign: 'center',
  },
  btnStop: {
    padding: '14px', background: '#ef4444', color: 'white', border: 'none',
    borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer',
  },
  debugTitle: { fontSize: '13px', color: '#6b7280', margin: '0 0 8px' },
  debugPre: { fontSize: '12px', background: '#f9fafb', padding: '8px', borderRadius: '6px', overflow: 'auto' },
};
