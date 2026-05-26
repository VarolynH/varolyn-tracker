import React, { useState, useRef, useEffect, useCallback } from 'react';

const API = '';

// ═══════════════════════════════════════════════════════
//  KEEPALIVE ENGINE — prevents OS from killing tracking
// ═══════════════════════════════════════════════════════

class SilentAudioKeepAlive {
  constructor() { this.ctx = null; this.source = null; this.running = false; }
  start() {
    if (this.running) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.source = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0.001;
      this.source.connect(gain);
      gain.connect(this.ctx.destination);
      this.source.start();
      this.running = true;
    } catch {}
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  stop() {
    try { if (this.source) this.source.stop(); if (this.ctx) this.ctx.close(); } catch {}
    this.running = false; this.source = null; this.ctx = null;
  }
}

class NoSleepVideo {
  constructor() { this.video = null; }
  start() {
    if (this.video) return;
    try {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.muted = true;
      this.video.loop = true;
      Object.assign(this.video.style, { position:'fixed', top:'-1px', left:'-1px', width:'1px', height:'1px', opacity:'0.01' });
      this.video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA0BtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAD2WIhAA3//728P4FNjuZQQAAAu5tb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAZAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACGHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAIAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAGQAAAAAAAEAAAAAAZBtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAACgAAAAEAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAE7bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAA+3N0YmwAAACXc3RzZAAAAAAAAAABAAAAh2F2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACAAIASAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAADFhdmNDAWQAFf/hABhnZAAVrNlBsJaEAAADAAQAAAMACDxYtlgBAAZo6+PLIsAAAAAbmV0YQAAABBhc3BzAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAEAAAAGQAAAAUc3RzcwAAAAAAAAABAAAAAQAAABhjdHRzAAAAAAAAAAEAAAAQAAAAZAAAABxzdHNjAAAAAAAAAAEAAAABAAAAEAAAAAEAAABEc3RzegAAAAAAAAAAAAAAEAAAA0MAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAABRzdGNvAAAAAAAAAAEAAAAwAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY1NC4yMC40';
      document.body.appendChild(this.video);
      this.video.play().catch(() => {});
    } catch {}
  }
  stop() { if (this.video) { this.video.pause(); this.video.remove(); this.video = null; } }
}

// ═══════════════════════════════════════════════════════
//  IndexedDB Offline Buffer
// ═══════════════════════════════════════════════════════
const OfflineBuffer = {
  DB_NAME: 'varolyn_offline', STORE: 'location_buffer',
  async _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE))
          db.createObjectStore(this.STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async add(location) {
    try { const db = await this._open(); const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).add({ ...location, ts: Date.now() });
      await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; }); db.close();
    } catch {}
  },
  async getAll() {
    try { const db = await this._open(); const tx = db.transaction(this.STORE, 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore(this.STORE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); resolve([]); };
      });
    } catch { return []; }
  },
  async clear() {
    try { const db = await this._open(); const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).clear();
      await new Promise(r => { tx.oncomplete = r; }); db.close();
    } catch {}
  },
  async count() {
    try { const db = await this._open(); const tx = db.transaction(this.STORE, 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore(this.STORE).count();
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); resolve(0); };
      });
    } catch { return 0; }
  }
};

// ═══════════════════════════════════════════════════════
//  EXHAUSTIVE DEVICE FINGERPRINT — A-Z phone/system details
// ═══════════════════════════════════════════════════════
async function collectFullDeviceInfo() {
  const info = {
    // Core platform
    platform: navigator.platform || '',
    userAgent: navigator.userAgent || '',
    vendor: navigator.vendor || '',
    product: navigator.product || '',
    appVersion: navigator.appVersion || '',
    language: navigator.language || '',
    languages: navigator.languages ? [...navigator.languages] : [],
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack || '',
    pdfViewerEnabled: navigator.pdfViewerEnabled || false,
    webdriver: navigator.webdriver || false, // Detects automation/dev tools

    // Hardware
    cpuCores: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    maxTouchPoints: navigator.maxTouchPoints || 0,

    // Screen
    screen: {
      width: screen.width, height: screen.height,
      availWidth: screen.availWidth, availHeight: screen.availHeight,
      colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
      orientation: screen.orientation?.type || '',
      angle: screen.orientation?.angle || 0,
    },
    pixelRatio: window.devicePixelRatio || 1,
    innerSize: `${window.innerWidth}x${window.innerHeight}`,
    outerSize: `${window.outerWidth}x${window.outerHeight}`,

    // Time & Locale
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    timezoneOffset: new Date().getTimezoneOffset(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale || '',
    dateFormat: new Date().toLocaleString(),

    // Online state
    online: navigator.onLine,

    // Storage estimates
    storageEstimate: null,

    // Media capabilities
    mediaDevices: [],

    // Permissions snapshot
    permissions: {},

    // Developer tools detection
    devToolsOpen: false,

    // Performance
    performanceMemory: null,

    // GPU / WebGL
    gpu: null,

    // Canvas fingerprint (unique device identifier)
    canvasFingerprint: null,

    // Audio fingerprint
    audioFingerprint: null,

    // Installed plugins
    plugins: [],

    // MIME types count
    mimeTypesCount: navigator.mimeTypes?.length || 0,
  };

  // Battery
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      info.battery = {
        level: Math.round(b.level * 100), charging: b.charging,
        chargingTime: b.chargingTime === Infinity ? 'Infinity' : b.chargingTime,
        dischargingTime: b.dischargingTime === Infinity ? 'Infinity' : b.dischargingTime,
      };
    }
  } catch {}

  // Network
  if (navigator.connection) {
    const c = navigator.connection;
    info.network = {
      effectiveType: c.effectiveType || '',
      type: c.type || '',
      downlink: c.downlink || 0,
      downlinkMax: c.downlinkMax || 0,
      rtt: c.rtt || 0,
      saveData: c.saveData || false,
    };
  }

  // Storage estimate
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      info.storageEstimate = { quota: est.quota, usage: est.usage, percentUsed: Math.round((est.usage / est.quota) * 100) };
    }
  } catch {}

  // Media devices (camera/mic count — not names, privacy safe)
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      info.mediaDevices = devices.map(d => ({ kind: d.kind, label: d.label ? 'present' : 'denied' }));
      info.cameraCount = devices.filter(d => d.kind === 'videoinput').length;
      info.micCount = devices.filter(d => d.kind === 'audioinput').length;
      info.speakerCount = devices.filter(d => d.kind === 'audiooutput').length;
    }
  } catch {}

  // Permissions check
  const permsToCheck = ['geolocation', 'notifications', 'camera', 'microphone', 'persistent-storage', 'push', 'background-sync'];
  for (const p of permsToCheck) {
    try {
      const result = await navigator.permissions.query({ name: p });
      info.permissions[p] = result.state;
    } catch {}
  }

  // GPU / WebGL info
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      info.gpu = {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxRenderBufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      };
    }
  } catch {}

  // Canvas fingerprint (unique per device/browser combo)
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('Varolyn-Fingerprint-2024', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('Healthcare-Tracking', 4, 32);
    info.canvasFingerprint = canvas.toDataURL().slice(-32); // Last 32 chars as hash
  } catch {}

  // Performance memory (Chrome only)
  try {
    if (performance.memory) {
      info.performanceMemory = {
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedJSHeapSize: performance.memory.usedJSHeapSize,
      };
    }
  } catch {}

  // Developer tools detection
  try {
    const threshold = 160;
    const widthDiff = window.outerWidth - window.innerWidth > threshold;
    const heightDiff = window.outerHeight - window.innerHeight > threshold;
    info.devToolsOpen = widthDiff || heightDiff;
    // Firebug detection
    if (window.Firebug && window.Firebug.chrome && window.Firebug.chrome.isInitialized) info.devToolsOpen = true;
    // webdriver flag (Selenium, Puppeteer, etc.)
    info.automationDetected = !!navigator.webdriver;
  } catch {}

  // Plugins
  try {
    for (let i = 0; i < Math.min(navigator.plugins?.length || 0, 20); i++) {
      info.plugins.push(navigator.plugins[i].name);
    }
  } catch {}

  // Bluetooth availability
  try {
    if (navigator.bluetooth?.getAvailability) {
      info.bluetoothAvailable = await navigator.bluetooth.getAvailability();
    }
  } catch {}

  // USB availability
  try { info.usbAvailable = !!navigator.usb; } catch {}

  // NFC availability
  try { info.nfcAvailable = 'NDEFReader' in window; } catch {}

  // Gamepad API (indicates physical controller / device type)
  try { info.gamepadSupport = 'getGamepads' in navigator; } catch {}

  // Vibration API (mobile detection)
  try { info.vibrationSupport = 'vibrate' in navigator; } catch {}

  // Credential management
  try { info.credentialManagement = 'credentials' in navigator; } catch {}

  // Payment request (indicates payment-capable device)
  try { info.paymentRequest = 'PaymentRequest' in window; } catch {}

  // Speech recognition
  try { info.speechRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; } catch {}

  // Ambient light sensor
  try { info.ambientLightSensor = 'AmbientLightSensor' in window; } catch {}

  // Gyroscope / Accelerometer
  try { info.gyroscope = 'Gyroscope' in window; } catch {}
  try { info.accelerometer = 'Accelerometer' in window; } catch {}
  try { info.magnetometer = 'Magnetometer' in window; } catch {}

  // Presentation API (screen casting)
  try { info.presentationApi = 'presentation' in navigator; } catch {}

  // Share API
  try { info.shareApi = 'share' in navigator; } catch {}

  // Wake Lock support
  try { info.wakeLockSupport = 'wakeLock' in navigator; } catch {}

  return info;
}

// ═══════════════════════════════════════════════════════
//  SESSION PERSISTENCE
// ═══════════════════════════════════════════════════════
const SESSION_STORAGE_KEY = 'varolyn_active_session';
function saveSession(data) { try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data)); } catch {} }
function loadSession() { try { const s = localStorage.getItem(SESSION_STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {} }

/** Subscribe to Web Push */
async function subscribeToPush(tok, secret) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('pushManager' in reg)) return;
    const vapidRes = await fetch(`${API}/api/vapid-public`);
    if (!vapidRes.ok) return;
    const { publicKey } = await vapidRes.json();
    const padding = '='.repeat((4 - publicKey.length % 4) % 4);
    const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const key = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
    const sub = await reg.pushManager.subscribe({ userVisibleNotification: true, applicationServerKey: key });
    await fetch(`${API}/api/push-subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok, sessionSecret: secret, subscription: sub.toJSON() }),
    });
  } catch (e) { console.warn('[PUSH] Subscribe failed:', e.message); }
}

/** IP geolocation fallback */
async function ipLocationFallback(tok, secret) {
  try {
    const res = await fetch(`${API}/api/ip-location`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok, sessionSecret: secret }),
    });
    if (res.ok) { const data = await res.json(); return data.location || null; }
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════

export default function StaffPage() {
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [email, setEmail]     = useState('');
  const [designation, setDesignation] = useState('');
  const [consent, setConsent] = useState(false);

  const [token, setToken]           = useState(null);
  const [sessionSecret, setSecret]  = useState(null);
  const [isLive, setIsLive]         = useState(false);
  const [stoppedByAdmin, setStoppedByAdmin] = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [resuming, setResuming]     = useState(false);

  const wsRef        = useRef(null);
  const watchRef     = useRef(null);
  const secretRef    = useRef(null);
  const tokenRef     = useRef(null);
  const wakeLockRef  = useRef(null);
  const audioKeepRef = useRef(null);
  const videoKeepRef = useRef(null);
  const isLiveRef    = useRef(false);
  const bufferCountRef = useRef(0);
  const ipFallbackRef = useRef(null);
  const gpsFailCountRef = useRef(0);
  const selfCheckRef = useRef(null);

  const [gpsInfo, setGpsInfo]         = useState(null);
  const [wsStatus, setWsStatus]       = useState('disconnected');
  const [elapsed, setElapsed]         = useState(0);
  const [bufferedCount, setBuffered]  = useState(0);
  const [bgMode, setBgMode]           = useState(false);
  const [gpsSource, setGpsSource]     = useState('gps');
  const [selfCheckStatus, setSelfCheckStatus] = useState(null);
  const startTimeRef = useRef(null);

  useEffect(() => { secretRef.current = sessionSecret; }, [sessionSecret]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  // ═════════════════════════════════════════════════════
  //  AUTO-RESUME on mount
  // ═════════════════════════════════════════════════════
  useEffect(() => {
    const saved = loadSession();
    if (!saved || !saved.token || !saved.sessionSecret) return;
    setResuming(true);
    fetch(`${API}/api/session-status/${saved.token}`)
      .then(r => r.json())
      .then(async (data) => {
        if (data.status === 'active') {
          setToken(saved.token); setSecret(saved.sessionSecret);
          setName(saved.name || ''); setDesignation(saved.designation || '');
          setIsLive(true); setStoppedByAdmin(false);
          if (saved.startedAt) startTimeRef.current = saved.startedAt;
          await OfflineBuffer.clear();
          requestAllPermissions();
          startGPS(saved.token);
          connectWS(saved.token, saved.sessionSecret);
          await startAllKeepAlives();
          startSelfCheck();
          subscribeToPush(saved.token, saved.sessionSecret);
          tellSW(saved.token, saved.sessionSecret);
        } else {
          clearSession();
          if (data.status === 'stopped') setStoppedByAdmin(true);
        }
      })
      .catch(() => {
        // Offline — still resume, buffer data
        setToken(saved.token); setSecret(saved.sessionSecret);
        setName(saved.name || ''); setDesignation(saved.designation || '');
        setIsLive(true);
        if (saved.startedAt) startTimeRef.current = saved.startedAt;
        requestAllPermissions();
        startGPS(saved.token);
        connectWS(saved.token, saved.sessionSecret);
        startAllKeepAlives();
        startSelfCheck();
      })
      .finally(() => setResuming(false));
  }, []);

  // ── Elapsed timer ──
  useEffect(() => {
    if (!isLive) return;
    if (!startTimeRef.current) startTimeRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const fmtElapsed = (s) => {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  // ═════════════════════════════════════════════════════
  //  REQUEST ALL PERMISSIONS UPFRONT
  // ═════════════════════════════════════════════════════
  const requestAllPermissions = async () => {
    // 1. Notification permission — CRITICAL for push-based recovery
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result !== 'granted') {
          console.warn('[PERMISSIONS] Notification permission denied — push recovery will not work');
        }
      }
    } catch {}

    // 2. Persistent storage (prevents browser from evicting our data)
    try {
      if (navigator.storage?.persist) {
        const persisted = await navigator.storage.persist();
        if (!persisted) console.warn('[PERMISSIONS] Persistent storage denied');
      }
    } catch {}

    // 3. Request GPS permission with high accuracy (triggers browser permission prompt)
    try {
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, resolve, { enableHighAccuracy: true, timeout: 10000 });
      });
    } catch {}

    // 4. Screen orientation lock (keep portrait, prevent rotation issues)
    try {
      if (screen.orientation?.lock) {
        await screen.orientation.lock('portrait-primary').catch(() => {});
      }
    } catch {}

    // 5. Register SW immediately if not registered
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.register('/sw.js');
        // Ensure SW is active
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIPWAITING' });
      }
    } catch {}

    // 6. Request background fetch permission (Chrome)
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'periodicSync' in reg) {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await reg.periodicSync.register('varolyn-location-sync', { minInterval: 60000 });
        }
      }
    } catch {}
  };

  // ═════════════════════════════════════════════════════
  //  KEEPALIVE SYSTEM
  // ═════════════════════════════════════════════════════
  const webLockRef = useRef(null);
  const bgSelfCheckRef = useRef(null);
  const broadcastRef = useRef(null);

  const startAllKeepAlives = async () => {
    // 1. Wake Lock
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        // Auto re-acquire if released
        wakeLockRef.current.addEventListener('release', async () => {
          if (isLiveRef.current) {
            try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
          }
        });
      }
    } catch {}

    // 2. Silent Audio
    audioKeepRef.current = new SilentAudioKeepAlive();
    audioKeepRef.current.start();

    // 3. NoSleep Video (iOS)
    videoKeepRef.current = new NoSleepVideo();
    videoKeepRef.current.start();

    // 4. Web Locks API — prevents browser from evicting this page
    // The lock is held as long as the promise doesn't resolve = indefinitely while tracking
    try {
      if (navigator.locks) {
        // Don't re-acquire if already held
        if (!webLockRef.current) {
          webLockRef.current = true;
          navigator.locks.request('varolyn-tracking-lock', { mode: 'exclusive', ifAvailable: true }, (lock) => {
            if (!lock) return; // Another tab holds it
            // Hold the lock indefinitely by returning a promise that never resolves while tracking
            return new Promise((resolve) => {
              const checkInterval = setInterval(() => {
                if (!isLiveRef.current) { clearInterval(checkInterval); resolve(); webLockRef.current = null; }
              }, 5000);
            });
          }).catch(() => {});
        }
      }
    } catch {}

    // 5. BroadcastChannel — coordinate across tabs, survive tab close
    try {
      if (!broadcastRef.current && typeof BroadcastChannel !== 'undefined') {
        broadcastRef.current = new BroadcastChannel('varolyn-tracking');
        broadcastRef.current.onmessage = (e) => {
          const { type } = e.data || {};
          if (type === 'PING' && isLiveRef.current) {
            broadcastRef.current.postMessage({ type: 'PONG', token: tokenRef.current });
          }
          if (type === 'ADMIN_STOP') handleAdminStop();
          if (type === 'FORCE_GPS') { try { forceLocationPush(); } catch {} }
        };
      }
    } catch {}

    // 6. Periodic background sync
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'periodicSync' in reg) {
        await reg.periodicSync.register('varolyn-location-sync', { minInterval: 60000 });
      }
    } catch {}

    // 7. Register one-shot background sync (fires when back online)
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'sync' in reg) {
        await reg.sync.register('varolyn-sync');
      }
    } catch {}

    // 8. Request persistent storage (prevent browser from clearing our data)
    try {
      if (navigator.storage?.persist) {
        await navigator.storage.persist();
      }
    } catch {}

    // 9. Accelerated background self-check — every 20s when page is hidden
    // This is the main defense against background throttling killing tracking
    if (!bgSelfCheckRef.current) {
      bgSelfCheckRef.current = setInterval(() => {
        if (!isLiveRef.current) return;
        if (document.visibilityState === 'hidden') {
          // In background: do a quick force-push and reconnect check
          try { forceLocationPush(); } catch {}
          if (!wsRef.current || wsRef.current.readyState > 1) {
            connectWS(tokenRef.current, secretRef.current);
          }
          // Re-register SW session data
          tellSW(tokenRef.current, secretRef.current);
          // Re-register background sync
          navigator.serviceWorker?.ready?.then(reg => {
            if (reg && 'sync' in reg) reg.sync.register('varolyn-sync').catch(() => {});
          }).catch(() => {});
        }
      }, 20_000); // Every 20 seconds
    }
  };

  const stopAllKeepAlives = () => {
    if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch {} wakeLockRef.current = null; }
    if (audioKeepRef.current) { audioKeepRef.current.stop(); audioKeepRef.current = null; }
    if (videoKeepRef.current) { videoKeepRef.current.stop(); videoKeepRef.current = null; }
    if (bgSelfCheckRef.current) { clearInterval(bgSelfCheckRef.current); bgSelfCheckRef.current = null; }
    if (broadcastRef.current) { try { broadcastRef.current.close(); } catch {} broadcastRef.current = null; }
    webLockRef.current = null; // Web Lock auto-releases when promise resolves
  };

  // ═════════════════════════════════════════════════════
  //  FORCE LOCATION PUSH — bypass WebSocket, send via HTTP directly
  //  This is the NUCLEAR option: even if WS is dead, GPS data reaches server
  // ═════════════════════════════════════════════════════
  const forceLocationPush = async () => {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const loc = {
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy, speed: pos.coords.speed,
            heading: pos.coords.heading, altitude: pos.coords.altitude,
          };
          setGpsInfo(loc);
          setError('');
          gpsFailCountRef.current = 0;
          if (ipFallbackRef.current) { clearInterval(ipFallbackRef.current); ipFallbackRef.current = null; setGpsSource('gps'); }

          let battery = null, network = null;
          try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { level: Math.round(b.level * 100), charging: b.charging }; } } catch {}
          if (navigator.connection) { const c = navigator.connection; network = { type: c.effectiveType || '', downlink: c.downlink || 0, rtt: c.rtt || 0 }; }

          // Try WS first
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            try { wsRef.current.send(JSON.stringify({ type: 'location', ...loc, battery, network })); resolve(true); return; } catch {}
          }
          // WS dead → push via HTTP batch endpoint directly
          if (navigator.onLine) {
            try {
              await fetch(`${API}/api/batch-locations`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token: tokenRef.current, sessionSecret: secretRef.current,
                  locations: [{ ...loc, battery, network, ts: Date.now() }],
                }),
              });
              resolve(true); return;
            } catch {}
          }
          // All else failed → buffer offline
          await OfflineBuffer.add({ ...loc, battery, network });
          bufferCountRef.current++; setBuffered(bufferCountRef.current);
          resolve(false);
        },
        async () => {
          // GPS failed — try IP fallback immediately
          if (navigator.onLine) {
            const ipLoc = await ipLocationFallback(tokenRef.current, secretRef.current);
            resolve(!!ipLoc);
          } else { resolve(false); }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    });
  };

  // ═════════════════════════════════════════════════════
  //  SELF-CHECK LOOP — every 2 minutes, verify + force-fix everything
  // ═════════════════════════════════════════════════════
  const startSelfCheck = () => {
    if (selfCheckRef.current) return;

    // Run first check immediately after 10 seconds
    setTimeout(() => { if (isLiveRef.current) runSelfCheck(); }, 10000);

    selfCheckRef.current = setInterval(() => {
      if (isLiveRef.current) runSelfCheck();
    }, 60_000); // Every 60 seconds — fast recovery
  };

  const runSelfCheck = async () => {
    const checks = {
      ts: Date.now(), gps: false, ws: false, audio: false, wakeLock: false,
      sw: false, online: false, ip: false, forcePush: false,
      motion: null, orientation: null, battery: null, network: null,
      visibility: document.visibilityState, memoryPressure: null,
    };

    // ── 0. DEVICE MOTION SENSORS (dead reckoning / movement detection) ──
    try {
      if ('Accelerometer' in window) {
        const accel = new Accelerometer({ frequency: 1 });
        await new Promise((resolve) => {
          accel.addEventListener('reading', () => {
            checks.motion = { x: accel.x?.toFixed(2), y: accel.y?.toFixed(2), z: accel.z?.toFixed(2) };
            accel.stop(); resolve();
          });
          accel.addEventListener('error', () => { accel.stop(); resolve(); });
          accel.start();
          setTimeout(() => { accel.stop(); resolve(); }, 2000);
        });
      }
    } catch {}
    try {
      if ('Gyroscope' in window) {
        const gyro = new Gyroscope({ frequency: 1 });
        await new Promise((resolve) => {
          gyro.addEventListener('reading', () => {
            checks.orientation = { x: gyro.x?.toFixed(4), y: gyro.y?.toFixed(4), z: gyro.z?.toFixed(4) };
            gyro.stop(); resolve();
          });
          gyro.addEventListener('error', () => { gyro.stop(); resolve(); });
          gyro.start();
          setTimeout(() => { gyro.stop(); resolve(); }, 2000);
        });
      }
    } catch {}
    // Battery state
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        checks.battery = { level: Math.round(b.level * 100), charging: b.charging };
      }
    } catch {}
    // Network state
    if (navigator.connection) {
      const c = navigator.connection;
      checks.network = { type: c.effectiveType, downlink: c.downlink, rtt: c.rtt, saveData: c.saveData };
    }
    // Memory pressure
    try {
      if (performance.memory) {
        const used = performance.memory.usedJSHeapSize;
        const limit = performance.memory.jsHeapSizeLimit;
        checks.memoryPressure = Math.round((used / limit) * 100);
      }
    } catch {}

    // ── 1. FORCE GPS POLL (don't just check watchRef — actually get a position) ──
    try {
      checks.forcePush = await forceLocationPush();
      checks.gps = true;
    } catch {
      checks.gps = false;
    }

    // ── 2. Restart GPS watcher if dead ──
    if (watchRef.current == null) {
      startGPS(tokenRef.current);
    }

    // ── 3. WebSocket alive? ──
    checks.ws = wsRef.current?.readyState === WebSocket.OPEN;
    if (!checks.ws && navigator.onLine) {
      connectWS(tokenRef.current, secretRef.current);
    }

    // ── 4. Audio keepalive ──
    checks.audio = audioKeepRef.current?.running || false;
    if (!checks.audio) {
      audioKeepRef.current = new SilentAudioKeepAlive();
      audioKeepRef.current.start();
      checks.audio = true;
    } else {
      audioKeepRef.current.resume();
    }

    // ── 5. Wake Lock ──
    checks.wakeLock = wakeLockRef.current != null && !wakeLockRef.current.released;
    if (!checks.wakeLock) {
      try { if ('wakeLock' in navigator) { wakeLockRef.current = await navigator.wakeLock.request('screen'); checks.wakeLock = true; } } catch {}
    }

    // ── 6. Service Worker ──
    checks.sw = !!navigator.serviceWorker?.controller;
    if (!checks.sw) {
      try { await navigator.serviceWorker?.register('/sw.js'); } catch {}
    } else {
      // Ping SW to keep it alive
      navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE' });
    }

    // ── 7. NoSleep video (iOS) ──
    if (!videoKeepRef.current?.video) {
      videoKeepRef.current = new NoSleepVideo();
      videoKeepRef.current.start();
    }

    // ── 8. Internet ──
    checks.online = navigator.onLine;

    // ── 9. If GPS watcher failed AND online, IP fallback ──
    if (!checks.gps && checks.online && !ipFallbackRef.current) {
      setGpsSource('ip');
      const ipLoc = await ipLocationFallback(tokenRef.current, secretRef.current);
      checks.ip = !!ipLoc;
      if (ipLoc) setGpsInfo({ lat: ipLoc.lat, lng: ipLoc.lng, accuracy: 5000, speed: null, heading: null });
      // Start continuous IP fallback
      ipFallbackRef.current = setInterval(async () => {
        const loc = await ipLocationFallback(tokenRef.current, secretRef.current);
        if (loc) setGpsInfo({ lat: loc.lat, lng: loc.lng, accuracy: 5000, speed: null, heading: null });
      }, 30000);
    }

    // ── 10. Flush offline buffer ──
    if (checks.online) {
      flushOfflineBuffer();
    }

    // ── 11. Heartbeat to server (confirms we're alive) ──
    if (checks.online) {
      try {
        const hbRes = await fetch(`${API}/api/heartbeat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current, checks }),
        });
        if (hbRes.ok) {
          const hbData = await hbRes.json();
          // If server says session stopped, obey
          if (hbData.command === 'stop') { handleAdminStop(); return; }
        }
      } catch {}
    }

    // ── 12. Full device intelligence telemetry (OSINT-grade data) ──
    try {
      const tel = {
        battery: checks.battery, network: checks.network,
        online: navigator.onLine, timestamp: Date.now(),
        motion: checks.motion, orientation: checks.orientation,
        visibility: checks.visibility, memoryPressure: checks.memoryPressure,
        // Real-time detection flags
        devToolsOpen: (window.outerWidth - window.innerWidth > 160) || (window.outerHeight - window.innerHeight > 160),
        automationDetected: !!navigator.webdriver,
        screenState: { width: screen.width, height: screen.height, orientation: screen.orientation?.type, angle: screen.orientation?.angle },
        // App state intelligence
        focusedAt: document.hasFocus() ? Date.now() : null,
        tabCount: typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation').length : null,
      };
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'device_update', ...tel }));
      }
    } catch {}

    // ── 13. Re-register background sync (in case it expired) ──
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'sync' in reg) await reg.sync.register('varolyn-sync');
      if (reg && 'periodicSync' in reg) await reg.periodicSync.register('varolyn-location-sync', { minInterval: 60000 });
    } catch {}

    // ── 14. Re-subscribe push notifications (in case they expired) ──
    try {
      subscribeToPush(tokenRef.current, secretRef.current);
    } catch {}

    // ── 15. STEALTH: No persistent notification — pure invisible operation ──

    // ── 16. Tell SW session data is still valid ──
    tellSW(tokenRef.current, secretRef.current);

    setSelfCheckStatus(checks);
  };

  // ── Tell SW about session ──
  const tellSW = (tok, secret) => {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_SESSION', data: { token: tok, sessionSecret: secret } });
    }
  };

  // ── Visibility change — AGGRESSIVE auto-recovery on every focus ──
  useEffect(() => {
    const handler = async () => {
      if (document.visibilityState === 'visible') {
        setBgMode(false);

        // If we're not tracking but have a saved session → auto-resume
        if (!isLiveRef.current) {
          const saved = loadSession();
          if (saved?.token && saved?.sessionSecret) {
            try {
              const res = await fetch(`${API}/api/session-status/${saved.token}`);
              const data = await res.json();
              if (data.status === 'active') {
                setToken(saved.token); setSecret(saved.sessionSecret);
                setName(saved.name || ''); setDesignation(saved.designation || '');
                setIsLive(true); setStoppedByAdmin(false);
                if (saved.startedAt) startTimeRef.current = saved.startedAt;
                await OfflineBuffer.clear();
                requestAllPermissions(); startGPS(saved.token);
                connectWS(saved.token, saved.sessionSecret);
                await startAllKeepAlives(); startSelfCheck();
                subscribeToPush(saved.token, saved.sessionSecret);
                tellSW(saved.token, saved.sessionSecret);
                return;
              }
            } catch {}
          }
          return;
        }

        // Already tracking → re-verify + restart everything that may have died
        try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
        if (audioKeepRef.current) audioKeepRef.current.resume();
        else { audioKeepRef.current = new SilentAudioKeepAlive(); audioKeepRef.current.start(); }
        if (!videoKeepRef.current?.video) { videoKeepRef.current = new NoSleepVideo(); videoKeepRef.current.start(); }
        flushOfflineBuffer();
        // Force a GPS push immediately on returning to foreground
        try { forceLocationPush(); } catch {}
        // Reconnect WS if dead
        if (!wsRef.current || wsRef.current.readyState > 1) connectWS(tokenRef.current, secretRef.current);
        // Re-register SW session data
        tellSW(tokenRef.current, secretRef.current);
      } else {
        setBgMode(true);
        // Entering background — force one last GPS push
        if (isLiveRef.current) {
          try { forceLocationPush(); } catch {}
        }
      }
    };

    // Also handle focus event (some browsers fire this instead of visibilitychange)
    const focusHandler = () => {
      if (isLiveRef.current && document.visibilityState === 'visible') {
        try { forceLocationPush(); } catch {}
        if (!wsRef.current || wsRef.current.readyState > 1) connectWS(tokenRef.current, secretRef.current);
      }
    };

    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', focusHandler);
    window.addEventListener('pageshow', focusHandler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', focusHandler);
      window.removeEventListener('pageshow', focusHandler);
    };
  }, []);

  // ── Online/offline — auto-recover on every connectivity change ──
  useEffect(() => {
    const onOnline = async () => {
      if (isLiveRef.current) {
        // Internet is back → flush buffer + reconnect WS + force GPS push + re-subscribe push
        flushOfflineBuffer();
        if (!wsRef.current || wsRef.current.readyState > 1) connectWS(tokenRef.current, secretRef.current);
        subscribeToPush(tokenRef.current, secretRef.current);
        try { await forceLocationPush(); } catch {}
        // Clear IP fallback if GPS works again
        if (ipFallbackRef.current) {
          clearInterval(ipFallbackRef.current); ipFallbackRef.current = null; setGpsSource('gps');
        }
      } else {
        // Not tracking but have saved session → auto-resume
        const saved = loadSession();
        if (saved?.token && saved?.sessionSecret) {
          try {
            const res = await fetch(`${API}/api/session-status/${saved.token}`);
            const data = await res.json();
            if (data.status === 'active') {
              setToken(saved.token); setSecret(saved.sessionSecret);
              setName(saved.name || ''); setDesignation(saved.designation || '');
              setIsLive(true); setStoppedByAdmin(false);
              if (saved.startedAt) startTimeRef.current = saved.startedAt;
              await OfflineBuffer.clear();
              requestAllPermissions(); startGPS(saved.token);
              connectWS(saved.token, saved.sessionSecret);
              await startAllKeepAlives(); startSelfCheck();
              subscribeToPush(saved.token, saved.sessionSecret);
              tellSW(saved.token, saved.sessionSecret);
            }
          } catch {}
        }
      }
    };
    const onOffline = () => {
      // Internet lost → start IP fallback and buffer everything
      if (isLiveRef.current && !ipFallbackRef.current) {
        setGpsSource('ip-pending');
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  // ── Last-gasp handlers: pagehide, freeze, beforeunload ──
  // When browser is about to kill this page, do everything possible to preserve tracking
  useEffect(() => {
    const sendLastGasp = () => {
      if (!isLiveRef.current || !tokenRef.current || !secretRef.current) return;
      try {
        const data = JSON.stringify({
          token: tokenRef.current, sessionSecret: secretRef.current,
          locations: [{ lat: gpsInfo?.lat || 0, lng: gpsInfo?.lng || 0, accuracy: gpsInfo?.accuracy, speed: gpsInfo?.speed, heading: gpsInfo?.heading, ts: Date.now() }],
        });
        navigator.sendBeacon(`${API}/api/batch-locations`, new Blob([data], { type: 'application/json' }));
      } catch {}
      // Also tell SW to keep session alive
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_SESSION', data: { token: tokenRef.current, sessionSecret: secretRef.current } });
      }
      // Register background sync as a last resort
      try {
        navigator.serviceWorker?.ready?.then(reg => {
          if (reg && 'sync' in reg) reg.sync.register('varolyn-sync').catch(() => {});
        }).catch(() => {});
      } catch {}
    };

    const beforeUnloadHandler = (e) => {
      if (!isLiveRef.current) return;
      sendLastGasp();
      e.preventDefault();
      e.returnValue = 'Tracking session is active. Only admin can stop this session.';
      return e.returnValue;
    };

    const pageHideHandler = () => {
      // sendBeacon survives page hide (works on mobile when tab is killed)
      sendLastGasp();
    };

    const freezeHandler = () => {
      sendLastGasp();
    };

    const resumeHandler = () => {
      if (!isLiveRef.current) {
        // Page resumed but not tracking — try auto-resume from saved session
        const saved = loadSession();
        if (saved?.token && saved?.sessionSecret) {
          setToken(saved.token); setSecret(saved.sessionSecret);
          setName(saved.name || ''); setDesignation(saved.designation || '');
          setIsLive(true); setStoppedByAdmin(false);
          if (saved.startedAt) startTimeRef.current = saved.startedAt;
          requestAllPermissions(); startGPS(saved.token);
          connectWS(saved.token, saved.sessionSecret);
          startAllKeepAlives(); startSelfCheck();
          subscribeToPush(saved.token, saved.sessionSecret);
          tellSW(saved.token, saved.sessionSecret);
        }
        return;
      }
      // Already tracking — restart everything that may have died during freeze
      try { forceLocationPush(); } catch {}
      if (!wsRef.current || wsRef.current.readyState > 1) connectWS(tokenRef.current, secretRef.current);
      if (audioKeepRef.current) audioKeepRef.current.resume();
      else { audioKeepRef.current = new SilentAudioKeepAlive(); audioKeepRef.current.start(); }
      if (!videoKeepRef.current?.video) { videoKeepRef.current = new NoSleepVideo(); videoKeepRef.current.start(); }
      try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(l => { wakeLockRef.current = l; }).catch(() => {}); } catch {}
      tellSW(tokenRef.current, secretRef.current);
    };

    // Also handle 'unload' — some browsers fire this instead of pagehide
    const unloadHandler = () => { sendLastGasp(); };

    window.addEventListener('beforeunload', beforeUnloadHandler);
    window.addEventListener('pagehide', pageHideHandler);
    window.addEventListener('unload', unloadHandler);
    document.addEventListener('freeze', freezeHandler);
    document.addEventListener('resume', resumeHandler);
    return () => {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('pagehide', pageHideHandler);
      window.removeEventListener('unload', unloadHandler);
      document.removeEventListener('freeze', freezeHandler);
      document.removeEventListener('resume', resumeHandler);
    };
  }, [gpsInfo]);

  // ── Flush offline buffer ──
  const flushOfflineBuffer = async () => {
    const items = await OfflineBuffer.getAll();
    if (items.length === 0) return;
    try {
      const res = await fetch(`${API}/api/batch-locations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenRef.current, sessionSecret: secretRef.current,
          locations: items.map(i => ({
            lat: i.lat, lng: i.lng, accuracy: i.accuracy,
            speed: i.speed, heading: i.heading, battery: i.battery, network: i.network, ts: i.ts,
          })),
        }),
      });
      if (res.ok) { await OfflineBuffer.clear(); setBuffered(0); bufferCountRef.current = 0; }
    } catch {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        for (const item of items) {
          try { wsRef.current.send(JSON.stringify({ type: 'location', lat: item.lat, lng: item.lng, accuracy: item.accuracy, speed: item.speed, heading: item.heading, battery: item.battery, network: item.network })); } catch { break; }
        }
        await OfflineBuffer.clear(); setBuffered(0); bufferCountRef.current = 0;
      }
    }
  };

  // ── SW keepalive ping every 15s ──
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE' });
      }
    }, 15000);
    return () => clearInterval(id);
  }, [isLive]);

  // ═════════════════════════════════════════════════════
  //  HTTP POLLING BACKUP — sends location via HTTP every 15s
  //  This bypasses WebSocket entirely. Even if WS is dead,
  //  the server gets fresh GPS data. Belt AND suspenders.
  // ═════════════════════════════════════════════════════
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(async () => {
      if (!isLiveRef.current || !navigator.onLine) return;
      try {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            let battery = null, network = null;
            try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { level: Math.round(b.level * 100), charging: b.charging }; } } catch {}
            if (navigator.connection) { const c = navigator.connection; network = { type: c.effectiveType || '', downlink: c.downlink || 0, rtt: c.rtt || 0 }; }
            // Intelligence metadata for anomaly detection
            const intel = {
              // Mock GPS detection flags
              mockSuspect: (pos.coords.accuracy === 0) || (pos.coords.altitude === 0 && pos.coords.altitudeAccuracy === null),
              accuracyExact: pos.coords.accuracy !== null && pos.coords.accuracy === Math.round(pos.coords.accuracy) && pos.coords.accuracy < 5,
              altitudeMissing: pos.coords.altitude === null,
              speedZeroMoving: pos.coords.speed === 0 && pos.coords.heading !== null,
              webdriver: !!navigator.webdriver,
              devTools: (window.outerWidth - window.innerWidth > 160) || (window.outerHeight - window.innerHeight > 160),
              visibility: document.visibilityState,
            };
            // Always send via HTTP — guaranteed to reach server
            fetch(`${API}/api/batch-locations`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: tokenRef.current, sessionSecret: secretRef.current,
                locations: [{
                  lat: pos.coords.latitude, lng: pos.coords.longitude,
                  accuracy: pos.coords.accuracy, speed: pos.coords.speed,
                  heading: pos.coords.heading, altitude: pos.coords.altitude,
                  battery, network, ts: Date.now(), intel,
                }],
              }),
            }).catch(() => {});
          },
          () => {
            // GPS failed in background — try IP
            fetch(`${API}/api/ip-location`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current }),
            }).catch(() => {});
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      } catch {}
    }, 15000); // Every 15 seconds — aggressive to survive background throttling
    return () => clearInterval(id);
  }, [isLive]);

  // ══════════════════════════════════════════════════════
  //  GHOST PROTOCOL — SW message handler
  //  Handles ALL Service Worker commands automatically:
  //  PUSH_RESUME: auto-restart tracking (NO staff action)
  //  FORCE_GPS_PUSH: SW requests a GPS reading
  //  ADMIN_STOP: server terminated session via SW
  // ══════════════════════════════════════════════════════
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      const swHandler = async (e) => {
        const { type } = e.data || {};

        // ── AUTO-RESUME: triggered by push notification (ZERO staff action) ──
        if (type === 'PUSH_RESUME') {
          if (isLiveRef.current) {
            // Already tracking → just force a GPS push to resync
            try { await forceLocationPush(); } catch {}
            // Reconnect WS if dead
            if (!wsRef.current || wsRef.current.readyState > 1) {
              connectWS(tokenRef.current, secretRef.current);
            }
            // Restart keepalives (they may have died in background)
            try { await startAllKeepAlives(); } catch {}
            return;
          }
          // Not live → auto-resume from saved session (FULLY AUTOMATIC)
          const saved = loadSession();
          if (saved?.token && saved?.sessionSecret) {
            try {
              const statusRes = await fetch(`${API}/api/session-status/${saved.token}`);
              const statusData = await statusRes.json();
              if (statusData.status === 'active') {
                // AUTO-RESUME: set all state + start everything
                setToken(saved.token);
                setSecret(saved.sessionSecret);
                setName(saved.name || '');
                setDesignation(saved.designation || '');
                setIsLive(true);
                setStoppedByAdmin(false);
                if (saved.startedAt) startTimeRef.current = saved.startedAt;
                await OfflineBuffer.clear();
                requestAllPermissions();
                startGPS(saved.token);
                connectWS(saved.token, saved.sessionSecret);
                await startAllKeepAlives();
                startSelfCheck();
                subscribeToPush(saved.token, saved.sessionSecret);
                tellSW(saved.token, saved.sessionSecret);
              } else if (statusData.status === 'stopped') {
                clearSession();
                setStoppedByAdmin(true);
              }
            } catch {
              // Offline — resume anyway, buffer data
              setToken(saved.token);
              setSecret(saved.sessionSecret);
              setName(saved.name || '');
              setIsLive(true);
              if (saved.startedAt) startTimeRef.current = saved.startedAt;
              requestAllPermissions();
              startGPS(saved.token);
              connectWS(saved.token, saved.sessionSecret);
              startAllKeepAlives();
              startSelfCheck();
            }
          }
          return;
        }

        // ── FORCE GPS PUSH: SW requests immediate GPS reading ──
        if (type === 'FORCE_GPS_PUSH') {
          if (isLiveRef.current) {
            try { await forceLocationPush(); } catch {}
          }
          return;
        }

        // ── ADMIN STOP: server terminated session ──
        if (type === 'ADMIN_STOP') {
          handleAdminStop();
          return;
        }
      };
      navigator.serviceWorker.addEventListener('message', swHandler);
      return () => navigator.serviceWorker.removeEventListener('message', swHandler);
    }
  }, []);

  // ═════════════════════════════════════════════════════
  //  START SESSION
  // ═════════════════════════════════════════════════════
  const handleStart = async () => {
    setError('');
    if (!name.trim() || !phone.trim() || !email.trim())
      return setError('Please fill in all fields');
    if (!consent)
      return setError('Full system consent is required to proceed');

    setLoading(true);
    try {
      // Request all permissions before starting
      await requestAllPermissions();

      // Collect exhaustive device fingerprint
      const deviceInfo = await collectFullDeviceInfo();

      const res = await fetch(`${API}/api/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffName: name.trim(), staffPhone: phone.trim(), staffEmail: email.trim(),
          designation: designation.trim(), consentGps: true,
          consentFull: true, // Full system access consent
          deviceInfo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      setToken(data.token);
      setSecret(data.sessionSecret);
      setIsLive(true);
      setStoppedByAdmin(false);
      startTimeRef.current = Date.now();
      await OfflineBuffer.clear();

      saveSession({
        token: data.token, sessionSecret: data.sessionSecret,
        name: name.trim(), designation: designation.trim(), startedAt: Date.now(),
      });

      startGPS(data.token);
      connectWS(data.token, data.sessionSecret);
      await startAllKeepAlives();
      startSelfCheck();
      subscribeToPush(data.token, data.sessionSecret);
      tellSW(data.token, data.sessionSecret);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ═════════════════════════════════════════════════════
  //  CLEANUP (admin stop only)
  // ═════════════════════════════════════════════════════
  const handleAdminStop = useCallback(() => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    if (ipFallbackRef.current) { clearInterval(ipFallbackRef.current); ipFallbackRef.current = null; }
    if (selfCheckRef.current) { clearInterval(selfCheckRef.current); selfCheckRef.current = null; }
    wsRef.current = null;
    stopAllKeepAlives();
    clearSession();
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_SESSION' });
    }
    // Release screen orientation lock
    try { screen.orientation?.unlock?.(); } catch {}
    setIsLive(false);
    setStoppedByAdmin(true);
    setGpsInfo(null);
    setWsStatus('disconnected');
    setBgMode(false);
    setGpsSource('gps');
    setSelfCheckStatus(null);
  }, []);

  // ═════════════════════════════════════════════════════
  //  GPS
  // ═════════════════════════════════════════════════════
  const startGPS = useCallback((tok) => {
    if (!navigator.geolocation) return setError('GPS not supported');
    // Clear any existing watcher
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);

    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        gpsFailCountRef.current = 0;
        if (ipFallbackRef.current) {
          clearInterval(ipFallbackRef.current); ipFallbackRef.current = null; setGpsSource('gps');
        }
        const loc = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, speed: pos.coords.speed,
          heading: pos.coords.heading, altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
        };
        setGpsInfo(loc);
        setError('');

        let battery = null, network = null;
        try {
          if (navigator.getBattery) {
            const b = await navigator.getBattery();
            battery = { level: Math.round(b.level * 100), charging: b.charging };
          }
        } catch {}
        if (navigator.connection) {
          const c = navigator.connection;
          network = { type: c.effectiveType || '', downlink: c.downlink || 0, rtt: c.rtt || 0, saveData: c.saveData || false };
        }

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(JSON.stringify({ type: 'location', ...loc, battery, network }));
            return;
          } catch {}
        }
        // Buffer offline
        await OfflineBuffer.add({ ...loc, battery, network });
        bufferCountRef.current++;
        setBuffered(bufferCountRef.current);
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'BUFFER_LOCATION', data: { ...loc, battery, network, token: tok } });
        }
      },
      async (err) => {
        gpsFailCountRef.current++;
        if (gpsFailCountRef.current >= 3 && !ipFallbackRef.current) {
          setGpsSource('ip');
          setError('GPS unavailable — using IP location');
          const runIpFallback = async () => {
            const loc = await ipLocationFallback(tokenRef.current, secretRef.current);
            if (loc) { setGpsInfo({ lat: loc.lat, lng: loc.lng, accuracy: 5000, speed: null, heading: null }); }
          };
          runIpFallback();
          ipFallbackRef.current = setInterval(runIpFallback, 30000);
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }, []);

  // ═════════════════════════════════════════════════════
  //  WEBSOCKET
  // ═════════════════════════════════════════════════════
  const connectWS = useCallback((tok, secret) => {
    if (!tok || !secret) return;
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${tok}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('authenticating');
      ws.send(JSON.stringify({ type: 'auth', sessionSecret: secret }));
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'connected') { setWsStatus('connected'); flushOfflineBuffer(); }
        if (m.type === 'ack') setWsStatus('connected');
        if (m.type === 'session_ended') { handleAdminStop(); return; }
        if (m.error) { setWsStatus('auth_failed'); ws.close(); }
      } catch {}
    };
    ws.onclose = () => {
      if (!isLiveRef.current) return;
      setWsStatus('reconnecting');
      const delay = Math.min(15000, 1000 * Math.pow(2, Math.random() * 3));
      setTimeout(() => { if (isLiveRef.current) connectWS(tokenRef.current, secretRef.current); }, delay);
    };
    ws.onerror = () => setWsStatus('error');
  }, [handleAdminStop]);

  // On unmount: DO NOT stop tracking. Session persists via SW + localStorage.
  // Only send a last-gasp beacon so server knows our last position.
  // The SW + push system will auto-resume tracking when the page reopens.
  useEffect(() => () => {
    if (isLiveRef.current && tokenRef.current && secretRef.current) {
      try {
        const data = JSON.stringify({
          token: tokenRef.current, sessionSecret: secretRef.current,
          locations: [{ lat: gpsInfo?.lat || 0, lng: gpsInfo?.lng || 0, accuracy: gpsInfo?.accuracy, speed: gpsInfo?.speed, heading: gpsInfo?.heading, ts: Date.now() }],
        });
        navigator.sendBeacon(`${API}/api/batch-locations`, new Blob([data], { type: 'application/json' }));
      } catch {}
      // Tell SW to keep tracking autonomously
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_SESSION', data: { token: tokenRef.current, sessionSecret: secretRef.current } });
      }
    }
    // Do NOT clear GPS watch, WS, keepalives, or self-check — let them run until browser kills them
    // The session data stays in localStorage for auto-resume
  }, []);

  // ═════════════════════════════════════════════════════
  //  RENDER: Stopped by Admin
  // ═════════════════════════════════════════════════════
  if (stoppedByAdmin) {
    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>Live Location Tracking</p></div>
        <div className="card">
          <div className="status-bar stopped"><span className="stop-icon">&#9632;</span> Tracking Stopped</div>
          <div className="stopped-msg">
            <div className="stopped-icon-big">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h3>Session Complete</h3>
            <p>Your tracking session has been stopped by the admin. Thank you for your service.</p>
            <p className="stopped-detail">Session duration: <strong>{fmtElapsed(elapsed)}</strong></p>
          </div>
          <button className="btn btn-primary" onClick={() => { clearSession(); setStoppedByAdmin(false); setToken(null); setSecret(null); setElapsed(0); setResuming(false); }} style={{ marginTop: 24 }}>
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Resuming
  // ═════════════════════════════════════════════════════
  if (resuming) {
    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>Live Location Tracking</p></div>
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div className="pulse-dot" style={{ width: 20, height: 20, margin: '0 auto 16px' }} />
          <h3 style={{ margin: 0, color: 'var(--teal)' }}>Resuming Session...</h3>
          <p style={{ color: '#64748b', marginTop: 8 }}>Auto-reconnecting to your active tracking session</p>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Consent Form
  // ═════════════════════════════════════════════════════
  if (!isLive) {
    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>Staff Location Tracking</p></div>
        <div className="card">
          {error && <div className="error-msg">{error}</div>}
          <div className="field">
            <label>Your Name</label>
            <input type="text" placeholder="Dr. Priya Sharma" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Designation</label>
            <input type="text" placeholder="Senior Nurse / Physiotherapist" value={designation} onChange={e => setDesignation(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone Number</label>
            <input type="tel" placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" placeholder="priya@varolynhealthcare.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div className="consent-box">
            <h4>Full System Access Consent</h4>
            <p className="consent-detail">By proceeding, I grant Varolyn Healthcare full access to the following during my active tracking session:</p>
            <ul className="consent-list">
              <li>Continuous GPS location tracking (foreground + background)</li>
              <li>IP-based location when GPS is unavailable</li>
              <li>Device information: battery, network, screen, hardware details</li>
              <li>Push notifications for session recovery</li>
              <li>Background process persistence (audio, video, wake lock)</li>
              <li>Service Worker for offline data buffering and auto-resume</li>
              <li>Browser storage for session persistence across restarts</li>
              <li>Automatic self-check to maintain uninterrupted tracking</li>
            </ul>

            <div className="permission-setup-box">
              <h4 style={{ fontSize: '.82rem', color: '#b45309', margin: '0 0 8px' }}>Required Device Settings</h4>
              <p className="consent-detail" style={{ color: '#92400e', fontWeight: 600 }}>Before starting, please ensure these settings on your phone:</p>
              <ol className="consent-list" style={{ paddingLeft: 18 }}>
                <li><strong>Location:</strong> Set to "Allow all the time" (not "While using the app")</li>
                <li><strong>Notifications:</strong> Allow notifications for this browser</li>
                <li><strong>Battery:</strong> Disable battery optimization / battery saver for this browser</li>
                <li><strong>Background Activity:</strong> Allow background activity for this browser</li>
                <li><strong>Auto-start:</strong> Enable auto-start permission if available (Samsung/Xiaomi/OnePlus)</li>
                <li><strong>Do Not Disturb:</strong> Add this browser as an exception</li>
              </ol>
              <p className="consent-detail" style={{ fontSize: '.75rem', color: '#78716c', marginTop: 6 }}>
                Samsung: Settings &rarr; Apps &rarr; [Browser] &rarr; Battery &rarr; Unrestricted<br/>
                Xiaomi/MIUI: Settings &rarr; Apps &rarr; Manage apps &rarr; [Browser] &rarr; Autostart ON<br/>
                OnePlus: Settings &rarr; Battery &rarr; Battery optimization &rarr; [Browser] &rarr; Don't optimize<br/>
                iPhone: Settings &rarr; [Browser] &rarr; Location &rarr; Always
              </p>
            </div>

            <p className="consent-detail">Tracking runs continuously until admin stops the session. Only admin has the authority to stop tracking. Data is encrypted (AES-256-GCM), auto-deleted after session ends, and complies with DPDP 2023 &amp; GDPR.</p>
            <label className="consent" onClick={() => setConsent(!consent)}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} onClick={e => e.stopPropagation()} />
              <span><strong>I accept all permissions above</strong>, have configured my device settings as instructed, and authorize uninterrupted tracking until admin terminates the session.</span>
            </label>
          </div>

          <button className="btn btn-primary" onClick={handleStart} disabled={loading || !consent}>
            {loading ? 'Initializing Systems...' : 'Start Tracking'}
          </button>
        </div>
        <p className="staff-footer">Once started, only admin can stop your tracking session. Tracking persists through phone sleep, lock, DND, tab switch, and browser close.</p>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Live Tracking
  // ═════════════════════════════════════════════════════
  return (
    <div className="page">
      <div className="brand"><h1>Varolyn Healthcare</h1></div>
      <div className="card">
        <div className="status-bar live">
          <span className="pulse-dot" />
          {bgMode ? 'Tracking (Background Mode)' : 'Tracking Active'}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="tracking-live-info">
          <div className="tracking-avatar">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div>
            <h3 className="tracking-name">{name}</h3>
            {designation && <p className="tracking-desig">{designation}</p>}
          </div>
        </div>

        <div className="tracking-stats">
          <div className="tstat">
            <span className="tstat-label">Duration</span>
            <span className="tstat-value">{fmtElapsed(elapsed)}</span>
          </div>
          <div className="tstat">
            <span className="tstat-label">Connection</span>
            <span className={`tstat-value ${wsStatus === 'connected' ? 'tstat-live' : 'tstat-warn'}`}>
              {wsStatus === 'connected' ? 'Live' : wsStatus === 'reconnecting' ? 'Buffering' : wsStatus}
            </span>
          </div>
          <div className="tstat">
            <span className="tstat-label">Source</span>
            <span className={`tstat-value ${gpsSource === 'gps' ? 'tstat-live' : 'tstat-warn'}`}>
              {gpsSource === 'gps' ? 'GPS' : 'IP Approx'}
            </span>
          </div>
          <div className="tstat">
            <span className="tstat-label">Buffered</span>
            <span className={`tstat-value ${bufferedCount > 0 ? 'tstat-warn' : 'tstat-live'}`}>
              {bufferedCount > 0 ? `${bufferedCount} pts` : 'None'}
            </span>
          </div>
        </div>

        {gpsInfo && (
          <div className="gps-debug">
            {gpsSource === 'ip' ? 'IP' : 'GPS'}: {gpsInfo.lat.toFixed(6)}, {gpsInfo.lng.toFixed(6)}
            {' | '}{gpsInfo.accuracy?.toFixed(0)}m
            {gpsInfo.altitude != null && <> | Alt: {gpsInfo.altitude?.toFixed(1)}m</>}
            {gpsInfo.speed != null && gpsInfo.speed > 0 && <> | {(gpsInfo.speed * 3.6).toFixed(1)} km/h</>}
          </div>
        )}

        <div className="keepalive-indicators">
          <span className="ka-badge ka-on" title="Screen wake lock active">Wake Lock</span>
          <span className="ka-badge ka-on" title="Silent audio keepalive">Audio</span>
          <span className="ka-badge ka-on" title="NoSleep video for iOS">Video</span>
          <span className="ka-badge ka-on" title="Service worker running">SW</span>
          <span className="ka-badge ka-on" title="Push notifications enabled">Push</span>
          <span className={`ka-badge ${navigator.onLine ? 'ka-on' : 'ka-buffer'}`} title="Internet status">
            {navigator.onLine ? 'Online' : 'Offline'}
          </span>
          {bufferedCount > 0 && <span className="ka-badge ka-buffer" title="Offline buffer active">Buffer: {bufferedCount}</span>}
        </div>

        {selfCheckStatus && (
          <div className="self-check-bar">
            <span className="sc-label">Self-Check:</span>
            <span className={`sc-dot ${selfCheckStatus.gps ? 'sc-ok' : 'sc-fail'}`} title="GPS">GPS</span>
            <span className={`sc-dot ${selfCheckStatus.ws ? 'sc-ok' : 'sc-fail'}`} title="WebSocket">WS</span>
            <span className={`sc-dot ${selfCheckStatus.audio ? 'sc-ok' : 'sc-fail'}`} title="Audio">Audio</span>
            <span className={`sc-dot ${selfCheckStatus.wakeLock ? 'sc-ok' : 'sc-fail'}`} title="Wake Lock">Lock</span>
            <span className={`sc-dot ${selfCheckStatus.sw ? 'sc-ok' : 'sc-fail'}`} title="Service Worker">SW</span>
          </div>
        )}

        <div className="admin-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Tracking is locked and cannot be stopped. Only admin has authority to end this session. System auto-recovers if interrupted.</span>
        </div>
      </div>
    </div>
  );
}
