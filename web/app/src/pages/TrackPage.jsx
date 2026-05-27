import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const API = '';

// CartoDB Voyager tiles — free, reliable, CORS-friendly
const MAP_STYLE = {
  version: 8,
  sources: {
    'carto-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  layers: [{ id: 'base-tiles', type: 'raster', source: 'carto-tiles' }],
};

/**
 * TrackPage — PUBLIC customer-facing page
 * Full-screen live map with staff location, route trail, speed, battery
 * NO email, phone, IP, device details — those are admin-only
 */
export default function TrackPage() {
  const { token } = useParams();
  const [session, setSession] = useState(null);
  const [location, setLocation] = useState(null);
  const [battery, setBattery] = useState({});
  const [network, setNetwork] = useState({});
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [ago, setAgo] = useState('');
  const [route, setRoute] = useState([]);
  const [isStale, setIsStale] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  const sseRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const routeRef = useRef([]);

  // ── Fetch session data ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/track/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data.error || 'Not found'); return; }
        setSession(data);
        if (data.location) {
          setLocation(data.location);
          setLastUpdate(new Date(data.location.updatedAt));
        }
        if (data.battery) setBattery(data.battery);
        if (data.network) setNetwork(data.network);
      } catch { if (!cancelled) setError('Cannot connect to server'); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── Fetch route trail ──
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const fetchRoute = async () => {
      try {
        const res = await fetch(`${API}/api/track/${token}/route`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.route) {
            setRoute(data.route);
            routeRef.current = data.route.map(p => [p.lng, p.lat]);
          }
        }
      } catch {}
    };
    fetchRoute();
    const id = setInterval(fetchRoute, 30000); // refresh trail every 30s
    return () => { cancelled = true; clearInterval(id); };
  }, [session, token]);

  // ── SSE connection ──
  useEffect(() => {
    if (!session) return;
    let reconnectTimer = null;

    const connectSSE = () => {
      if (sseRef.current) { try { sseRef.current.close(); } catch {} }
      const es = new EventSource(`${API}/sse/${token}`);
      sseRef.current = es;

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'location_update') {
            const newLoc = { lat: msg.lat, lng: msg.lng, accuracy: msg.accuracy, speed: msg.speed, heading: msg.heading };
            setLocation(newLoc);
            setLastUpdate(new Date());
            setIsStale(false);
            if (msg.battery) setBattery(msg.battery);
            if (msg.network) setNetwork(msg.network);
            // Add to route trail
            routeRef.current = [...routeRef.current, [msg.lng, msg.lat]].slice(-200);
            setRoute(prev => [...prev, { lat: msg.lat, lng: msg.lng, speed: msg.speed, ts: new Date().toISOString() }].slice(-200));
          } else if (msg.type === 'session_ended') {
            setError('Tracking session has ended');
            es.close();
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        reconnectTimer = setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();
    return () => {
      if (sseRef.current) sseRef.current.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [session, token]);

  // ── Time ago ticker ──
  useEffect(() => {
    if (!lastUpdate) return;
    const tick = () => {
      const s = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
      setAgo(s < 5 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`);
      setIsStale(s > 90);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdate]);

  // ── Initialize map ──
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: location ? [location.lng, location.lat] : [87.85, 23.25], // Default to West Bengal
      zoom: location ? 15 : 10,
      attributionControl: false,
      failIfMajorPerformanceCaveat: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      setMapReady(true);

      // Add route trail source + layer
      map.addSource('route-trail', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
      });
      map.addLayer({
        id: 'route-trail-line',
        type: 'line',
        source: 'route-trail',
        paint: {
          'line-color': '#0d9488',
          'line-width': 4,
          'line-opacity': 0.7,
          'line-dasharray': [2, 1],
        },
      });
      // Route trail glow
      map.addLayer({
        id: 'route-trail-glow',
        type: 'line',
        source: 'route-trail',
        paint: {
          'line-color': '#0d9488',
          'line-width': 12,
          'line-opacity': 0.15,
        },
      }, 'route-trail-line');
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; setMapReady(false); };
  }, []);

  // ── Update marker + route trail ──
  useEffect(() => {
    if (!mapReady || !mapRef.current || !location) return;
    const map = mapRef.current;

    // Update route trail
    if (routeRef.current.length > 1) {
      try {
        const src = map.getSource('route-trail');
        if (src) {
          src.setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: routeRef.current },
          });
        }
      } catch {}
    }

    // Create or update marker
    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = 'track-marker';
      el.innerHTML = `
        <div class="track-marker-pulse"></div>
        <div class="track-marker-dot">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" stroke="none">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
        </div>
      `;
      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([location.lng, location.lat])
        .addTo(map);
      map.flyTo({ center: [location.lng, location.lat], zoom: 16, speed: 1.2 });
    } else {
      markerRef.current.setLngLat([location.lng, location.lat]);
      map.easeTo({ center: [location.lng, location.lat], duration: 1200 });
    }
  }, [location, mapReady, route]);

  // ── Error states ──
  if (error) return (
    <div className="track-error-page">
      <div className="track-error-card">
        <div className="track-error-icon">{error.includes('ended') || error.includes('expired') ? '⏱️' : '🔗'}</div>
        <h2>{error.includes('ended') || error.includes('expired') ? 'Session Ended' : 'Link Invalid'}</h2>
        <p>{error}</p>
        <p className="track-error-sub">
          {error.includes('ended') || error.includes('expired')
            ? 'The healthcare staff has stopped sharing their location.'
            : 'This tracking link may be invalid or has expired.'}
        </p>
        <div className="track-error-brand">Varolyn Healthcare</div>
      </div>
    </div>
  );

  if (!session) return (
    <div className="track-error-page">
      <div className="track-error-card">
        <div className="track-loading-spinner" />
        <h2>Connecting...</h2>
        <p>Loading tracking session</p>
        <div className="track-error-brand">Varolyn Healthcare</div>
      </div>
    </div>
  );

  const speedKmh = location?.speed > 0 ? (location.speed * 3.6).toFixed(0) : null;
  const accuracyM = location?.accuracy ? Math.round(location.accuracy) : null;
  const battLevel = battery?.level != null ? battery.level : null;
  const netType = network?.type || null;
  const initial = (session.staffName || '?')[0].toUpperCase();

  return (
    <div className="track-page-v2">
      {/* Full-screen map */}
      <div ref={mapContainerRef} className="track-map-full" />

      {/* Top bar */}
      <div className="track-topbar">
        <div className="track-topbar-left">
          <div className={`track-live-badge ${isStale ? 'stale' : ''}`}>
            <span className="track-live-dot" />
            {isStale ? 'RECONNECTING' : 'LIVE'}
          </div>
        </div>
        <div className="track-topbar-brand">Varolyn Healthcare</div>
      </div>

      {/* Bottom info panel */}
      <div className={`track-bottom-panel ${panelOpen ? 'open' : 'collapsed'}`}>
        <div className="track-panel-handle" onClick={() => setPanelOpen(!panelOpen)}>
          <div className="track-panel-bar" />
        </div>

        <div className="track-staff-row">
          <div className="track-avatar">{initial}</div>
          <div className="track-staff-info">
            <h3>{session.staffName}</h3>
            {session.designation && <p>{session.designation}</p>}
          </div>
          {lastUpdate && <div className="track-time">{ago}</div>}
        </div>

        {panelOpen && (
          <div className="track-details">
            <div className="track-stats-grid">
              {speedKmh && (
                <div className="track-stat">
                  <span className="track-stat-icon">🚗</span>
                  <span className="track-stat-val">{speedKmh}</span>
                  <span className="track-stat-unit">km/h</span>
                </div>
              )}
              {accuracyM && (
                <div className="track-stat">
                  <span className="track-stat-icon">📍</span>
                  <span className="track-stat-val">±{accuracyM}</span>
                  <span className="track-stat-unit">m</span>
                </div>
              )}
              {battLevel != null && (
                <div className="track-stat">
                  <span className="track-stat-icon">{battLevel > 20 ? '🔋' : '🪫'}</span>
                  <span className="track-stat-val">{battLevel}</span>
                  <span className="track-stat-unit">%</span>
                </div>
              )}
              {netType && (
                <div className="track-stat">
                  <span className="track-stat-icon">📡</span>
                  <span className="track-stat-val">{netType.toUpperCase()}</span>
                  <span className="track-stat-unit"></span>
                </div>
              )}
            </div>

            {!location && (
              <div className="track-waiting">
                <div className="track-loading-spinner small" />
                <p>Waiting for staff to start sharing location...</p>
              </div>
            )}

            {isStale && location && (
              <div className="track-stale-warning">
                Staff device may be offline. Last location shown.
              </div>
            )}

            {route.length > 1 && (
              <div className="track-route-info">
                <span className="track-route-dot" />
                {route.length} location points in last 30 min
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center-on-location button */}
      {location && (
        <button
          className="track-center-btn"
          onClick={() => {
            if (mapRef.current) {
              mapRef.current.flyTo({ center: [location.lng, location.lat], zoom: 16, speed: 1.5 });
            }
          }}
          title="Center on staff"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
          </svg>
        </button>
      )}
    </div>
  );
}
