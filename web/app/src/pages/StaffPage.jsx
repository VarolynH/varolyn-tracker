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

// ═══════════════════════════════════════════════════════
//  DEVICE DETECTION — Identify exact phone manufacturer, OS, browser
//  Like Zomato/Uber: know the device, show exact settings path
// ═══════════════════════════════════════════════════════
function detectDevice() {
  const ua = (navigator.userAgent || '').toLowerCase();
  let os = 'unknown', manufacturer = 'unknown', browser = 'unknown';
  if (/iphone|ipad|ipod/.test(ua)) os = 'ios';
  else if (/android/.test(ua)) os = 'android';
  else if (/windows phone/.test(ua)) os = 'windows-phone';
  else if (/windows/.test(ua)) os = 'windows';
  else if (/linux/.test(ua)) os = 'linux';
  else if (/mac/.test(ua)) os = 'macos';

  if (os === 'android') {
    if (/samsung|sm-|gt-/.test(ua)) manufacturer = 'samsung';
    else if (/xiaomi|redmi|poco|miui|mi /.test(ua)) manufacturer = 'xiaomi';
    else if (/oneplus|one plus/.test(ua)) manufacturer = 'oneplus';
    else if (/huawei|honor|hry|yal|els/.test(ua)) manufacturer = 'huawei';
    else if (/oppo|cph|peh/.test(ua)) manufacturer = 'oppo';
    else if (/realme|rmx/.test(ua)) manufacturer = 'realme';
    else if (/vivo/.test(ua)) manufacturer = 'vivo';
    else if (/google|pixel|nexus/.test(ua)) manufacturer = 'google';
    else if (/motorola|moto /.test(ua)) manufacturer = 'motorola';
    else if (/nokia|hmd/.test(ua)) manufacturer = 'nokia';
    else if (/asus|rog/.test(ua)) manufacturer = 'asus';
    else if (/lenovo/.test(ua)) manufacturer = 'lenovo';
    else if (/nothing/.test(ua)) manufacturer = 'nothing';
    else if (/infinix/.test(ua)) manufacturer = 'infinix';
    else if (/tecno/.test(ua)) manufacturer = 'tecno';
    else if (/itel/.test(ua)) manufacturer = 'itel';
    else if (/lava/.test(ua)) manufacturer = 'lava';
    else if (/micromax/.test(ua)) manufacturer = 'micromax';
    else manufacturer = 'android-generic';
  } else if (os === 'ios') { manufacturer = 'apple'; }

  if (/samsungbrowser/.test(ua)) browser = 'samsung-internet';
  else if (/brave/.test(ua)) browser = 'brave';
  else if (/edg/.test(ua)) browser = 'edge';
  else if (/opr|opera/.test(ua)) browser = 'opera';
  else if (/firefox|fxios/.test(ua)) browser = 'firefox';
  else if (/crios/.test(ua)) browser = 'chrome';
  else if (/chrome/.test(ua) && !/edg/.test(ua)) browser = 'chrome';
  else if (/safari/.test(ua) && !/chrome/.test(ua)) browser = 'safari';
  else browser = 'other';

  return { os, manufacturer, browser };
}

/** Device-specific settings guide — exact paths like Zomato/Uber delivery app */
function getDeviceGuide(device) {
  const bn = device.browser === 'chrome' ? 'Chrome' :
    device.browser === 'samsung-internet' ? 'Samsung Internet' :
    device.browser === 'firefox' ? 'Firefox' :
    device.browser === 'edge' ? 'Edge' :
    device.browser === 'brave' ? 'Brave' :
    device.browser === 'opera' ? 'Opera' : 'Browser';

  const g = { battery: [], autostart: [], background: [], location: [], notification: [], dnd: [], dataSaver: [] };

  if (device.os === 'android') {
    // ── LOCATION ──
    g.location = [
      { text: `Open phone Settings`, bold: true },
      { text: `Go to "Location" → "App permissions"` },
      { text: `Find "${bn}" → Select "Allow all the time"`, bold: true, critical: true },
      { text: `Enable "Use precise location" toggle`, bold: true, critical: true },
    ];

    // ── NOTIFICATION ──
    g.notification = [
      { text: `Settings → Apps → "${bn}" → Notifications`, bold: true },
      { text: `Enable "Allow notifications"`, critical: true },
      { text: `Enable ALL notification categories (don't leave any off)` },
    ];

    // ── DATA SAVER ──
    g.dataSaver = [
      { text: `Settings → Network → Data Saver` },
      { text: `If Data Saver is ON: Add "${bn}" to "Unrestricted data" list`, critical: true },
    ];

    // ── MANUFACTURER-SPECIFIC ──
    if (device.manufacturer === 'samsung') {
      g.battery = [
        { text: `Settings → Apps → "${bn}" → Battery`, bold: true },
        { text: `Select "Unrestricted"`, bold: true, critical: true },
        { text: `Go back: Settings → Battery and device care → Battery` },
        { text: `Tap "Background usage limits"` },
        { text: `Remove "${bn}" from "Sleeping apps"`, critical: true },
        { text: `Remove "${bn}" from "Deep sleeping apps"`, critical: true },
        { text: `Turn OFF "Adaptive battery" (optional but recommended)` },
      ];
      g.autostart = [
        { text: `Samsung auto-manages apps. Just ensure ${bn} is NOT in sleeping apps list above.` },
      ];
      g.background = [
        { text: `Settings → Apps → "${bn}" → Mobile data`, bold: true },
        { text: `Enable "Allow background data usage"`, critical: true },
        { text: `Enable "Allow data usage while Data saver is on"`, critical: true },
      ];
    } else if (device.manufacturer === 'xiaomi') {
      g.battery = [
        { text: `Settings → Apps → Manage apps → "${bn}"`, bold: true },
        { text: `Tap "Battery saver" → Select "No restrictions"`, bold: true, critical: true },
        { text: `Also: Settings → Battery & performance` },
        { text: `Tap gear icon → App battery saver → "${bn}" → No restrictions` },
      ];
      g.autostart = [
        { text: `Settings → Apps → Manage apps → "${bn}"`, bold: true },
        { text: `Enable "Autostart" toggle`, bold: true, critical: true },
        { text: `Also: Settings → Permissions → Autostart → Enable "${bn}"` },
      ];
      g.background = [
        { text: `Settings → Apps → Manage apps → "${bn}"`, bold: true },
        { text: `Enable "Allow background activity"`, critical: true },
        { text: `Lock app in recent apps: Open ${bn}, swipe down on its card in recent apps to lock it` },
      ];
    } else if (device.manufacturer === 'oneplus') {
      g.battery = [
        { text: `Settings → Battery → Battery optimization`, bold: true },
        { text: `Find "${bn}" → Select "Don't optimize"`, bold: true, critical: true },
        { text: `Also: Settings → Battery → Advanced → Optimize battery use` },
        { text: `Disable optimization for "${bn}"` },
      ];
      g.autostart = [
        { text: `Settings → Apps → App management → "${bn}"`, bold: true },
        { text: `Enable "Auto-launch"`, critical: true },
      ];
      g.background = [
        { text: `Settings → Apps → App management → "${bn}"`, bold: true },
        { text: `Enable "Allow background activity"`, critical: true },
      ];
    } else if (device.manufacturer === 'huawei') {
      g.battery = [
        { text: `Settings → Battery → App launch`, bold: true },
        { text: `Find "${bn}" → Toggle OFF automatic management`, bold: true, critical: true },
        { text: `Turn ON all three: Auto-launch, Secondary launch, Run in background`, bold: true, critical: true },
      ];
      g.autostart = [
        { text: `Covered in Battery settings above — enable "Auto-launch" for "${bn}"` },
      ];
      g.background = [
        { text: `Covered in Battery settings above — enable "Run in background" for "${bn}"` },
      ];
    } else if (device.manufacturer === 'oppo') {
      g.battery = [
        { text: `Settings → Battery → More battery settings`, bold: true },
        { text: `"Optimize battery use" → "${bn}" → Don't optimize`, critical: true },
        { text: `Also: Settings → Battery → Energy Saver → disable for "${bn}"` },
      ];
      g.autostart = [
        { text: `Settings → App management → "${bn}" → Auto-start → Enable`, bold: true, critical: true },
        { text: `Also: Settings → Privacy → Startup manager → Enable "${bn}"` },
      ];
      g.background = [
        { text: `Settings → App management → "${bn}" → Allow background activity`, critical: true },
      ];
    } else if (device.manufacturer === 'realme') {
      g.battery = [
        { text: `Settings → Battery → More battery settings`, bold: true },
        { text: `"Optimize battery use" → "${bn}" → Don't optimize`, critical: true },
      ];
      g.autostart = [
        { text: `Settings → App management → "${bn}" → Auto-start → Enable`, bold: true, critical: true },
        { text: `Also check: Settings → App management → Startup manager` },
      ];
      g.background = [
        { text: `Settings → App management → "${bn}" → Allow background activity`, critical: true },
      ];
    } else if (device.manufacturer === 'vivo') {
      g.battery = [
        { text: `Settings → Battery → Background power consumption management`, bold: true },
        { text: `Find "${bn}" → Select "Don't restrict"`, critical: true },
        { text: `Also: Settings → Battery → High background power consumption → Allow "${bn}"` },
      ];
      g.autostart = [
        { text: `Settings → More settings → Applications → Autostart`, bold: true },
        { text: `Enable "${bn}"`, critical: true },
        { text: `Also: i Manager → App manager → Autostart manager → Enable "${bn}"` },
      ];
      g.background = [
        { text: `Settings → Apps → "${bn}" → Allow background activity`, critical: true },
      ];
    } else if (device.manufacturer === 'google' || device.manufacturer === 'motorola' || device.manufacturer === 'nokia' || device.manufacturer === 'nothing') {
      g.battery = [
        { text: `Settings → Apps → "${bn}" → Battery`, bold: true },
        { text: `Select "Unrestricted"`, bold: true, critical: true },
        { text: `Also: Settings → Battery → Adaptive Battery → turn OFF (optional)` },
      ];
      g.autostart = [{ text: `Stock Android: No autostart setting needed.` }];
      g.background = [
        { text: `Settings → Apps → "${bn}" → Mobile data & Wi-Fi`, bold: true },
        { text: `Enable "Background data"`, critical: true },
      ];
    } else {
      // Generic Android
      g.battery = [
        { text: `Settings → Apps → "${bn}" → Battery`, bold: true },
        { text: `Select "Unrestricted" or "Don't optimize"`, bold: true, critical: true },
        { text: `Settings → Battery → Battery optimization → "${bn}" → Don't optimize` },
      ];
      g.autostart = [
        { text: `Check Settings → Apps → "${bn}" for any "Autostart" toggle` },
        { text: `If available, enable it` },
      ];
      g.background = [
        { text: `Settings → Apps → "${bn}" → Mobile data`, bold: true },
        { text: `Enable "Background data"`, critical: true },
      ];
    }

    // ── DND ──
    g.dnd = [
      { text: `Settings → Sound → Do Not Disturb → Apps` },
      { text: `Add "${bn}" as an exception so notifications still come through` },
    ];

  } else if (device.os === 'ios') {
    g.location = [
      { text: `Open Settings → Privacy & Security → Location Services`, bold: true },
      { text: `Find "${bn}" → Select "Always"`, bold: true, critical: true },
      { text: `Enable "Precise Location" toggle`, bold: true, critical: true },
    ];
    g.notification = [
      { text: `Settings → Notifications → "${bn}"`, bold: true },
      { text: `Enable "Allow Notifications"`, critical: true },
      { text: `Set "Banner Style" to "Persistent"` },
      { text: `Enable "Time Sensitive Notifications" if available` },
    ];
    g.battery = [
      { text: `Settings → Battery → Low Power Mode`, bold: true },
      { text: `Turn OFF Low Power Mode while tracking`, critical: true },
      { text: `Note: iOS manages battery automatically for background apps` },
    ];
    g.background = [
      { text: `Settings → General → Background App Refresh`, bold: true },
      { text: `Enable Background App Refresh for "${bn}"`, bold: true, critical: true },
      { text: `Ensure Wi-Fi & Cellular Data is selected (not Wi-Fi only)` },
    ];
    g.autostart = [{ text: `iOS handles auto-start automatically. No action needed.` }];
    g.dnd = [
      { text: `Settings → Focus → Do Not Disturb` },
      { text: `Under "Allowed Apps", add "${bn}"`, critical: true },
    ];
    g.dataSaver = [
      { text: `Settings → Cellular → "${bn}"` },
      { text: `Enable cellular data for "${bn}"`, critical: true },
    ];

  } else {
    // Desktop / Linux / other
    g.location = [{ text: `Allow location access when browser prompts`, bold: true }];
    g.notification = [{ text: `Allow notification access when browser prompts`, bold: true }];
    g.battery = [{ text: `Disable power saving / sleep mode while tracking`, bold: true }];
    g.background = [{ text: `Keep the browser window open (can be minimized)` }];
    g.autostart = [];
    g.dnd = [];
    g.dataSaver = [];
  }

  return g;
}

/** Low-accuracy geolocation (WiFi triangulation + Cell tower) — browser handles this internally */
async function getWifiCellLocation(timeout = 10000) {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy, speed: pos.coords.speed,
        heading: pos.coords.heading, source: 'wifi-cell',
      }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 30000, timeout } // LOW accuracy = WiFi + Cell towers
    );
  });
}

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

/** IP geolocation — DISABLED. IP is 5-20km wrong (showed Memari instead of Bohar).
 *  GPS and WiFi/cell triangulation are the ONLY location sources.
 *  This function now does NOTHING — kept as stub to avoid breaking references. */
async function ipLocationFallback() {
  return null; // DISABLED — IP location is too inaccurate, was overwriting real GPS
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

  // ── PERMISSION GATE STATE (Zomato/Uber style) ──
  const [permPhase, setPermPhase] = useState(null); // null | 'checking' | 'failed' | 'device-settings' | 'ready'
  const [permChecks, setPermChecks] = useState({
    location: 'pending', notification: 'pending', serviceWorker: 'pending',
    wakeLock: 'pending', storage: 'pending', gpsTest: 'pending',
  });
  const [permFailReason, setPermFailReason] = useState(null);
  const [detectedDevice, setDetectedDevice] = useState(null);
  const [deviceGuide, setDeviceGuide] = useState(null);
  const [settingsConfirmed, setSettingsConfirmed] = useState({
    battery: false, autostart: false, background: false, dnd: false, dataSaver: false,
  });
  const lowAccuracyWatchRef = useRef(null);

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
  //  PERMISSION GATE — AGGRESSIVE LIKE ZOMATO/UBER
  //  Staff CANNOT start tracking until EVERY permission is verified.
  //  Each permission is tested, not just requested.
  //  Device settings are detected and staff must confirm completion.
  // ═════════════════════════════════════════════════════

  /** Quick re-request for auto-resume (doesn't block UI) */
  const requestAllPermissions = async () => {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {}
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIPWAITING' });
        await navigator.serviceWorker.ready;
      }
    } catch {}
    try { await new Promise((r) => navigator.geolocation.getCurrentPosition(r, r, { enableHighAccuracy: true, timeout: 10000 })); } catch {}
    try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
    try { if (screen.orientation?.lock) await screen.orientation.lock('portrait-primary').catch(() => {}); } catch {}
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'periodicSync' in reg) {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') await reg.periodicSync.register('varolyn-location-sync', { minInterval: 60000 });
      }
    } catch {}
    try { if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: 'SHOW_PERSISTENT' }); } catch {}
    return true;
  };

  /** FULL permission gate — runs on first start, blocks until ALL pass */
  const runPermissionGate = async () => {
    setPermPhase('checking');
    setPermFailReason(null);
    const checks = { location: 'pending', notification: 'pending', serviceWorker: 'pending', wakeLock: 'pending', storage: 'pending', gpsTest: 'pending' };
    setPermChecks({ ...checks });

    // ── STEP 1: LOCATION PERMISSION ──
    checks.location = 'checking'; setPermChecks({ ...checks });
    try {
      const locPerm = await navigator.permissions.query({ name: 'geolocation' });
      if (locPerm.state === 'denied') {
        checks.location = 'denied'; setPermChecks({ ...checks });
        setPermFailReason({ perm: 'Location Access', reason: 'Location permission is BLOCKED. You must enable it in your browser settings.', fix: 'Open your browser settings → Site permissions → Location → Allow for this site. Then click Retry.' });
        setPermPhase('failed'); return false;
      }
      if (locPerm.state === 'prompt') {
        const granted = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), { enableHighAccuracy: true, timeout: 30000 });
        });
        if (!granted) {
          checks.location = 'denied'; setPermChecks({ ...checks });
          setPermFailReason({ perm: 'Location Access', reason: 'You DENIED location access. This is REQUIRED for tracking.', fix: 'You must allow location access to proceed. Go to browser settings → Site permissions → Location → Allow. Then click Retry.' });
          setPermPhase('failed'); return false;
        }
      }
      checks.location = 'granted'; setPermChecks({ ...checks });
    } catch {
      checks.location = 'error'; setPermChecks({ ...checks });
      setPermFailReason({ perm: 'Location Access', reason: 'Could not check location permission.', fix: 'Please ensure location services are enabled on your device and try again.' });
      setPermPhase('failed'); return false;
    }

    // ── STEP 2: ACTUALLY TEST GPS (not just permission — real position) ──
    checks.gpsTest = 'checking'; setPermChecks({ ...checks });
    try {
      const testPos = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
      });
      if (!testPos) {
        // Try low accuracy (WiFi/cell)
        const wifiPos = await getWifiCellLocation(15000);
        if (!wifiPos) {
          checks.gpsTest = 'error'; setPermChecks({ ...checks });
          setPermFailReason({ perm: 'GPS Signal', reason: 'Cannot get any location. GPS, WiFi, and cell tower location all failed.', fix: 'Make sure: (1) Location/GPS is turned ON, (2) You are not in airplane mode, (3) WiFi is ON (helps location accuracy). Move to an open area if indoors. Then click Retry.' });
          setPermPhase('failed'); return false;
        }
      }
      checks.gpsTest = 'granted'; setPermChecks({ ...checks });
    } catch {
      checks.gpsTest = 'error'; setPermChecks({ ...checks });
    }

    // ── STEP 3: NOTIFICATION PERMISSION (MANDATORY for Android persistence) ──
    checks.notification = 'checking'; setPermChecks({ ...checks });
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'denied') {
          checks.notification = 'denied'; setPermChecks({ ...checks });
          setPermFailReason({ perm: 'Notifications', reason: 'Notification permission is BLOCKED. Without notifications, tracking WILL STOP when you close the browser.', fix: 'Go to browser settings → Site permissions → Notifications → Allow for this site. Then click Retry.' });
          setPermPhase('failed'); return false;
        }
        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission();
          if (result !== 'granted') {
            checks.notification = 'denied'; setPermChecks({ ...checks });
            setPermFailReason({ perm: 'Notifications', reason: 'You DENIED notifications. Tracking CANNOT work without notifications.', fix: 'Notifications keep tracking alive in background. Go to browser settings → Site permissions → Notifications → Allow. Then click Retry.' });
            setPermPhase('failed'); return false;
          }
        }
      }
      checks.notification = 'granted'; setPermChecks({ ...checks });
    } catch {
      checks.notification = 'error'; setPermChecks({ ...checks });
    }

    // ── STEP 4: SERVICE WORKER REGISTRATION ──
    checks.serviceWorker = 'checking'; setPermChecks({ ...checks });
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIPWAITING' });
        await navigator.serviceWorker.ready;
        checks.serviceWorker = 'granted'; setPermChecks({ ...checks });
      } else {
        checks.serviceWorker = 'error'; setPermChecks({ ...checks });
      }
    } catch {
      checks.serviceWorker = 'error'; setPermChecks({ ...checks });
    }

    // ── STEP 5: WAKE LOCK (test it works) ──
    checks.wakeLock = 'checking'; setPermChecks({ ...checks });
    try {
      if ('wakeLock' in navigator) {
        const wl = await navigator.wakeLock.request('screen');
        checks.wakeLock = 'granted'; setPermChecks({ ...checks });
        wl.release();
      } else {
        checks.wakeLock = 'granted'; setPermChecks({ ...checks }); // No API = still OK
      }
    } catch {
      checks.wakeLock = 'granted'; setPermChecks({ ...checks }); // Non-critical
    }

    // ── STEP 6: PERSISTENT STORAGE ──
    checks.storage = 'checking'; setPermChecks({ ...checks });
    try {
      if (navigator.storage?.persist) {
        await navigator.storage.persist();
      }
      checks.storage = 'granted'; setPermChecks({ ...checks });
    } catch {
      checks.storage = 'granted'; setPermChecks({ ...checks }); // Non-critical
    }

    // ── STEP 7: ORIENTATION LOCK ──
    try { if (screen.orientation?.lock) await screen.orientation.lock('portrait-primary').catch(() => {}); } catch {}

    // ── STEP 8: SHOW PERSISTENT NOTIFICATION ──
    try { if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: 'SHOW_PERSISTENT' }); } catch {}

    // ── STEP 9: BACKGROUND SYNC ──
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'periodicSync' in reg) {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') await reg.periodicSync.register('varolyn-location-sync', { minInterval: 60000 });
      }
      if (reg && 'sync' in reg) await reg.sync.register('varolyn-sync');
    } catch {}

    // ══ ALL BROWSER PERMISSIONS PASSED — NOW SHOW DEVICE SETTINGS ══
    const device = detectDevice();
    setDetectedDevice(device);
    const guide = getDeviceGuide(device);
    setDeviceGuide(guide);

    // Check if device needs manual settings (Android/iOS need it, desktop doesn't)
    const needsDeviceSettings = device.os === 'android' || device.os === 'ios';
    if (needsDeviceSettings) {
      setPermPhase('device-settings');
      return 'device-settings'; // Caller must wait for user confirmation
    }

    setPermPhase('ready');
    return true;
  };

  /** Check if all required device settings are confirmed */
  const allSettingsConfirmed = () => {
    if (!detectedDevice) return false;
    if (detectedDevice.os === 'android') {
      return settingsConfirmed.battery && settingsConfirmed.background;
    }
    if (detectedDevice.os === 'ios') {
      return settingsConfirmed.battery && settingsConfirmed.background;
    }
    return true; // Desktop doesn't need confirmation
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
          // GPS failed — try WiFi/cell triangulation, NOT IP
          try {
            const wifiLoc = await getWifiCellLocation(10000);
            if (wifiLoc && wifiLoc.accuracy < 3000) {
              setGpsSource('wifi-cell');
              setGpsInfo({ lat: wifiLoc.lat, lng: wifiLoc.lng, accuracy: wifiLoc.accuracy, speed: wifiLoc.speed, heading: wifiLoc.heading, source: 'wifi-cell' });
              if (navigator.onLine) {
                fetch(`${API}/api/batch-locations`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current, locations: [{ ...wifiLoc, ts: Date.now() }] }),
                }).catch(() => {});
              }
              resolve(true); return;
            }
          } catch {}
          // DO NOT call ip-location here — it overwrites real GPS with 20km wrong data
          resolve(false);
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 }
      );
    });
  };

  // ═════════════════════════════════════════════════════
  //  SELF-CHECK LOOP — every 60s, verify + force-fix everything
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

    // ── 9. If GPS watcher failed AND online → try WiFi/cell FIRST, IP only as absolute last resort ──
    if (!checks.gps && checks.online) {
      // Try WiFi/cell triangulation first (much more accurate than IP)
      try {
        const wifiLoc = await getWifiCellLocation(10000);
        if (wifiLoc && wifiLoc.accuracy < 3000) {
          setGpsSource('wifi-cell');
          checks.ip = true; // Mark as recovered
          setGpsInfo({ lat: wifiLoc.lat, lng: wifiLoc.lng, accuracy: wifiLoc.accuracy, speed: null, heading: null, source: 'wifi-cell' });
          // Send WiFi/cell location to server
          fetch(`${API}/api/batch-locations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current, locations: [{ ...wifiLoc, ts: Date.now() }] }),
          }).catch(() => {});
        }
      } catch {}
      // DO NOT start IP fallback from self-check — IP is 5-20km wrong
      // The server already has a 30-min guard protecting GPS data from IP overwrite
      // GPS will recover on its own when page regains focus / push reopens it
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
          async () => {
            // GPS failed in background — try WiFi/cell triangulation first, then IP
            gpsFailCountRef.current++;
            // Try WiFi/cell triangulation (low accuracy mode)
            if (gpsFailCountRef.current >= 2) {
              try {
                const wifiLoc = await getWifiCellLocation(10000);
                if (wifiLoc && wifiLoc.accuracy < 3000) {
                  setGpsSource('wifi-cell');
                  fetch(`${API}/api/batch-locations`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current, locations: [{ ...wifiLoc, ts: Date.now() }] }),
                  }).catch(() => {});
                  return; // WiFi/cell worked, don't fall to IP
                }
              } catch {}
            }
            // DO NOT call ip-location from polling — server protects GPS data for 30 min
            // IP is 5-20km wrong and overwrites real GPS position on dashboard
            // The heartbeat already confirms device is alive — no need for IP update
          },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
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
  //  START SESSION — Two-phase: permissions first, then start
  // ═════════════════════════════════════════════════════

  /** Phase 1: Validate form + run permission gate */
  const handleStartPermissions = async () => {
    setError('');
    if (!name.trim() || !phone.trim() || !email.trim())
      return setError('Please fill in all fields');
    if (!consent)
      return setError('Full system consent is required to proceed');

    setLoading(true);
    try {
      const result = await runPermissionGate();
      if (result === false) {
        // Permission failed — gate UI is showing
        setLoading(false);
        return;
      }
      if (result === 'device-settings') {
        // Need device settings confirmation — gate UI is showing
        setLoading(false);
        return;
      }
      // All permissions + settings OK → start session
      await handleStartSession();
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  /** Phase 2: After all permissions confirmed → actually start tracking */
  const handleStartSession = async () => {
    setLoading(true);
    setError('');
    try {
      const deviceInfo = await collectFullDeviceInfo();
      // Add detected device info
      if (detectedDevice) {
        deviceInfo.detectedDevice = detectedDevice;
        deviceInfo.permissionChecks = permChecks;
        deviceInfo.settingsConfirmed = settingsConfirmed;
      }

      const res = await fetch(`${API}/api/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffName: name.trim(), staffPhone: phone.trim(), staffEmail: email.trim(),
          designation: designation.trim(), consentGps: true,
          consentFull: true,
          deviceInfo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      setToken(data.token);
      setSecret(data.sessionSecret);
      setIsLive(true);
      setStoppedByAdmin(false);
      setPermPhase(null); // Close permission gate
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
    if (lowAccuracyWatchRef.current != null) { navigator.geolocation.clearWatch(lowAccuracyWatchRef.current); lowAccuracyWatchRef.current = null; }
    if (ipFallbackRef.current) { clearInterval(ipFallbackRef.current); ipFallbackRef.current = null; }
    if (selfCheckRef.current) { clearInterval(selfCheckRef.current); selfCheckRef.current = null; }
    wsRef.current = null;
    stopAllKeepAlives();
    clearSession();
    // Tell SW to clear session AND remove persistent notification
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
  //  GPS — DUAL MODE: High Accuracy (GPS) + Low Accuracy (WiFi/Cell)
  //  Chain: GPS chip → WiFi triangulation → Cell tower → IP fallback
  //  The browser's geolocation API with enableHighAccuracy:false automatically
  //  uses WiFi scanning + cell tower triangulation (same as Zomato/Uber).
  // ═════════════════════════════════════════════════════
  const startGPS = useCallback((tok) => {
    if (!navigator.geolocation) return setError('GPS not supported');
    // Clear any existing watchers
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (lowAccuracyWatchRef.current != null) navigator.geolocation.clearWatch(lowAccuracyWatchRef.current);

    // ── PRIMARY: High accuracy GPS chip ──
    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        gpsFailCountRef.current = 0;
        if (ipFallbackRef.current) {
          clearInterval(ipFallbackRef.current); ipFallbackRef.current = null;
        }
        setGpsSource('gps');
        const loc = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, speed: pos.coords.speed,
          heading: pos.coords.heading, altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy, source: 'gps',
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

        // ── SECONDARY: WiFi + Cell tower triangulation (low accuracy mode) ──
        // This is what Zomato/Uber use when GPS fails — browser scans nearby
        // WiFi access points and cell towers to triangulate position.
        if (gpsFailCountRef.current >= 2) {
          setGpsSource('wifi-cell');
          setError('GPS weak — using WiFi/cell tower triangulation');
          try {
            const wifiLoc = await getWifiCellLocation(15000);
            if (wifiLoc) {
              setGpsInfo({ lat: wifiLoc.lat, lng: wifiLoc.lng, accuracy: wifiLoc.accuracy, speed: wifiLoc.speed, heading: wifiLoc.heading, source: 'wifi-cell' });
              // Send this location
              let battery = null, network = null;
              try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { level: Math.round(b.level * 100), charging: b.charging }; } } catch {}
              if (navigator.connection) { const c = navigator.connection; network = { type: c.effectiveType || '', downlink: c.downlink || 0, rtt: c.rtt || 0 }; }
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                try { wsRef.current.send(JSON.stringify({ type: 'location', ...wifiLoc, battery, network })); } catch {}
              } else if (navigator.onLine) {
                fetch(`${API}/api/batch-locations`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current, locations: [{ ...wifiLoc, battery, network, ts: Date.now() }] }),
                }).catch(() => {});
              } else {
                await OfflineBuffer.add({ ...wifiLoc, battery, network });
                bufferCountRef.current++; setBuffered(bufferCountRef.current);
              }
              return; // WiFi/cell worked, don't fall to IP
            }
          } catch {}
        }

        // ── IP geolocation: COMPLETELY DISABLED ──
        // IP was showing Memari instead of Bohar (20km wrong)
        // Server endpoint is also disabled from updating coordinates
        // WiFi/cell triangulation above is the last fallback
        if (gpsFailCountRef.current >= 10) {
          setError('GPS weak — move to open area for better signal');
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );

    // ── BACKUP LOW-ACCURACY WATCHER — always running in parallel ──
    // When GPS dies (indoors, background), this picks up WiFi/cell location
    // It only sends data if the high-accuracy watcher has failed
    lowAccuracyWatchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        // Only use this if high-accuracy GPS has been failing
        if (gpsFailCountRef.current < 2) return;
        const loc = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, speed: pos.coords.speed,
          heading: pos.coords.heading, source: 'wifi-cell-backup',
        };
        // Only update if this is better than current IP fallback
        if (loc.accuracy < 3000) {
          setGpsInfo(loc);
          setGpsSource('wifi-cell');
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            try { wsRef.current.send(JSON.stringify({ type: 'location', ...loc })); } catch {}
          } else if (navigator.onLine) {
            fetch(`${API}/api/batch-locations`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: tokenRef.current, sessionSecret: secretRef.current, locations: [{ ...loc, ts: Date.now() }] }),
            }).catch(() => {});
          }
        }
      },
      () => {}, // Silent fail
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }, // LOW accuracy = WiFi + cell towers
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
  //  RENDER: Permission Gate — Checking Permissions
  // ═════════════════════════════════════════════════════
  if (!isLive && permPhase === 'checking') {
    const statusIcon = (s) => s === 'granted' ? '✅' : s === 'checking' ? '🔄' : s === 'denied' ? '❌' : s === 'error' ? '⚠️' : '⏳';
    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>System Permission Check</p></div>
        <div className="card">
          <div className="perm-gate-header">
            <div className="perm-gate-spinner" />
            <h3 style={{ margin: '12px 0 4px', color: 'var(--teal)' }}>Verifying System Permissions</h3>
            <p style={{ color: '#64748b', fontSize: '.85rem', margin: 0 }}>Each permission is being tested on your device...</p>
          </div>
          <div className="perm-checklist">
            <div className="perm-item">{statusIcon(permChecks.location)} <span>Location Access</span></div>
            <div className="perm-item">{statusIcon(permChecks.gpsTest)} <span>GPS Signal Test</span></div>
            <div className="perm-item">{statusIcon(permChecks.notification)} <span>Notification Permission</span></div>
            <div className="perm-item">{statusIcon(permChecks.serviceWorker)} <span>Background Service</span></div>
            <div className="perm-item">{statusIcon(permChecks.wakeLock)} <span>Screen Wake Lock</span></div>
            <div className="perm-item">{statusIcon(permChecks.storage)} <span>Persistent Storage</span></div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Permission Failed — Show Fix Instructions
  // ═════════════════════════════════════════════════════
  if (!isLive && permPhase === 'failed' && permFailReason) {
    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>Permission Required</p></div>
        <div className="card">
          <div className="perm-fail-box">
            <div className="perm-fail-icon">❌</div>
            <h3 style={{ color: '#dc2626', margin: '8px 0' }}>{permFailReason.perm} — REQUIRED</h3>
            <p style={{ color: '#7f1d1d', fontWeight: 600, fontSize: '.9rem' }}>{permFailReason.reason}</p>
            <div className="perm-fix-instructions">
              <h4 style={{ margin: '12px 0 8px', color: '#b45309' }}>How to fix:</h4>
              <p style={{ color: '#92400e', fontSize: '.85rem', lineHeight: 1.6 }}>{permFailReason.fix}</p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => { setPermPhase(null); setPermFailReason(null); handleStartPermissions(); }} style={{ marginTop: 16 }}>
            Retry Permission Check
          </button>
          <button className="btn" onClick={() => { setPermPhase(null); setPermFailReason(null); }} style={{ marginTop: 8, background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0' }}>
            Go Back
          </button>
          <p style={{ color: '#dc2626', fontSize: '.75rem', fontWeight: 600, textAlign: 'center', marginTop: 12 }}>
            You CANNOT start tracking without granting all permissions. This is mandatory for patient safety.
          </p>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Device Settings Gate — AGGRESSIVE ENFORCEMENT
  //  Staff must confirm they've done EACH device setting.
  //  Like Zomato delivery app: step-by-step, no escape.
  // ═════════════════════════════════════════════════════
  if (!isLive && permPhase === 'device-settings' && deviceGuide) {
    const isAndroid = detectedDevice?.os === 'android';
    const isIOS = detectedDevice?.os === 'ios';
    const mfr = detectedDevice?.manufacturer || 'unknown';
    const mfrLabel = mfr === 'samsung' ? 'Samsung' : mfr === 'xiaomi' ? 'Xiaomi/Redmi/POCO' :
      mfr === 'oneplus' ? 'OnePlus' : mfr === 'huawei' ? 'Huawei/Honor' :
      mfr === 'oppo' ? 'OPPO' : mfr === 'realme' ? 'Realme' :
      mfr === 'vivo' ? 'Vivo' : mfr === 'google' ? 'Google Pixel' :
      mfr === 'motorola' ? 'Motorola' : mfr === 'nothing' ? 'Nothing' :
      mfr === 'infinix' ? 'Infinix' : mfr === 'tecno' ? 'Tecno' :
      mfr === 'apple' ? 'Apple iPhone' : 'Android';

    const renderGuideSteps = (steps) => (
      <ol className="device-guide-steps">
        {steps.map((step, i) => (
          <li key={i} className={`guide-step ${step.critical ? 'guide-critical' : ''} ${step.bold ? 'guide-bold' : ''}`}>
            {step.text}
            {step.critical && <span className="guide-required-tag">REQUIRED</span>}
          </li>
        ))}
      </ol>
    );

    const allDone = allSettingsConfirmed();

    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>Device Setup Required</p></div>
        <div className="card">
          <div className="device-detect-banner">
            <span className="device-detect-icon">{isIOS ? '📱' : '📲'}</span>
            <div>
              <strong style={{ color: 'var(--teal)' }}>Detected: {mfrLabel}</strong>
              <p style={{ margin: 0, fontSize: '.75rem', color: '#64748b' }}>{detectedDevice?.browser} on {detectedDevice?.os}</p>
            </div>
          </div>

          <div className="device-settings-warning">
            <strong>MANDATORY DEVICE SETTINGS</strong>
            <p>You MUST complete these settings or tracking will stop when you leave the app. Complete each step below and check the box.</p>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {/* ── BATTERY OPTIMIZATION ── */}
          <div className={`device-setting-block ${settingsConfirmed.battery ? 'setting-done' : 'setting-pending'}`}>
            <div className="setting-header">
              <span className="setting-number">1</span>
              <div>
                <h4 className="setting-title">Battery Optimization — DISABLE</h4>
                <p className="setting-subtitle">Prevents your phone from killing tracking in background</p>
              </div>
              {settingsConfirmed.battery && <span className="setting-check">✅</span>}
            </div>
            {renderGuideSteps(deviceGuide.battery)}
            {deviceGuide.autostart?.length > 0 && deviceGuide.autostart[0]?.text && (
              <div className="setting-sub">
                <strong style={{ fontSize: '.8rem', color: '#b45309' }}>Auto-start (if available):</strong>
                {renderGuideSteps(deviceGuide.autostart)}
              </div>
            )}
            <label className="setting-confirm" onClick={() => setSettingsConfirmed(s => ({...s, battery: !s.battery}))}>
              <input type="checkbox" checked={settingsConfirmed.battery} onChange={e => setSettingsConfirmed(s => ({...s, battery: e.target.checked}))} onClick={e => e.stopPropagation()} />
              <span>I have disabled battery optimization and enabled auto-start (if available)</span>
            </label>
          </div>

          {/* ── BACKGROUND ACTIVITY ── */}
          <div className={`device-setting-block ${settingsConfirmed.background ? 'setting-done' : 'setting-pending'}`}>
            <div className="setting-header">
              <span className="setting-number">2</span>
              <div>
                <h4 className="setting-title">Background Data &amp; Activity — ENABLE</h4>
                <p className="setting-subtitle">Allows tracking to send data when app is in background</p>
              </div>
              {settingsConfirmed.background && <span className="setting-check">✅</span>}
            </div>
            {renderGuideSteps(deviceGuide.background)}
            {deviceGuide.dataSaver?.length > 0 && (
              <div className="setting-sub">
                <strong style={{ fontSize: '.8rem', color: '#b45309' }}>Data Saver exception:</strong>
                {renderGuideSteps(deviceGuide.dataSaver)}
              </div>
            )}
            <label className="setting-confirm" onClick={() => setSettingsConfirmed(s => ({...s, background: !s.background}))}>
              <input type="checkbox" checked={settingsConfirmed.background} onChange={e => setSettingsConfirmed(s => ({...s, background: e.target.checked}))} onClick={e => e.stopPropagation()} />
              <span>I have enabled background data/activity and added data saver exception</span>
            </label>
          </div>

          {/* ── DND (optional but recommended) ── */}
          {deviceGuide.dnd?.length > 0 && (
            <div className={`device-setting-block setting-optional ${settingsConfirmed.dnd ? 'setting-done' : ''}`}>
              <div className="setting-header">
                <span className="setting-number">3</span>
                <div>
                  <h4 className="setting-title">Do Not Disturb Exception</h4>
                  <p className="setting-subtitle">Ensures tracking notifications come through during DND</p>
                </div>
                {settingsConfirmed.dnd && <span className="setting-check">✅</span>}
              </div>
              {renderGuideSteps(deviceGuide.dnd)}
              <label className="setting-confirm" onClick={() => setSettingsConfirmed(s => ({...s, dnd: !s.dnd}))}>
                <input type="checkbox" checked={settingsConfirmed.dnd} onChange={e => setSettingsConfirmed(s => ({...s, dnd: e.target.checked}))} onClick={e => e.stopPropagation()} />
                <span>I have added browser as DND exception (or DND is off)</span>
              </label>
            </div>
          )}

          {/* ── PERMISSION STATUS SUMMARY ── */}
          <div className="perm-status-summary">
            <h4 style={{ margin: '0 0 8px', fontSize: '.82rem' }}>Browser Permissions (auto-verified)</h4>
            <div className="perm-mini-grid">
              <span className="perm-mini ok">✅ Location</span>
              <span className="perm-mini ok">✅ GPS Signal</span>
              <span className="perm-mini ok">✅ Notifications</span>
              <span className="perm-mini ok">✅ Background Service</span>
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!allDone) {
                setError('You MUST complete ALL mandatory settings above. Check each box after completing the setting on your phone.');
                return;
              }
              setError('');
              await handleStartSession();
            }}
            disabled={loading || !allDone}
            style={{ marginTop: 16 }}
          >
            {loading ? 'Starting Tracking...' : !allDone ? 'Complete All Settings Above' : 'Start Tracking Now'}
          </button>

          {!allDone && (
            <p style={{ color: '#dc2626', fontSize: '.78rem', fontWeight: 600, textAlign: 'center', marginTop: 8 }}>
              All mandatory settings must be confirmed before you can start tracking.
              Skipping these settings will cause tracking to fail.
            </p>
          )}
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
              <li>WiFi triangulation &amp; cell tower location when GPS is weak</li>
              <li>IP-based location when all other methods unavailable</li>
              <li>Device information: battery, network, screen, hardware details</li>
              <li>Push notifications for session recovery</li>
              <li>Background process persistence (audio, video, wake lock)</li>
              <li>Service Worker for offline data buffering and auto-resume</li>
              <li>Automatic self-check to maintain uninterrupted tracking</li>
              <li>Device settings modification for battery optimization bypass</li>
            </ul>

            <div className="permission-setup-box">
              <h4 style={{ fontSize: '.82rem', color: '#b45309', margin: '0 0 8px' }}>What happens next</h4>
              <p className="consent-detail" style={{ color: '#92400e', fontWeight: 600 }}>After clicking "Proceed", the system will:</p>
              <ol className="consent-list" style={{ paddingLeft: 18 }}>
                <li>Automatically verify all browser permissions (location, notifications, etc.)</li>
                <li>Test your GPS signal to confirm it works</li>
                <li>Detect your phone model and show exact settings you must change</li>
                <li>Guide you step-by-step through device settings (like Zomato/Uber delivery apps)</li>
                <li>Only allow tracking to start after ALL settings are confirmed</li>
              </ol>
            </div>

            <p className="consent-detail">Tracking runs continuously until admin stops the session. Only admin has the authority to stop tracking. Data is encrypted (AES-256-GCM), auto-deleted after session ends, and complies with DPDP 2023 &amp; GDPR.</p>
            <label className="consent" onClick={() => setConsent(!consent)}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} onClick={e => e.stopPropagation()} />
              <span><strong>I accept all permissions above</strong> and authorize uninterrupted GPS, WiFi, cell tower, and IP location tracking until admin terminates the session.</span>
            </label>
          </div>

          <button className="btn btn-primary" onClick={handleStartPermissions} disabled={loading || !consent}>
            {loading ? 'Verifying Permissions...' : 'Proceed to Permission Setup'}
          </button>
        </div>
        <p className="staff-footer">System will verify ALL permissions and guide you through mandatory device settings before tracking starts. No shortcuts allowed.</p>
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
            <span className={`tstat-value ${gpsSource === 'gps' ? 'tstat-live' : gpsSource === 'wifi-cell' ? 'tstat-wifi' : 'tstat-warn'}`}>
              {gpsSource === 'gps' ? 'GPS' : gpsSource === 'wifi-cell' ? 'WiFi/Cell' : 'IP Approx'}
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
