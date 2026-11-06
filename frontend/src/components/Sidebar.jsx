import { NavLink } from 'react-router-dom';
import { Activity, BarChart3, Database, FileClock, FlaskConical, Gauge, History, LayoutDashboard, Map, ScrollText, Settings, ShieldCheck, Upload, Waves, Wrench, X } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/datasets', label: 'Datasets', icon: Database },
  { to: '/app/upload', label: 'Upload', icon: Upload },
  { to: '/app/quality', label: 'Data quality', icon: ShieldCheck },
  { to: '/app/anomalies', label: 'Anomaly explorer', icon: Activity },
  { to: '/app/recovery', label: 'Recovery', icon: Wrench },
  { to: '/app/uncertainty', label: 'Uncertainty', icon: Gauge },
  { to: '/app/map', label: 'Marine map', icon: Map },
  { to: '/app/benchmarks', label: 'Benchmarking', icon: BarChart3 },
  { to: '/app/jobs', label: 'Job history', icon: History },
  { to: '/app/audit', label: 'Audit trail', icon: ScrollText },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const items = user?.role === 'admin' ? [...NAV, { to: '/app/admin', label: 'Administration', icon: FileClock }] : NAV;
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-navy-900 text-slate-200 transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Main navigation">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold text-white"><Waves className="text-brand-400" aria-hidden="true" /> MarineTrace AI</div>
          <button className="lg:hidden" onClick={onClose} aria-label="Close menu"><X size={20} /></button>
        </div>
        <nav className="space-y-1 px-3 pb-4">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={onClose}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-500/20 text-brand-300' : 'hover:bg-white/5'}`}>
              <Icon size={18} aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-white/10 p-4 text-xs text-slate-400">
          <div className="flex items-center gap-1"><FlaskConical size={14} aria-hidden="true" /> Research prototype</div>
          <div>Abyssal Labs</div>
        </div>
      </aside>
    </>
  );
}
