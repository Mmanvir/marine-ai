import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * columns: [{ key, label, render?(row), className? }]
 * pagination: { page, limit, total, onPage(n) }
 */
export default function DataTable({ columns, rows, caption, empty = 'No rows to show.', pagination, onRowClick, rowKey }) {
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="min-w-full divide-y divide-line">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-brand-500/5">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className="th">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr><td className="td text-center text-muted" colSpan={columns.length}>{empty}</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={rowKey ? rowKey(r) : r._id || r.id || i}
                className={onRowClick ? 'cursor-pointer hover:bg-brand-500/5' : ''}
                onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} className={`td ${c.className || ''}`}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && pagination.total > pagination.limit && (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted">Page {pagination.page} of {pages} · {pagination.total.toLocaleString()} rows</span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={pagination.page <= 1} onClick={() => pagination.onPage(pagination.page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
            <button className="btn-secondary" disabled={pagination.page >= pages} onClick={() => pagination.onPage(pagination.page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
          </div>
        </nav>
      )}
    </div>
  );
}
