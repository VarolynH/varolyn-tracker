import React, { useState, useEffect, useCallback } from 'react';

const API = '';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('admin_token'));
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [staff, setStaff] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  const login = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm),
    });
    const data = await res.json();
    if (res.ok && data.user?.role === 'admin') {
      localStorage.setItem('admin_token', data.token);
      setToken(data.token);
    } else { setError(data.error || 'Admin access required'); }
  };

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API}/api/admin/stats`, { headers });
    if (res.ok) setStats(await res.json());
  }, [token]);

  const fetchStaff = useCallback(async () => {
    const res = await fetch(`${API}/api/admin/staff`, { headers });
    if (res.ok) { const d = await res.json(); setStaff(d.staff || []); }
  }, [token]);

  const fetchPatients = useCallback(async () => {
    const res = await fetch(`${API}/api/admin/patients?limit=50`, { headers });
    if (res.ok) { const d = await res.json(); setPatients(d.patients || []); }
  }, [token]);

  const fetchAppointments = useCallback(async () => {
    const res = await fetch(`${API}/api/appointments?limit=50`, { headers });
    if (res.ok) { const d = await res.json(); setAppointments(d.appointments || []); }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchStats();
    if (page === 'staff') fetchStaff();
    if (page === 'patients') fetchPatients();
    if (page === 'appointments') fetchAppointments();
  }, [token, page, fetchStats, fetchStaff, fetchPatients, fetchAppointments]);

  if (!token) {
    return (
      <div style={s.center}>
        <div style={s.loginCard}>
          <h1 style={s.logo}>Varolyn Admin</h1>
          <form onSubmit={login} style={s.form}>
            <input placeholder="Email" type="email" required value={loginForm.email}
              onChange={e => setLoginForm({...loginForm, email: e.target.value})} style={s.input} />
            <input placeholder="Password" type="password" required value={loginForm.password}
              onChange={e => setLoginForm({...loginForm, password: e.target.value})} style={s.input} />
            <button type="submit" style={s.btn}>Sign In</button>
            {error && <p style={{color:'red',fontSize:'13px'}}>{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={s.layout}>
      {/* Sidebar */}
      <nav style={s.sidebar}>
        <h2 style={s.sideTitle}>Varolyn</h2>
        {['dashboard','appointments','staff','patients','audit'].map(p => (
          <button key={p} onClick={() => setPage(p)}
            style={{...s.navBtn, background: page===p ? '#e0e7ff' : 'transparent'}}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        <button onClick={() => { localStorage.removeItem('admin_token'); setToken(null); }} style={s.navBtn}>
          Logout
        </button>
      </nav>

      {/* Main content */}
      <main style={s.main}>
        {page === 'dashboard' && stats && (
          <div>
            <h1 style={s.pageTitle}>Dashboard</h1>
            <div style={s.grid}>
              <StatCard label="Active Tracking" value={stats.activeTrackingSessions} color="#0066cc" />
              <StatCard label="Available Staff" value={stats.availableStaff} color="#059669" />
              <StatCard label="Total Patients" value={stats.totalPatients} color="#7c3aed" />
              <StatCard label="Completed" value={stats.appointmentsByStatus?.completed || 0} color="#f59e0b" />
            </div>
            <h3 style={{margin:'24px 0 12px'}}>Appointments by Status</h3>
            <div style={s.statusGrid}>
              {Object.entries(stats.appointmentsByStatus || {}).map(([k,v]) => (
                <div key={k} style={s.statusItem}>
                  <span style={s.statusLabel}>{k}</span>
                  <span style={s.statusVal}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {page === 'staff' && (
          <div>
            <h1 style={s.pageTitle}>Staff Members</h1>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Name</th><th style={s.th}>Email</th>
                <th style={s.th}>Specialization</th><th style={s.th}>Vehicle</th><th style={s.th}>Available</th>
              </tr></thead>
              <tbody>
                {staff.map(st => (
                  <tr key={st.staff_id}>
                    <td style={s.td}>{st.full_name}</td><td style={s.td}>{st.email}</td>
                    <td style={s.td}>{st.specialization || '—'}</td>
                    <td style={s.td}>{st.vehicle_type}</td>
                    <td style={s.td}>{st.is_available ? '✅' : '❌'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {page === 'patients' && (
          <div>
            <h1 style={s.pageTitle}>Patients</h1>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Name</th><th style={s.th}>Phone</th><th style={s.th}>Email</th><th style={s.th}>Address</th>
              </tr></thead>
              <tbody>
                {patients.map(p => (
                  <tr key={p.id}>
                    <td style={s.td}>{p.full_name}</td><td style={s.td}>{p.phone||'—'}</td>
                    <td style={s.td}>{p.email||'—'}</td><td style={s.td}>{p.address_line||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {page === 'appointments' && (
          <div>
            <h1 style={s.pageTitle}>Appointments</h1>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Patient</th><th style={s.th}>Staff</th><th style={s.th}>Service</th>
                <th style={s.th}>Scheduled</th><th style={s.th}>Status</th><th style={s.th}>Tracking</th>
              </tr></thead>
              <tbody>
                {appointments.map(a => (
                  <tr key={a.id}>
                    <td style={s.td}>{a.patient_name}</td><td style={s.td}>{a.staff_name}</td>
                    <td style={s.td}>{a.service_type}</td>
                    <td style={s.td}>{new Date(a.scheduled_at).toLocaleString('en-IN')}</td>
                    <td style={s.td}><span style={{...s.badge, background: a.status==='completed'?'#dcfce7':'#dbeafe'}}>{a.status}</span></td>
                    <td style={s.td}>{a.consent_given ? '🟢' : '⚪'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{...s.statCard, borderTop: `4px solid ${color}`}}>
      <p style={s.statValue}>{value}</p>
      <p style={s.statLabel}>{label}</p>
    </div>
  );
}

const s = {
  center: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh' },
  loginCard: { background:'white', padding:'40px', borderRadius:'12px', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', width:'360px' },
  logo: { textAlign:'center', color:'#0066cc', marginBottom:'24px' },
  form: { display:'flex', flexDirection:'column', gap:'12px' },
  input: { padding:'12px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px' },
  btn: { padding:'12px', background:'#0066cc', color:'white', border:'none', borderRadius:'8px', fontWeight:'600', cursor:'pointer' },
  layout: { display:'flex', minHeight:'100vh' },
  sidebar: { width:'220px', background:'white', borderRight:'1px solid #e5e7eb', padding:'20px', display:'flex', flexDirection:'column', gap:'4px' },
  sideTitle: { fontSize:'18px', color:'#0066cc', marginBottom:'20px' },
  navBtn: { display:'block', width:'100%', textAlign:'left', padding:'10px 12px', border:'none', borderRadius:'8px', fontSize:'14px', cursor:'pointer', color:'#374151' },
  main: { flex:1, padding:'32px' },
  pageTitle: { fontSize:'24px', fontWeight:'700', marginBottom:'24px', color:'#111' },
  grid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:'16px' },
  statCard: { background:'white', padding:'20px', borderRadius:'10px', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' },
  statValue: { fontSize:'28px', fontWeight:'700', color:'#111', margin:0 },
  statLabel: { fontSize:'13px', color:'#6b7280', margin:'4px 0 0' },
  statusGrid: { display:'flex', flexWrap:'wrap', gap:'8px' },
  statusItem: { padding:'8px 12px', background:'white', borderRadius:'8px', border:'1px solid #e5e7eb' },
  statusLabel: { fontSize:'12px', color:'#6b7280', marginRight:'8px' },
  statusVal: { fontSize:'14px', fontWeight:'600' },
  table: { width:'100%', borderCollapse:'collapse', background:'white', borderRadius:'8px', overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' },
  th: { textAlign:'left', padding:'12px 16px', background:'#f9fafb', fontSize:'12px', color:'#6b7280', fontWeight:'600', borderBottom:'1px solid #e5e7eb' },
  td: { padding:'12px 16px', fontSize:'13px', borderBottom:'1px solid #f3f4f6', color:'#374151' },
  badge: { padding:'3px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:'600' },
};
