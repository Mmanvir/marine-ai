import { ResponsiveContainer } from 'recharts';
import { EmptyState } from './States';

/** Card with a title and a fixed-height responsive chart area. Shows an empty state when `empty`. */
export default function ChartCard({ title, subtitle, empty, emptyText = 'Run an analysis to populate this chart.', height = 260, actions, children, badge }) {
  return (
    <section className="card" aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">{title} {badge}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {empty ? <EmptyState title="No data yet">{emptyText}</EmptyState> : (
        <div style={{ width: '100%', height }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
      )}
    </section>
  );
}
