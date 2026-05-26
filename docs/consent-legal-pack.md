# Consent & Legal Compliance Pack

## Legal Framework Analysis

### India — Digital Personal Data Protection Act, 2023 (DPDP)

**Why this system is compliant:**

1. **Explicit Consent (Section 6)**: The system presents a granular consent screen with separate toggles for each data type (GPS tracking, IP collection, data retention). Consent is not bundled — the patient must actively opt in.

2. **Purpose Limitation (Section 5)**: Data is collected solely for the stated purpose — providing real-time ETA for scheduled healthcare visits. No data is used for profiling, marketing, or any secondary purpose.

3. **Data Minimization**: Only the minimum data needed is collected: staff GPS coordinates during the visit window, patient IP for security verification.

4. **Storage Limitation (Section 8)**: All location data is automatically purged within 24 hours via automated cron jobs. The purge is logged for audit compliance.

5. **Right to Erasure (Section 12)**: Patients can revoke consent at any time via the tracking page. Upon revocation, all location data is immediately and permanently deleted. A purge log entry is created as proof.

6. **Data Fiduciary Obligations (Section 8)**: Varolyn Healthcare acts as the Data Fiduciary. All data is encrypted at rest (AES-256-GCM) and in transit (TLS 1.3).

7. **Consent Manager**: The consent chain uses SHA-256 cryptographic linking, creating an immutable audit trail that proves when consent was given, what was consented to, and from what IP address.

### Why This Is NOT Surveillance

The system is fundamentally different from surveillance because:
- **Both parties consent**: Staff voluntarily share their location as part of their job duties. Patients explicitly consent to receiving location data.
- **Time-limited**: Tracking only occurs during a specific appointment window (typically 1-4 hours).
- **Purpose-specific**: The sole purpose is providing ETA to patients expecting a home visit.
- **Voluntary**: Staff can stop sharing at any time. Patients can revoke consent at any time.
- **Transparent**: Both parties are fully informed about what data is collected and how long it's retained.

### India — Information Technology Act, 2000

- **Section 43A**: Requires reasonable security practices for sensitive personal data. The system uses AES-256-GCM encryption, TLS 1.3, and access controls that exceed the requirements of the IT (Reasonable Security Practices) Rules, 2011.
- **Section 72A**: Prohibits disclosure of information obtained under lawful contract. The system does not share data with any third party. All data remains within Varolyn Healthcare's infrastructure.

### GDPR (EU) Compliance

- **Article 6(1)(a)**: Lawful basis is explicit consent.
- **Article 7**: Consent is freely given, specific, informed, and unambiguous. Withdrawal is as easy as granting.
- **Article 13-14**: Privacy information is provided at the point of consent (legal info section in consent screen).
- **Article 17**: Right to erasure is implemented via the revoke consent endpoint.
- **Article 25**: Privacy by design — data minimization, encryption, automatic purge.
- **Article 30**: Records of processing activities maintained in the audit log.
- **Article 32**: Security measures include encryption, access controls, audit logging.
- **Article 33-34**: Breach notification procedures documented in the operations manual.

## Consent Chain — Technical Implementation

### How It Works

Every consent action creates a new entry in an append-only chain:

```
Entry 0 (genesis):
  prev_hash: "0"
  payload: { consent_type: "gps_tracking", granted: true, ... }
  entry_hash: SHA256("0:" + canonical(payload))

Entry 1:
  prev_hash: entry_0.entry_hash
  payload: { consent_type: "ip_collection", granted: true, ... }
  entry_hash: SHA256(entry_0.entry_hash + ":" + canonical(payload))

Entry 2:
  prev_hash: entry_1.entry_hash
  payload: { consent_type: "data_retention", granted: true, ... }
  entry_hash: SHA256(entry_1.entry_hash + ":" + canonical(payload))
```

### Verification

The chain can be verified at any time via:
```
GET /api/consent/verify/:appointmentId
```

This recomputes every hash from the payload data and confirms the chain has not been tampered with.

### Database Protection

- A PostgreSQL trigger (`prevent_consent_mutation`) blocks any UPDATE or DELETE on the `consent_chain` table.
- The consent chain itself is never deleted, even during right-to-erasure requests — it serves as the proof that consent was given and then revoked.

## Data Purge Strategy

| Trigger | What's Deleted | What's Kept |
|---------|---------------|-------------|
| Auto-purge (hourly cron) | Location history older than 24h | Consent chain, purge log |
| Right to erasure (patient request) | All location data for that appointment | Consent chain (proof), purge log |
| Appointment completion | Nothing immediately | Auto-purge handles cleanup |
| Link expiry | Tracking link deactivated | All data until TTL |

## Recommended Legal Notices

### For Patient Communication (Email/SMS):
> "Your healthcare professional is on their way. Track their live location: [link]. You will be asked for consent before any location data is shown. Data is encrypted and automatically deleted within 24 hours."

### For Staff Employment Agreement:
> "As part of your duties, you may be asked to share your GPS location during active home visit appointments via the Varolyn Staff Tracker. Location sharing is only active during appointment windows and can be stopped at any time. Location data is encrypted, used solely to provide patients with arrival estimates, and automatically deleted within 24 hours."

### Privacy Policy (Website):
A full privacy policy template should be maintained at `/privacy` on the production domain, covering all DPDP/GDPR requirements.

## Compliance Checklist

- [x] Granular, explicit consent with separate toggles
- [x] Consent immutably logged with SHA-256 chain
- [x] Right to erasure API implemented
- [x] Automatic data purge (24h TTL)
- [x] Purge logging for audit
- [x] AES-256-GCM encryption at rest
- [x] TLS 1.3 in transit
- [x] Purpose limitation (ETA only)
- [x] Data minimization (GPS coords + accuracy only)
- [x] Access controls (JWT, role-based)
- [x] Audit logging for all operations
- [x] No third-party data sharing
- [x] Staff can stop tracking at any time
- [x] Patient can revoke consent at any time
