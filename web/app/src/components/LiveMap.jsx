import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function LiveMap({ location }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markerRef    = useRef(null);
  const [ready, setReady] = useState(false);

  // ── Initialize map ────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [77.5946, 12.9716],   // Bangalore default
      zoom: 14,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setReady(true));

    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Update marker on location change ──────────────────
  useEffect(() => {
    if (!ready || !mapRef.current || !location) return;
    const map = mapRef.current;

    if (!markerRef.current) {
      // Create marker element
      const el = document.createElement('div');
      el.innerHTML = `
        <div style="position:relative;width:40px;height:40px;">
          <div style="position:absolute;inset:0;border-radius:50%;
                      background:rgba(13,148,136,.2);
                      animation:map-pulse 2s ease-in-out infinite;"></div>
          <div style="position:absolute;top:8px;left:8px;width:24px;height:24px;
                      border-radius:50%;background:#0d9488;border:3px solid #fff;
                      box-shadow:0 2px 8px rgba(0,0,0,.3);"></div>
        </div>
      `;

      // Add pulse keyframe
      if (!document.getElementById('map-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'map-pulse-style';
        style.textContent = `@keyframes map-pulse {
          0%,100%{transform:scale(1);opacity:1}
          50%{transform:scale(1.8);opacity:0}
        }`;
        document.head.appendChild(style);
      }

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([location.lng, location.lat])
        .addTo(map);

      map.flyTo({ center: [location.lng, location.lat], zoom: 15, speed: 1.5 });
    } else {
      // Smooth move
      markerRef.current.setLngLat([location.lng, location.lat]);
      map.easeTo({ center: [location.lng, location.lat], duration: 1000 });
    }
  }, [location, ready]);

  return <div ref={containerRef} className="map-container" />;
}
