import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, FlaskConical, Trash2, Upload } from 'lucide-react';
import { api, downloadFile, errMsg } from '../services/api';
import { useDatasets } from '../components/Pickers';
import DataTable from '../components/DataTable';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Notice, PageHeader, StatusBadge, SyntheticBadge } from '../components/ui';
import { fmtBytes, fmtDate, fmtNum } from '../utils/format';

export default function DatasetLibrary() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useDatasets();
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const remove = async (d) => {
    if (!window.confirm(`Delete "${d.name}" and all of its analyses? This cannot be undone. The audit log is kept.`)) return;
    try { await api.delete(`/datasets/${d._id}`); setMsg({ ok: true, text: `Deleted "${d.name}".` }); reload(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };
  const demo = async () => {
    setBusy(true);
    try { const r = await api.post('/datasets/demo'); nav(`/app/datasets/${r.data.dataset._id}`); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const rows = data.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Dataset library" subtitle="Uploaded files are stored unchanged. Processed results are saved as separate versions."
        actions={<><button className="btn-secondary" onClick={demo} disabled={busy}><FlaskConical size={16} /> Load synthetic demo</button><Link className="btn-primary" to="/app/upload"><Upload size={16} /> Upload CSV</Link></>} />
      {msg && <div className="mb-3"><Notice tone={msg.ok ? 'info' : 'danger'}>{msg.text}</Notice></div>}
      {data.length === 0 ? (
        <EmptyState title="No datasets yet" action={<Link className="btn-primary" to="/app/upload">Upload your first CSV</Link>}>Or load the synthetic demo dataset to explore the platform.</EmptyState>
      ) : (
        <>
          <div className="mb-3 max-w-sm"><label className="label" htmlFor="q">Search</label><input id="q" className="input" placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <DataTable caption="Datasets" rows={rows} empty="No dataset matches your search." onRowClick={(d) => nav(`/app/datasets/${d._id}`)}
            columns={[
              { key: 'name', label: 'Name', render: (d) => <span className="flex flex-wrap items-center gap-2 font-medium">{d.name}{d.isSynthetic && <SyntheticBadge />}</span> },
              { key: 'rows', label: 'Rows', render: (d) => fmtNum(d.rowCount, 0) },
              { key: 'cols', label: 'Columns', render: (d) => `${d.columns.length} (${Object.keys(d.mapping || {}).length} mapped)` },
              { key: 'size', label: 'Size', render: (d) => fmtBytes(d.sizeBytes) },
              { key: 'q', label: 'Quality', render: (d) => (d.latestJobs.quality ? <StatusBadge tone="success">{fmtNum(d.latestJobs.quality.summary?.qualityScore, 1)}</StatusBadge> : <span className="text-muted">not assessed</span>) },
              { key: 'created', label: 'Uploaded', render: (d) => fmtDate(d.createdAt) },
              { key: 'actions', label: 'Actions', render: (d) => (
                <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button className="btn-ghost" aria-label={`Download original ${d.name}`} onClick={() => downloadFile(`/datasets/${d._id}/download`, { version: 1 }, 'dataset.csv').catch((e) => setMsg({ ok: false, text: errMsg(e) }))}><Download size={16} /></button>
                  <button className="btn-ghost text-red-600" aria-label={`Delete ${d.name}`} onClick={() => remove(d)}><Trash2 size={16} /></button>
                </span>) },
            ]} />
        </>
      )}
    </>
  );
}
