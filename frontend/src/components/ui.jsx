import { FlaskConical, Info } from 'lucide-react';

const TONES = {
  neutral: 'bg-slate-500/15 text-slate-700 dark:text-slate-200 border-slate-500/30',
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-200 border-sky-500/30',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-200 border-red-500/30',
  accent: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 border-cyan-500/30',
};

const STATUS_TONE = {
  queued: 'neutral', running: 'info', succeeded: 'success', failed: 'danger',
  low: 'info', medium: 'warning', high: 'danger',
  reconstructed: 'success', abstained: 'warning', skipped: 'neutral',
  unreviewed: 'neutral', confirmed_error: 'danger', dismissed: 'neutral', accepted: 'success', rejected: 'danger',
  original: 'neutral', flagged: 'warning', manually_reviewed: 'accent',
  mare_better: 'success', mare_not_better: 'warning', tie: 'neutral',
};

/** Always shows text (not colour alone). */
export function StatusBadge({ value, tone, children }) {
  const t = tone || STATUS_TONE[value] || 'neutral';
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[t]}`}>
      {children ?? String(value ?? '—').replace(/_/g, ' ')}
    </span>
  );
}

export function SyntheticBadge({ className = '' }) {
  return (
    <span title="Simulated data - not real ocean measurements" className={`inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-200 ${className}`}>
      <FlaskConical size={12} aria-hidden="true" /> SYNTHETIC
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="card" role="group" aria-label={label}>
      <div className="flex items-center justify-between text-muted">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={18} aria-hidden="true" className={tone === 'danger' ? 'text-red-500' : tone === 'warning' ? 'text-amber-500' : 'text-brand-500'} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }) {
  const cls = { info: 'border-sky-500/40 bg-sky-500/10', warning: 'border-amber-500/40 bg-amber-500/10', danger: 'border-red-500/40 bg-red-500/10' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={`flex gap-3 rounded-lg border p-3 text-sm ${cls}`}>
      <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{title && <div className="font-medium">{title}</div>}<div className="text-muted">{children}</div></div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${value === t.id ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-muted hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
