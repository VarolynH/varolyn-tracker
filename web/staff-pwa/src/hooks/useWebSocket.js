import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useWebSocket — Resilient WebSocket connection with:
 * - Auto-reconnect with exponential backoff
 * - Message queuing while disconnected
 * - Connection state tracking
 * - Heartbeat/ping support
 */
export function useWebSocket({ url, token, enabled = false, onMessage }) {
  const [status, setStatus] = useState('disconnected'); // disconnected | connecting | connected | error
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const messageQueueRef = useRef([]);
  const heartbeatRef = useRef(null);

  const MAX_RECONNECT_DELAY = 30000;
  const HEARTBEAT_INTERVAL = 25000;

  const connect = useCallback(() => {
    if (!url || !enabled) return;

    setStatus('connecting');

    const wsUrl = `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected');
      setStatus('connected');
      reconnectAttemptRef.current = 0;

      // Flush queued messages
      while (messageQueueRef.current.length > 0) {
        const msg = messageQueueRef.current.shift();
        ws.send(JSON.stringify(msg));
      }

      // Start heartbeat
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onclose = (event) => {
      console.log(`[WS] Closed: code=${event.code} reason=${event.reason}`);
      setStatus('disconnected');
      clearInterval(heartbeatRef.current);

      // Don't reconnect if intentionally closed (1000) or completed
      if (event.code === 1000 || !enabled) return;

      // Exponential backoff reconnect
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttemptRef.current),
        MAX_RECONNECT_DELAY
      );
      reconnectAttemptRef.current++;
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      setStatus('error');
    };

    wsRef.current = ws;
  }, [url, token, enabled, onMessage]);

  // ── Send message (queues if disconnected) ──────────────
  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      // Queue for when connection resumes
      messageQueueRef.current.push(data);
      // Cap queue size
      if (messageQueueRef.current.length > 200) {
        messageQueueRef.current = messageQueueRef.current.slice(-100);
      }
    }
  }, []);

  // ── Close connection ───────────────────────────────────
  const close = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    clearInterval(heartbeatRef.current);
    if (wsRef.current) {
      wsRef.current.close(1000, 'User stopped tracking');
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  // ── Effect: connect/disconnect based on enabled ────────
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      close();
    }
    return () => close();
  }, [enabled, connect, close]);

  // ── Reconnect when page regains visibility ─────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && enabled && status !== 'connected') {
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Also listen for resume-tracking events from SW
    const handleResume = () => {
      if (enabled && status !== 'connected') {
        connect();
      }
    };
    window.addEventListener('resume-tracking', handleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resume-tracking', handleResume);
    };
  }, [enabled, status, connect]);

  return { status, send, close };
}
