import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConsentScreen } from './components/ConsentScreen';
import { TrackingMap } from './components/TrackingMap';
import { StatusPanel } from './components/StatusPanel';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SSE_BASE = import.meta.env.VITE_SSE_URL || '';

export default function App() {
  const [token, setToken] = useState(() => {
    // Extract token from URL: /track/:token
    const path = window.location.pathname;
    const match = path.match(/\/track\/([A-Za-z0-9]{6,12})/);
    return match ? match[1] : null;
  });

  const [linkData, setLinkData] = useState(null);
  const [consentStatus, setConsentStatus] = useState(null); // null | 'pending' | 'granted' | 'denied'
  const [trackingData, setTrackingData] = useState(null);  // Latest location
  const [etaData, setEtaData] = useState(null);
  const [appointmentInfo, setAppointmentInfo] = useState(null);
  const [error, setError] = useState(null);
  const [staffStatus, setStaffStatus] = useState('waiting');
  const [isStale, setIsStale] = useState(false);

  const eventSourceRef = useRef(null);
  const staleTimerRef = useRef(null);

  // ── Resolve tracking link ──────────────────────────────
  useEffect(() => {
    if (!token) {
      setError('Invalid tracking link. Please check the URL you received.');
      return;
    }

    const resolveLink = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/link/resolve/${token}`);
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || 'Tracking link is invalid or expired.');
          return;
        }
        const data = await res.json();
        setLinkData(data);
        setConsentStatus(data.hasConsent ? 'granted' : 'pending');
      } catch (err) {
        setError('Unable to connect. Please check your internet and try again.');
      }
    };
    resolveLink();
  }, [token]);

  // ── Handle consent grant ───────────────────────────────
  const handleConsentGrant = async (consents) => {
    try {
      const res = await fetch(`${API_BASE}/api/consent/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, consents }),
      });
      if (res.ok) {
        setConsentStatus('granted');
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to record consent.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  };

  // ── SSE connection for live tracking ───────────────────
  useEffect(() => {
    if (consentStatus !== 'granted' || !token) return;

    const sseUrl = `${SSE_BASE}/sse/track/${token}`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.addEventListener('location_update', (e) => {
      const data = JSON.parse(e.data);
      setTrackingData(data);
      setStaffStatus('en_route');
      setIsStale(false);

      // Reset stale timer
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = setTimeout(() => setIsStale(true), 120000); // 2 min
    });

    es.addEventListener('eta_update', (e) => {
      setEtaData(JSON.parse(e.data));
    });

    es.addEventListener('status_update', (e) => {
      const data = JSON.parse(e.data);
      setStaffStatus(data.status);
      if (data.status === 'completed') {
        es.close();
      }
    });

    es.addEventListener('appointment_info', (e) => {
      setAppointmentInfo(JSON.parse(e.data));
    });

    es.addEventListener('visibility_change', (e) => {
      const data = JSON.parse(e.data);
      if (!data.visible) {
        setIsStale(true);
      }
    });

    es.addEventListener('tracking_revoked', () => {
      setError('Tracking has been stopped. Data has been deleted per your request.');
      es.close();
    });

    es.onerror = () => {
      console.warn('[SSE] Connection error, will retry...');
    };

    return () => {
      es.close();
      clearTimeout(staleTimerRef.current);
    };
  }, [consentStatus, token]);

  // ── Handle consent revocation ──────────────────────────
  const handleRevoke = async () => {
    try {
      await fetch(`${API_BASE}/api/consent/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setConsentStatus('denied');
      setTrackingData(null);
      if (eventSourceRef.current) eventSourceRef.current.close();
    } catch {}
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  // Error state
  if (error) {
    return (
      <div style={styles.centerScreen}>
        <div style={styles.errorCard}>
          <span style={{ fontSize: '48px' }}>⚠️</span>
          <h2 style={{ margin: '16px 0 8px', color: '#991b1b' }}>Oops</h2>
          <p style={{ color: '#666', lineHeight: 1.5 }}>{error}</p>
        </div>
      </div>
    );
  }

  // Loading
  if (!linkData) {
    return (
      <div style={styles.centerScreen}>
        <div style={styles.spinner} />
        <p style={{ marginTop: '16px', color: '#666' }}>Loading tracking information...</p>
      </div>
    );
  }

  // Consent screen
  if (consentStatus === 'pending') {
    return <ConsentScreen linkData={linkData} onConsent={handleConsentGrant} />;
  }

  // Revoked
  if (consentStatus === 'denied') {
    return (
      <div style={styles.centerScreen}>
        <div style={styles.errorCard}>
          <span style={{ fontSize: '48px' }}>🔒</span>
          <h2 style={{ margin: '16px 0 8px' }}>Tracking Stopped</h2>
          <p style={{ color: '#666' }}>Your consent has been revoked and all location data deleted.</p>
        </div>
      </div>
    );
  }

  // Live tracking view
  return (
    <div style={styles.trackingContainer}>
      {/* Map */}
      <TrackingMap
        staffLocation={trackingData}
        destination={linkData ? {
          lat: linkData.destinationLat,
          lng: linkData.destinationLng,
        } : null}
        isStale={isStale}
      />

      {/* Status panel overlay */}
      <StatusPanel
        staffName={linkData?.staffName}
        staffPhoto={linkData?.staffPhoto}
        serviceType={linkData?.serviceType}
        status={staffStatus}
        eta={etaData}
        isStale={isStale}
        lastUpdate={trackingData?.timestamp}
        onRevoke={handleRevoke}
      />
    </div>
  );
}

const styles = {
  centerScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', padding: '24px', background: '#f9fafb',
  },
  errorCard: {
    textAlign: 'center', padding: '32px', background: 'white',
    borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxWidth: '360px',
  },
  spinner: {
    width: '40px', height: '40px', border: '3px solid #e5e7eb',
    borderTop: '3px solid #0066cc', borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  trackingContainer: { position: 'relative', width: '100%', height: '100vh' },
};
