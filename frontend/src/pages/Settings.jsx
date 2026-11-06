import { useState } from 'react';
import { api, errMsg } from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { useAsync } from '../hooks/useAsync';
import { Field, Notice, PageHeader, StatusBadge } from '../components/ui';

function Msg({ m }) {
  return m ? <span role={m.ok ? 'status' : 'alert'} className={`text-sm ${m.ok ? 'text-emerald-600' : 'text-red-600'}`}>{m.text}</span> : null;
}

export default function Settings() {
  const { user, setUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const p = user.preferences || {};
  const [profile, setProfile] = useState({ name: user.name, institution: user.institution || '' });
  const [prefs, setPrefs] = useState({ method: p.method ?? 'mare', maxGap: p.maxGap ?? 24, minObsFraction: p.minObsFraction ?? 0.5, alpha: p.alpha ?? 0.1, outlierZ: p.outlierZ ?? 3.5, contamination: p.contamination ?? 0.02 });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [m1, setM1] = useState(null), [m2, setM2] = useState(null), [m3, setM3] = useState(null);
  const health = useAsync(async () => {
    const [b, ml] = await Promise.allSettled([api.get('/health'), api.get('/health/ml')]);
    return { backend: b.status === 'fulfilled' ? b.value.data : null, ml: ml.status === 'fulfilled' ? ml.value.data : null };
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault(); setM1(null);
    try { const { data } = await api.put('/auth/me', profile); setUser(data.user); setM1({ ok: true, text: 'Profile saved.' }); } catch (er) { setM1({ ok: false, text: errMsg(er) }); }
  };
  const savePrefs = async (e) => {
    e.preventDefault(); setM2(null);
    const body = { method: prefs.method, maxGap: Number(prefs.maxGap), minObsFraction: Number(prefs.minObsFraction), alpha: Number(prefs.alpha), outlierZ: Number(prefs.outlierZ), contamination: Number(prefs.contamination) };
    try { const { data } = await api.put('/auth/me', { preferences: body }); setUser(data.user); setM2({ ok: true, text: 'Defaults saved. They apply to new analyses.' }); } catch (er) { setM2({ ok: false, text: errMsg(er) }); }
  };
  const changePw = async (e) => {
    e.preventDefault(); setM3(null);
    try { await api.put('/auth/password', pw); setPw({ currentPassword: '', newPassword: '' }); setM3({ ok: true, text: 'Password changed.' }); } catch (er) { setM3({ ok: false, text: errMsg(er) }); }
  };
  const num = (k) => (e) => setPrefs((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, analysis defaults, appearance and service status." />
      <div className="grid gap-4 lg:grid-cols-2">
        <form className="card space-y-3" onSubmit={saveProfile} aria-label="Profile">
          <h2 className="text-sm font-semibold">Profile <StatusBadge tone="accent">{user.role}</StatusBadge></h2>
          <Field label="Email" htmlFor="pe"><input id="pe" className="input" value={user.email} disabled /></Field>
          <Field label="Name" htmlFor="pn"><input id="pn" className="input" value={profile.name} onChange={(e) => setProfile((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Institution" htmlFor="pi"><input id="pi" className="input" value={profile.institution} onChange={(e) => setProfile((s) => ({ ...s, institution: e.target.value }))} /></Field>
          <div className="flex items-center gap-3"><button className="btn-primary">Save profile</button><Msg m={m1} /></div>
        </form>

        <form className="card space-y-3" onSubmit={savePrefs} aria-label="Analysis defaults">
          <h2 className="text-sm font-semibold">Analysis defaults</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Recovery method" htmlFor="dm"><select id="dm" className="input" value={prefs.method} onChange={num('method')}>{['mare', 'linear', 'time', 'rolling', 'iterative'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Max gap (samples)" htmlFor="dg"><input id="dg" type="number" min="1" max="500" className="input" value={prefs.maxGap} onChange={num('maxGap')} /></Field>
            <Field label="Min observed fraction" htmlFor="do"><input id="do" type="number" step="0.05" min="0" max="1" className="input" value={prefs.minObsFraction} onChange={num('minObsFraction')} /></Field>
            <Field label="Interval α" htmlFor="da" hint="0.1 = 90% nominal"><input id="da" type="number" step="0.01" min="0.01" max="0.5" className="input" value={prefs.alpha} onChange={num('alpha')} /></Field>
            <Field label="Outlier z (MAD)" htmlFor="dz"><input id="dz" type="number" step="0.1" min="1" max="20" className="input" value={prefs.outlierZ} onChange={num('outlierZ')} /></Field>
            <Field label="IF contamination" htmlFor="dc"><input id="dc" type="number" step="0.005" min="0.001" max="0.2" className="input" value={prefs.contamination} onChange={num('contamination')} /></Field>
          </div>
          <div className="flex items-center gap-3"><button className="btn-primary">Save defaults</button><Msg m={m2} /></div>
        </form>

        <form className="card space-y-3" onSubmit={changePw} aria-label="Change password">
          <h2 className="text-sm font-semibold">Change password</h2>
          <Field label="Current password" htmlFor="cp"><input id="cp" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw((s) => ({ ...s, currentPassword: e.target.value }))} /></Field>
          <Field label="New password" htmlFor="np" hint="At least 10 characters with a letter and a digit"><input id="np" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw((s) => ({ ...s, newPassword: e.target.value }))} /></Field>
          <div className="flex items-center gap-3"><button className="btn-primary">Change password</button><Msg m={m3} /></div>
        </form>

        <section className="card space-y-3" aria-label="Appearance and status">
          <h2 className="text-sm font-semibold">Appearance</h2>
          <div className="flex gap-2" role="radiogroup" aria-label="Theme">
            {['light', 'dark'].map((t) => <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'btn-primary' : 'btn-secondary'} onClick={() => setTheme(t)}>{t === 'light' ? 'Light' : 'Dark'}</button>)}
          </div>
          <h2 className="pt-2 text-sm font-semibold">Service status</h2>
          {health.loading ? <p className="text-sm text-muted">Checking…</p> : (
            <ul className="text-sm"><li>API: <StatusBadge tone={health.data?.backend ? 'success' : 'danger'}>{health.data?.backend ? `up (db ${health.data.backend.db})` : 'unreachable'}</StatusBadge></li>
              <li className="mt-1">ML service: <StatusBadge tone={health.data?.ml ? 'success' : 'danger'}>{health.data?.ml ? `up (${health.data.ml.ml.algorithm_version})` : 'unreachable'}</StatusBadge></li></ul>)}
          <Notice>Research prototype. Not an operational forecasting service.</Notice>
        </section>
      </div>
    </>
  );
}
