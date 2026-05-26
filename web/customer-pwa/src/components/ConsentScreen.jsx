import React, { useState } from 'react';

/**
 * Granular consent screen — GDPR/DPDP 2023 compliant.
 * Separate toggles for each data type. GPS is mandatory to proceed.
 * Full transparency about what data is collected and how long it's retained.
 */
export function ConsentScreen({ linkData, onConsent }) {
  const [consents, setConsents] = useState({
    gps_tracking: true,      // Required
    ip_collection: true,     // Optional
    data_retention: true,    // Optional (24h default)
  });
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = () => {
    if (!consents.gps_tracking) {
      alert('GPS tracking consent is required to view the live location of your healthcare professional.');
      return;
    }
    onConsent(consents);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>V</div>
          <h1 style={styles.title}>Varolyn Healthcare</h1>
          <p style={styles.subtitle}>Live Visit Tracking</p>
        </div>

        {/* Visit info */}
        <div style={styles.infoBox}>
          <p style={styles.infoText}>
            <strong>{linkData.staffName}</strong> ({linkData.staffSpecialization || 'Healthcare Professional'})
            is on their way for your <strong>{linkData.serviceType}</strong> visit.
          </p>
          <p style={styles.infoSmall}>
            Scheduled: {new Date(linkData.scheduledAt).toLocaleString('en-IN')}
          </p>
        </div>

        {/* Consent explanation */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Your Consent is Required</h2>
          <p style={styles.sectionText}>
            To show you the live location of your healthcare professional, we need your
            explicit permission to process certain data. You can revoke consent at any time.
          </p>
        </div>

        {/* Consent toggles */}
        <div style={styles.toggleList}>
          {/* GPS Tracking — Required */}
          <div style={styles.toggleItem}>
            <div style={styles.toggleInfo}>
              <span style={styles.toggleLabel}>📍 Staff GPS Location</span>
              <span style={styles.required}>Required</span>
            </div>
            <p style={styles.toggleDesc}>
              View real-time GPS location of your healthcare professional during their journey to you.
            </p>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={consents.gps_tracking}
                onChange={() => {}} // Cannot uncheck required
                disabled
              />
              <span style={styles.slider} />
            </label>
          </div>

          {/* IP Collection — Optional */}
          <div style={styles.toggleItem}>
            <div style={styles.toggleInfo}>
              <span style={styles.toggleLabel}>🌐 Your IP Address</span>
              <span style={styles.optional}>Optional</span>
            </div>
            <p style={styles.toggleDesc}>
              Collected for security verification and fraud prevention. Not shared with third parties.
            </p>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={consents.ip_collection}
                onChange={(e) => setConsents({ ...consents, ip_collection: e.target.checked })}
              />
              <span style={{ ...styles.slider, background: consents.ip_collection ? '#0066cc' : '#ccc' }} />
            </label>
          </div>

          {/* Data Retention — Optional */}
          <div style={styles.toggleItem}>
            <div style={styles.toggleInfo}>
              <span style={styles.toggleLabel}>🕐 24-Hour Data Retention</span>
              <span style={styles.optional}>Optional</span>
            </div>
            <p style={styles.toggleDesc}>
              Location data is automatically deleted after 24 hours. If you decline,
              data is deleted immediately after the visit ends.
            </p>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={consents.data_retention}
                onChange={(e) => setConsents({ ...consents, data_retention: e.target.checked })}
              />
              <span style={{ ...styles.slider, background: consents.data_retention ? '#0066cc' : '#ccc' }} />
            </label>
          </div>
        </div>

        {/* Legal info */}
        <div style={styles.legalBox}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={styles.legalToggle}
          >
            {expanded ? '▼' : '▶'} Legal Information & Your Rights
          </button>
          {expanded && (
            <div style={styles.legalContent}>
              <p><strong>Data Controller:</strong> Varolyn Healthcare Pvt. Ltd.</p>
              <p><strong>Purpose:</strong> Providing real-time ETA for scheduled healthcare visits.</p>
              <p><strong>Legal Basis:</strong> Explicit consent (GDPR Art. 6(1)(a), DPDP 2023 Sec. 6).</p>
              <p><strong>Data Retention:</strong> Maximum 24 hours after visit completion.</p>
              <p><strong>Your Rights:</strong></p>
              <ul style={{ paddingLeft: '20px', marginTop: '4px' }}>
                <li>Right to withdraw consent at any time (revoke button on tracking page)</li>
                <li>Right to erasure — all location data deleted immediately on revocation</li>
                <li>Right to access — request your data at privacy@varolynhealthcare.com</li>
                <li>Right to complain to the Data Protection Board of India</li>
              </ul>
              <p style={{ marginTop: '8px' }}>
                <strong>Security:</strong> All data encrypted in transit (TLS 1.3) and at rest (AES-256-GCM).
                Consent records stored immutably (SHA-256 chain) for audit compliance.
              </p>
            </div>
          )}
        </div>

        {/* Consent button */}
        <button onClick={handleSubmit} style={styles.consentBtn}>
          I Consent — Show Live Location
        </button>

        <p style={styles.footer}>
          By clicking above, you explicitly consent to the data processing described.
          You can revoke consent at any time from the tracking page.
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh', background: 'linear-gradient(135deg, #0066cc 0%, #004499 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  },
  card: {
    background: 'white', borderRadius: '20px', padding: '32px 24px',
    maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  header: { textAlign: 'center', marginBottom: '24px' },
  logo: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '48px', height: '48px', background: '#0066cc', color: 'white',
    borderRadius: '12px', fontSize: '24px', fontWeight: '700', marginBottom: '12px',
  },
  title: { fontSize: '20px', color: '#111', margin: '0' },
  subtitle: { fontSize: '14px', color: '#666', margin: '4px 0 0' },
  infoBox: {
    background: '#f0f9ff', borderRadius: '12px', padding: '16px', marginBottom: '20px',
    border: '1px solid #bfdbfe',
  },
  infoText: { fontSize: '14px', color: '#1e40af', lineHeight: 1.5, margin: 0 },
  infoSmall: { fontSize: '12px', color: '#6b7280', marginTop: '8px' },
  section: { marginBottom: '16px' },
  sectionTitle: { fontSize: '16px', color: '#111', margin: '0 0 8px' },
  sectionText: { fontSize: '13px', color: '#4b5563', lineHeight: 1.5, margin: 0 },
  toggleList: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' },
  toggleItem: {
    padding: '12px', background: '#f9fafb', borderRadius: '10px', border: '1px solid #e5e7eb',
  },
  toggleInfo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  toggleLabel: { fontSize: '14px', fontWeight: '600', color: '#111' },
  required: { fontSize: '11px', color: '#dc2626', fontWeight: '600', background: '#fef2f2', padding: '2px 6px', borderRadius: '4px' },
  optional: { fontSize: '11px', color: '#059669', fontWeight: '600', background: '#ecfdf5', padding: '2px 6px', borderRadius: '4px' },
  toggleDesc: { fontSize: '12px', color: '#6b7280', lineHeight: 1.4, margin: '4px 0 8px' },
  toggle: { display: 'block' },
  slider: { display: 'block', width: '40px', height: '22px', borderRadius: '11px', background: '#0066cc', cursor: 'pointer' },
  legalBox: { marginBottom: '20px' },
  legalToggle: {
    background: 'none', border: 'none', color: '#4b5563', fontSize: '13px',
    cursor: 'pointer', padding: '8px 0', fontWeight: '500',
  },
  legalContent: { fontSize: '12px', color: '#6b7280', lineHeight: 1.6, padding: '12px', background: '#f9fafb', borderRadius: '8px', marginTop: '8px' },
  consentBtn: {
    width: '100%', padding: '16px', background: '#0066cc', color: 'white',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '700',
    cursor: 'pointer', marginBottom: '12px',
  },
  footer: { fontSize: '11px', color: '#9ca3af', textAlign: 'center', lineHeight: 1.4 },
};
