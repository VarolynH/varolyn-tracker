import React from 'react';
import { Routes, Route } from 'react-router-dom';
import StaffPage from './pages/StaffPage';
import TrackPage from './pages/TrackPage';
import DashboardPage from './pages/DashboardPage';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#ef4444' }}>Something went wrong</h2>
          <p style={{ color: '#64748b', margin: '12px 0' }}>{this.state.error?.message || 'Unknown error'}</p>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            style={{ padding: '10px 24px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '1rem' }}
          >
            Clear Cache &amp; Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<StaffPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/track/:token" element={<TrackPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
