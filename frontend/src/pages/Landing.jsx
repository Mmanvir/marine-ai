import { Link } from 'react-router-dom';
import { Activity, BarChart3, Gauge, Map, ScrollText, ShieldCheck, Waves, Wrench } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import { Notice } from '../components/ui';

const FEATURES = [
  { icon: ShieldCheck, title: 'Quality assessment', text: 'Missing values, duplicates, invalid coordinates, irregular sampling, stuck sensors and configurable range rules, each with severity, method and recommended action.' },
  { icon: Activity, title: 'Two anomaly detectors', text: 'Robust MAD and Isolation Forest, compared side by side. A flag means "unusual", never "proven wrong".' },
  { icon: Wrench, title: 'Adaptive recovery (MARE)', text: 'Chooses among linear, time-based, rolling and ML imputation using holdout evidence, and abstains when evidence is thin.' },
  { icon: Gauge, title: 'Honest uncertainty', text: 'Empirical prediction intervals from holdout validation, labelled uncalibrated unless coverage was actually measured.' },
  { icon: BarChart3, title: 'Reproducible benchmarks', text: 'Hidden-value experiments with temporal splits. If MARE does not beat the baselines, the dashboard says so.' },
  { icon: ScrollText, title: 'Full audit trail', text: 'Every flag, reconstruction and manual review is logged. Original observations are never overwritten.' },
  { icon: Map, title: 'Marine map', text: 'Observation coverage, quality-issue markers and reconstructed points on OpenStreetMap, only where valid coordinates exist.' },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-navy-900 px-6 py-4 text-white">
        <div className="flex items-center gap-2 text-lg font-semibold"><Waves className="text-brand-400" aria-hidden="true" /> MarineTrace AI</div>
        <nav className="flex items-center gap-2">
          {user ? <Link className="btn-primary" to="/app">Open dashboard</Link> : (<>
            <Link className="btn-ghost text-white" to="/login">Log in</Link>
            <Link className="btn-primary" to="/register">Create account</Link>
          </>)}
        </nav>
      </header>
      <section className="bg-gradient-to-b from-navy-900 via-navy-800 to-navy-700 px-6 pb-20 pt-16 text-center text-white">
        <p className="text-sm uppercase tracking-widest text-brand-300">Abyssal Labs · capstone research prototype</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Know not just the recovered value, but how far to trust it.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-300">An adaptive, uncertainty-aware system that detects suspicious oceanographic observations, reconstructs missing values only when evidence allows, and keeps an auditable history of every change.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link className="btn-primary px-5 py-3" to={user ? '/app' : '/register'}>{user ? 'Go to dashboard' : 'Get started'}</Link>
          <a className="btn-secondary border-white/30 bg-transparent px-5 py-3 text-white" href="#how">How it works</a>
        </div>
      </section>
      <section id="how" className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-2xl font-semibold">Pipeline</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-4">
          {['Upload CSV & map columns', 'Assess quality & detect anomalies', 'Reconstruct eligible gaps (or abstain)', 'Review, benchmark, export'].map((s, i) => (
            <li key={s} className="card"><div className="text-xs font-semibold text-brand-500">STEP {i + 1}</div><div className="mt-1 text-sm">{s}</div></li>
          ))}
        </ol>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card"><Icon className="text-brand-500" aria-hidden="true" /><h3 className="mt-2 font-medium">{title}</h3><p className="mt-1 text-sm text-muted">{text}</p></div>
          ))}
        </div>
        <div className="mt-10">
          <Notice title="Research prototype">MarineTrace AI is not an operational forecasting service. Demo data is synthetic and always labelled. Methods are not claimed to be novel or patentable; see the Patent Research and Novelty Assessment in the docs.</Notice>
        </div>
      </section>
    </div>
  );
}
