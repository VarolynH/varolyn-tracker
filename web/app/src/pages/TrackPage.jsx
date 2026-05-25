import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import LiveMap from '../components/LiveMap';

const API = '';

/**
 * TrackPage — PUBLIC customer-facing page
 * Shows ONLY: staff name, designation, live location on map, speed, battery level, network type
 * NO email, phone, IP geo, ISP, device details — those are admin-only
 */
export default function TrackPage() {
  const { token } = useParams();
  const [session, setSession]   = useState(null);
  const [location, setLocation] = useState(null);
  const [battery, setBattery]   = useState({});
  const [network, setNetwork]   = useState({});
  const [error, setError]       = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [ago, setAgo] = useState('');
  const sseRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/track/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data.error || 'Not found'); return; }
        setSession(data);
        if (data.location) { setLocation(data.location); setLastUpdate(new Date(data.location.updatedAt)); }
        if (data.battery) setBattery(data.battery);
        if (data.network) setNetwork(data.network);
        connectSSE();
      } catch { if (!cancelled) setError('Cannot connect to server'); }
    })();
    return () => { cancelled = true; if (sseRef.current) sseRef.current.close(); };
  }, [token]);

  const connectSSE = () => {
    const es = new EventSource(`${API}/sse/${token}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'location_update') {
          setLocation({ lat: msg.lat, lng: msg.lng, accuracy: msg.accuracy, speed: msg.speed, heading: msg.heading });
          setLastUpdate(new Date());
          if (msg.battery) setBattery(msg.battery);
          if (msg.network) setNetwork(msg.network);
        } else if (msg.type === 'session_ended') { setError('Tracking session has ended'); es.close(); }
      } catch {}
    };
    es.onerror = () => { es.close(); setTimeout(connectSSE, 5000); };
  };

  useEffect(() => {
    if (!lastUpdate) return;
    const tick = () => {
      const s = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
      setAgo(s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdate]);

  if (error) return (
    <div className="track-error">
      <h1>{error.includes('ended') || error.includes('expired') ? '⏱️' : '🔗'}</h1>
      <p>{error}</p>
      <p style={{ marginTop: 12, fontSize: '.85rem', color: '#9ca3af' }}>
        {error.includes('ended') || error.includes('expired')
          ? 'The staff member has stopped sharing their location.'
          : 'This tracking link may be invalid or expired.'}
      </p>
    </div>
  );

  if (!session) return (
    <div className="track-error">
      <h1 style={{ fontSize: '2rem' }}>Loading...</h1>
      <p>Connecting to tracking session...</p>
    </div>
  );

  return (
    <div className="track-page">
      <LiveMap location={location} />
      <div className="track-info">
        <h2>{session.staffName}</h2>
        {session.designation && <p style={{ color: '#6b7280', fontSize: '.88rem', marginTop: 2 }}>{session.designation}</p>}
        <div className="track-meta">
          {lastUpdate && (
            <span><span className="pulse-dot" style={{ width: 8, height: 8 }} /> {ago}</span>
          )}
          {location?.speed > 0 && <span>🚗 {(location.speed * 3.6).toFixed(0)} km/h</span>}
          {location?.accuracy && <span>📍 ±{location.accuracy.toFixed(0)}m</span>}
          {battery.level != null && <span>🔋 {battery.level}%</span>}
          {network.type && <span>📡 {network.type.toUpperCase()}</span>}
        </div>
        {!location && (
          <p style={{ marginTop: 12, fontSize: '.88rem', color: '#9ca3af' }}>
            Waiting for staff to start sharing location...
          </p>
        )}
      </div>
    </div>
  );
}
