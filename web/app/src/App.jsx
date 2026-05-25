import React from 'react';
import { Routes, Route } from 'react-router-dom';
import StaffPage from './pages/StaffPage';
import TrackPage from './pages/TrackPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StaffPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/track/:token" element={<TrackPage />} />
    </Routes>
  );
}
