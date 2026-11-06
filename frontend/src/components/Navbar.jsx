import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { StatusBadge } from './ui';

export default function Navbar({ onMenu }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-card px-4">
      <button className="btn-ghost lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
      <div className="hidden text-sm text-muted lg:block">Uncertainty-aware marine data recovery</div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="btn-ghost text-left" onClick={() => nav('/app/settings')} aria-label="Open profile settings">
          <span className="hidden text-sm sm:block">{user?.name}</span>
          {user?.role === 'admin' && <StatusBadge tone="accent">admin</StatusBadge>}
        </button>
        <button className="btn-secondary" onClick={async () => { await logout(); nav('/login'); }}><LogOut size={16} aria-hidden="true" /> <span className="hidden sm:inline">Log out</span></button>
      </div>
    </header>
  );
}
