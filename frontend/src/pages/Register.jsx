import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import { errMsg } from '../services/api';
import { Field } from '../components/ui';

export default function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', institution: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  if (user) return <Navigate to="/app" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (f.name.trim().length < 2) return setError('Please enter your name.');
    if (f.password.length < 10 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) return setError('Password must be at least 10 characters and include a letter and a digit.');
    setBusy(true);
    try {
      await register({ name: f.name.trim(), email: f.email.trim(), password: f.password, institution: f.institution.trim() || undefined });
      nav('/app', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-navy-900 to-navy-700 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4" aria-labelledby="reg-title" noValidate>
        <div className="flex items-center gap-2 text-brand-600"><Waves aria-hidden="true" /> <span className="font-semibold">MarineTrace AI</span></div>
        <h1 id="reg-title" className="text-xl font-semibold">Create your account</h1>
        <Field label="Full name" htmlFor="name"><input id="name" className="input" autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Email" htmlFor="email"><input id="email" type="email" className="input" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Institution (optional)" htmlFor="inst"><input id="inst" className="input" value={f.institution} onChange={set('institution')} /></Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters, with a letter and a digit."><input id="password" type="password" className="input" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="text-center text-sm text-muted">Already registered? <Link className="text-brand-600 underline" to="/login">Log in</Link></p>
      </form>
    </div>
  );
}
