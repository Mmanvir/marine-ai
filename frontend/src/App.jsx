import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/AuthContext';
import { Loading } from './components/States';
import AppLayout from './layouts/AppLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import DatasetLibrary from './pages/DatasetLibrary';
import DatasetDetail from './pages/DatasetDetail';
import UploadDataset from './pages/UploadDataset';
import QualityReport from './pages/QualityReport';
import AnomalyExplorer from './pages/AnomalyExplorer';
import RecoveryAnalysis from './pages/RecoveryAnalysis';
import UncertaintyViz from './pages/UncertaintyViz';
import MarineMap from './pages/MarineMap';
import Benchmarking from './pages/Benchmarking';
import JobHistory from './pages/JobHistory';
import AuditTrail from './pages/AuditTrail';
import Settings from './pages/Settings';
import AdminDashboard from './pages/AdminDashboard';

export function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="datasets" element={<DatasetLibrary />} />
        <Route path="datasets/:id" element={<DatasetDetail />} />
        <Route path="upload" element={<UploadDataset />} />
        <Route path="quality" element={<QualityReport />} />
        <Route path="anomalies" element={<AnomalyExplorer />} />
        <Route path="recovery" element={<RecoveryAnalysis />} />
        <Route path="uncertainty" element={<UncertaintyViz />} />
        <Route path="map" element={<MarineMap />} />
        <Route path="benchmarks" element={<Benchmarking />} />
        <Route path="jobs" element={<JobHistory />} />
        <Route path="audit" element={<AuditTrail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
