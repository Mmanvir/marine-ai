import { StatusBadge } from './ui';

export default function AnalysisProgress({ job, error }) {
  if (!job && !error) return null;
  return (
    <div className="card" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{job ? `${job.type} analysis` : 'Analysis'}</div>
        {job && <StatusBadge value={job.status} />}
      </div>
      {job && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress || 0} aria-label="Analysis progress">
            <div className={`h-full transition-all ${job.status === 'failed' ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${job.status === 'succeeded' ? 100 : job.progress || 3}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{job.stage}</p>
          {job.status === 'failed' && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{job.error}</p>}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
