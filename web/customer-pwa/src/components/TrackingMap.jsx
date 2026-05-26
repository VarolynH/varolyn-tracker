import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

/**
 * TrackingMap — MapLibre GL JS with OpenStreetMap tiles (free).
 * Features:
 * - Smooth marker animation (dead-reckoning between updates)
 * - Staff marker with heading indicator
 * - Destination marker
 * - Route path visualization
 * - Auto-fit bounds
 */
export function TrackingMap({ staffLocation, destination, isStale }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const staffMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const animationRef = useRef(null);
  const prevLocationRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // ── Initialize map ─────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: 'osm-tiles-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [77.5946, 12.9716], // Default: Bangalore
      zoom: 13,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      setMapReady(true);
      // Add route line source
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#0066cc',
          'line-width': 4,
          'line-opacity': 0.7,
          'line-dasharray': [2, 1],
        },
      });
    });

    mapRef.current = map;

    return () => map.remove();
  }, []);

  // ── Destination marker ─────────────────────────────────
  useEffect(() => {
    if (!mapReady || !destination || destMarkerRef.current) return;

    const el = document.createElement('div');
    el.innerHTML = `
      <div style="position:relative;">
        <div style="width:36px;height:36px;background:#ef4444;border-radius:50% 50% 50% 0;
                    transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);
                    display:flex;align-items:center;justify-content:center;">
          <span style="transform:rotate(45deg);font-size:16px;">🏠</span>
        </div>
        <div style="font-size:11px;text-align:center;margin-top:4px;color:#333;font-weight:600;
                    background:white;padding:2px 6px;border-radius:4px;white-space:nowrap;">
          Your Location
        </div>
      </div>
    `;

    destMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([destination.lng, destination.lat])
      .addTo(mapRef.current);
  }, [mapReady, destination]);

  // ── Staff marker with animation ────────────────────────
  useEffect(() => {
    if (!mapReady || !staffLocation) return;

    const { lat, lng, heading, speed } = staffLocation;

    if (!staffMarkerRef.current) {
      // Create staff marker
      const el = document.createElement('div');
      el.className = 'staff-marker';
      el.innerHTML = `
        <div style="position:relative;">
          <div id="staff-dot" style="width:44px;height:44px;background:#0066cc;border-radius:50%;
                      border:4px solid white;box-shadow:0 2px 12px rgba(0,102,204,0.4);
                      display:flex;align-items:center;justify-content:center;transition:opacity 0.3s;">
            <span style="font-size:20px;">🏥</span>
          </div>
          <div id="staff-pulse" style="position:absolute;top:-4px;left:-4px;width:52px;height:52px;
                      border-radius:50%;background:rgba(0,102,204,0.2);
                      animation:pulse 2s ease-in-out infinite;"></div>
          <div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);
                      font-size:10px;background:#0066cc;color:white;padding:2px 6px;
                      border-radius:4px;white-space:nowrap;font-weight:600;">
            Staff
          </div>
        </div>
      `;

      // Add pulse animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes pulse { 0%,100% { transform:scale(1); opacity:0.6; } 50% { transform:scale(1.4); opacity:0; } }
      `;
      document.head.appendChild(style);

      staffMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);

      // Fit bounds to show both markers
      if (destination) {
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend([lng, lat]);
        bounds.extend([destination.lng, destination.lat]);
        mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15 });
      } else {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 15 });
      }
    } else {
      // Smooth animation to new position (dead-reckoning)
      const prev = prevLocationRef.current;
      if (prev) {
        animateMarker(prev, { lat, lng }, 3000); // 3s animation
      } else {
        staffMarkerRef.current.setLngLat([lng, lat]);
      }
    }

    // Update stale appearance
    const dot = document.getElementById('staff-dot');
    if (dot) {
      dot.style.opacity = isStale ? '0.5' : '1';
    }

    prevLocationRef.current = { lat, lng };
  }, [staffLocation, mapReady, destination, isStale]);

  // ── Smooth marker animation (dead-reckoning) ──────────
  function animateMarker(from, to, duration) {
    cancelAnimationFrame(animationRef.current);
    const start = performance.now();

    function frame(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      const lng = from.lng + (to.lng - from.lng) * ease;
      const lat = from.lat + (to.lat - from.lat) * ease;

      if (staffMarkerRef.current) {
        staffMarkerRef.current.setLngLat([lng, lat]);
      }

      if (t < 1) {
        animationRef.current = requestAnimationFrame(frame);
      }
    }
    animationRef.current = requestAnimationFrame(frame);
  }

  // ── Update route line ──────────────────────────────────
  useEffect(() => {
    if (!mapReady || !staffLocation || !destination || !mapRef.current) return;
    const source = mapRef.current.getSource('route');
    if (source) {
      source.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [staffLocation.lng, staffLocation.lat],
            [destination.lng, destination.lat],
          ],
        },
      });
    }
  }, [staffLocation, destination, mapReady]);

  return (
    <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
  );
}
