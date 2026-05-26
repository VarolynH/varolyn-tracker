import React, { useState } from 'react';

/**
 * StatusPanel — Bottom sheet overlay showing:
 * - Staff info (name, photo, vehicle)
 * - ETA with countdown
 * - Status badges (en route, arrived, in progress, completed)
 * - Stale indicator (when location data is old)
 * - Revoke consent button
 */
export function StatusPanel({ staffName, staffPhoto, serviceType, status, eta, isStale, lastUpdate, onRevoke }) {
  const [expanded, setExpanded] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);

  const statusConfig = {
    waiting: { label: 'Waiting for staff to start', color: '#6b7280', icon: '⏳' },
    scheduled: { label: 'Appointment scheduled', color: '#6b7280', icon: '📅' },
    staff_en_route: { label: 'On the way', color: '#0066cc', icon: '🚗' },
    en_route: { label: 'On the way', color: '#0066cc', icon: '🚗' },
    arrived: { label: 'Arrived at your location', color: '#059669', icon: '📍' },
    in_progress: { label: 'Service in progress', color: '#7c3aed', icon: '🏥' },
    completed: { label: 'Visit completed', color: '#059669', icon: '✅' },
  };

  const currentStatus = statusConfig[status] || statusConfig.waiting;

  const formatEta = (seconds) => {
    if (!seconds) return null;
    if (seconds < 60) return 'Less than 1 min';
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const formatDistance = (meters) => {
    if (!meters) return null;
    if (meters < 1000) return `${meters}m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const lastUpdateStr = lastUpdate
    ? new Date(lastUpdate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div style={styles.panel}>
      {/* Handle for drag */}
      <div style={styles.handle} onClick={() => setExpanded(!expanded)} />

      {/* Status badge */}
      <div style={{ ...styles.statusBadge, background: currentStatus.color }}>
        <span>{currentStatus.icon}</span>
        <span>{currentStatus.label}</span>
      </div>

      {/* Staff info */}
      <div style={styles.staffRow}>
        <div style={styles.avatar}>
          {staffPhoto ? (
            <img src={staffPhoto} alt="" style={styles.avatarImg} />
          ) : (
            <span style={styles.avatarPlaceholder}>👤</span>
          )}
        </div>
        <div style={styles.staffInfo}>
          <h3 style={styles.staffName}>{staffName || 'Healthcare Professional'}</h3>
          <p style={styles.serviceType}>{serviceType || 'Home Visit'}</p>
        </div>
      </div>

      {/* ETA */}
      {eta && status !== 'completed' && status !== 'arrived' && (
        <div style={styles.etaCard}>
          <div style={styles.etaMain}>
            <span style={styles.etaIcon}>🕐</span>
            <span style={styles.etaTime}>{formatEta(eta.etaSeconds)}</span>
          </div>
          {eta.distanceMeters && (
            <span style={styles.etaDist}>{formatDistance(eta.distanceMeters)} away</span>
          )}
        </div>
      )}

      {/* Stale warning */}
      {isStale && status !== 'completed' && (
        <div style={styles.staleWarning}>
          <span>⚠️</span>
          <span>Location data may be outdated. Staff's screen might be locked.</span>
        </div>
      )}

      {/* Last update */}
      {lastUpdateStr && (
        <p style={styles.lastUpdate}>Last updated: {lastUpdateStr}</p>
      )}

      {/* Expanded section */}
      {expanded && (
        <div style={styles.expandedSection}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Status</span>
            <span style={styles.infoValue}>{currentStatus.label}</span>
          </div>
          {eta && (
            <>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>ETA</span>
                <span style={styles.infoValue}>{formatEta(eta.etaSeconds)}</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Distance</span>
                <span style={styles.infoValue}>{formatDistance(eta.distanceMeters)}</span>
              </div>
            </>
          )}

          {/* Privacy controls */}
          <div style={styles.privacySection}>
            <h4 style={styles.privacyTitle}>Your Privacy</h4>
            <p style={styles.privacyText}>
              Location data is encrypted and automatically deleted within 24 hours.
              You can stop tracking at any time.
            </p>
            {!showRevoke ? (
              <button onClick={() => setShowRevoke(true)} style={styles.revokeBtn}>
                Stop Tracking & Delete My Data
              </button>
            ) : (
              <div style={styles.revokeConfirm}>
                <p style={styles.revokeWarning}>
                  This will immediately stop tracking and permanently delete all location data.
                  This cannot be undone.
                </p>
                <div style={styles.revokeButtons}>
                  <button onClick={onRevoke} style={styles.revokeConfirmBtn}>
                    Yes, Delete Everything
                  </button>
                  <button onClick={() => setShowRevoke(false)} style={styles.revokeCancelBtn}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    background: 'white', borderRadius: '20px 20px 0 0',
    boxShadow: '0 -4px 20px rgba(0,0,0,0.1)', padding: '12px 20px 24px',
    maxHeight: '60vh', overflow: 'auto', zIndex: 1000,
  },
  handle: {
    width: '40px', height: '4px', background: '#ddd', borderRadius: '2px',
    margin: '0 auto 12px', cursor: 'pointer',
  },
  statusBadge: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '6px 12px', borderRadius: '20px', color: 'white',
    fontSize: '13px', fontWeight: '600', marginBottom: '12px',
  },
  staffRow: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' },
  avatar: { width: '48px', height: '48px', borderRadius: '50%', background: '#e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  avatarPlaceholder: { fontSize: '24px' },
  staffInfo: { flex: 1 },
  staffName: { fontSize: '16px', fontWeight: '600', margin: 0, color: '#111' },
  serviceType: { fontSize: '13px', color: '#6b7280', margin: '2px 0 0' },
  etaCard: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', background: '#f0f9ff', borderRadius: '10px',
    border: '1px solid #bfdbfe', marginBottom: '8px',
  },
  etaMain: { display: 'flex', alignItems: 'center', gap: '8px' },
  etaIcon: { fontSize: '18px' },
  etaTime: { fontSize: '20px', fontWeight: '700', color: '#0066cc' },
  etaDist: { fontSize: '13px', color: '#6b7280' },
  staleWarning: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '8px 12px', background: '#fef3c7', borderRadius: '8px',
    fontSize: '12px', color: '#92400e', marginBottom: '8px',
  },
  lastUpdate: { fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' },
  expandedSection: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' },
  infoRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0' },
  infoLabel: { fontSize: '13px', color: '#6b7280' },
  infoValue: { fontSize: '13px', fontWeight: '600', color: '#111' },
  privacySection: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' },
  privacyTitle: { fontSize: '14px', color: '#111', margin: '0 0 8px' },
  privacyText: { fontSize: '12px', color: '#6b7280', lineHeight: 1.5, marginBottom: '12px' },
  revokeBtn: {
    width: '100%', padding: '10px', background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: '8px', color: '#dc2626', fontSize: '13px', cursor: 'pointer', fontWeight: '500',
  },
  revokeConfirm: { padding: '12px', background: '#fef2f2', borderRadius: '8px' },
  revokeWarning: { fontSize: '12px', color: '#991b1b', lineHeight: 1.5, marginBottom: '12px' },
  revokeButtons: { display: 'flex', gap: '8px' },
  revokeConfirmBtn: {
    flex: 1, padding: '10px', background: '#dc2626', color: 'white',
    border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: '600',
  },
  revokeCancelBtn: {
    flex: 1, padding: '10px', background: '#e5e7eb', color: '#374151',
    border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
  },
};
