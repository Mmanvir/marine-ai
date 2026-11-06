import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-muted" role="status" aria-live="polite">
      <Loader2 className="animate-spin" size={18} aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-center">
      <AlertTriangle className="text-red-500" aria-hidden="true" />
      <p className="text-sm">{message || 'Something went wrong.'}</p>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line p-8 text-center">
      <Inbox className="text-muted" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}
