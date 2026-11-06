import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import { errMsg } from '../services/api';
import { Field } from '../components/ui';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      await login(email.trim(), password);
      nav(loc.state?.from || '/app', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-navy-900 to-navy-700 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4" aria-labelledby="login-title" noValidate>
        <div className="flex items-center gap-2 text-brand-600"><Waves aria-hidden="true" /> <span className="font-semibold">MarineTrace AI</span></div>
        <h1 id="login-title" className="text-xl font-semibold">Log in</h1>
        <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
        <p className="text-center text-sm text-muted">New here? <Link className="text-brand-600 underline" to="/register">Create an account</Link></p>
      </form>
    </div>
  );
}
