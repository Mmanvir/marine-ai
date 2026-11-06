import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, Download, Loader2, Play, XCircle } from 'lucide-react';
import { api, downloadFile, errMsg } from '../services/api';
import { waitForJob } from '../hooks/useAnalysis';
import { useAsync } from '../hooks/useAsync';
import DataTable from '../components/DataTable';
import TrendChart from '../components/TrendChart';
import { ErrorState, Loading } from '../components/States';
import { Field, Notice, PageHeader, Tabs, SyntheticBadge } from '../components/ui';
import { CANONICAL, fmtBytes, fmtDate, fmtNum, titleCase } from '../utils/format';

const STEPS = [
  { type: 'quality', label: 'Assess data quality' },
  { type: 'anomalies', label: 'Detect anomalies (MAD + Isolation Forest)' },
  { type: 'reconstruct', label: 'Reconstruct eligible gaps (MARE) + uncertainty' },
];

function Pipeline({ dataset, onDone }) {
  const [state, setState] = useState({});
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const hasVar = dataset.mapping.timestamp && dataset.mapping.sea_surface_temperature;

  const run = async () => {
    setRunning(true); setErr(''); setState({});
    try {
      for (const s of STEPS) {
        if (s.type === 'reconstruct' && !hasVar) { setState((x) => ({ ...x, [s.type]: { status: 'skipped', text: 'needs timestamp + sea_surface_temperature mapping' } })); continue; }
        setState((x) => ({ ...x, [s.type]: { status: 'running', text: 'starting…' } }));
        const { data } = await api.post(`/analysis/${dataset._id}/${s.type}`, s.type === 'reconstruct' ? { variable: 'sea_surface_temperature' } : {});
        const job = await waitForJob(data.job._id, (j) => setState((x) => ({ ...x, [s.type]: { status: 'running', text: `${j.stage} (${j.progress}%)` } })));
        setState((x) => ({ ...x, [s.type]: { status: job.status, text: job.status === 'failed' ? job.error : 'done' } }));
        if (job.status === 'failed') { setErr(`${s.label} failed: ${job.error}`); break; }
      }
    } catch (e) { setErr(errMsg(e)); } finally { setRunning(false); onDone?.(); }
  };

  const icon = (s) => (s === 'running' ? <Loader2 size={16} className="animate-spin text-sky-500" /> : s === 'succeeded' ? <CheckCircle2 size={16} className="text-emerald-500" /> : s === 'failed' ? <XCircle size={16} className="text-red-500" /> : <Circle size={16} className="text-muted" />);
  return (
    <section className="card" aria-label="Run full pipeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-sm font-semibold">Run the full workflow</h2><p className="text-xs text-muted">Quality → anomalies → reconstruction. Results appear in each analysis page. Benchmarks are run separately.</p></div>
        <button className="btn-primary" onClick={run} disabled={running}><Play size={16} /> {running ? 'Running…' : 'Run pipeline'}</button>
      </div>
      <ol className="mt-4 space-y-2">
        {STEPS.map((s) => <li key={s.type} className="flex items-center gap-2 text-sm">{icon(state[s.type]?.status)} <span>{s.label}</span><span className="text-xs text-muted">{state[s.type]?.text}</span></li>)}
      </ol>
      {err && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{err}</p>}
    </section>
  );
}

function MappingEditor({ dataset, onSaved }) {
  const cols = dataset.columns.map((c) => c.name);
  const [mapping, setMapping] = useState(dataset.mapping || {});
  const [msg, setMsg] = useState(null);
  const save = async () => {
    setMsg(null);
    try { await api.put(`/datasets/${dataset._id}/mapping`, { mapping }); setMsg({ ok: true, text: 'Mapping saved. Re-run analyses to apply it.' }); onSaved?.(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };
  const set = (c, v) => setMapping((m) => { const n = { ...m }; if (v) n[c] = v; else delete n[c]; return n; });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CANONICAL.map((c) => (
          <Field key={c} label={titleCase(c)} htmlFor={`m-${c}`}>
            <select id={`m-${c}`} className="input" value={mapping[c] || ''} onChange={(e) => set(c, e.target.value)}>
              <option value="">— not mapped —</option>{cols.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-3"><button className="btn-primary" onClick={save}>Save mapping</button>{msg && <span role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}</div>
    </div>
  );
}

function Preview({ id }) {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useAsync(async () => (await api.get(`/datasets/${id}/preview`, { params: { page, limit: 20 } })).data, [id, page]);
  if (error) return <ErrorState message={error} />;
  if (loading && !data) return <Loading />;
  return <DataTable caption="Dataset preview" rows={data.rows} rowKey={(r) => r._rowId}
    columns={[{ key: '_rowId', label: '#' }, ...data.columns.map((c) => ({ key: c, label: c }))]} pagination={{ page, limit: data.limit, total: data.total, onPage: setPage }} />;
}

export default function DatasetDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState('overview');
  const [variable, setVariable] = useState('sea_surface_temperature');
  const { data, error, loading, reload } = useAsync(async () => (await api.get(`/datasets/${id}`)).data, [id]);
  const [dlErr, setDlErr] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const { dataset: d, versions } = data;
  const profile = d.profile?.columns || [];
  const mappedVars = ['sea_surface_temperature', 'salinity', 'wave_height', 'current_speed'].filter((v) => d.mapping[v]);

  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{d.name}{d.isSynthetic && <SyntheticBadge />}</span>}
        subtitle={d.description || `${fmtNum(d.rowCount, 0)} rows · ${d.columns.length} columns · ${fmtBytes(d.sizeBytes)} · uploaded ${fmtDate(d.createdAt)}`}
        actions={<><Link className="btn-secondary" to={`/app/map?dataset=${d._id}`}>View on map</Link><Link className="btn-secondary" to={`/app/audit?dataset=${d._id}`}>Audit trail</Link></>} />
      {d.isSynthetic && <div className="mb-4"><Notice title="Synthetic dataset">All values are simulated, with injected defects (random gaps, long gaps, spikes, duplicates, delayed and irregular samples). Ground truth is kept separately for benchmarking only.</Notice></div>}
      <Pipeline dataset={d} onDone={reload} />
      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'preview', label: 'Preview' }, { id: 'mapping', label: 'Column mapping' }, { id: 'chart', label: 'Time series' }, { id: 'versions', label: `Versions (${versions.length})` }]} />
        {tab === 'overview' && (profile.length === 0 ? <Notice tone="warning" title="Summary statistics unavailable">The analysis service did not respond. Start the ML service and reload to see column statistics.</Notice> : (
          <DataTable caption="Column summary" rows={profile} rowKey={(c) => c.name} columns={[
            { key: 'name', label: 'Column', render: (c) => <span className="font-medium">{c.name}</span> },
            { key: 'type', label: 'Type' },
            { key: 'non_null', label: 'Non-null', render: (c) => fmtNum(c.non_null, 0) },
            { key: 'missing', label: 'Missing', render: (c) => fmtNum(c.missing, 0) },
            { key: 'unique', label: 'Unique', render: (c) => fmtNum(c.unique, 0) },
            { key: 'min', label: 'Min', render: (c) => (c.type === 'numeric' ? fmtNum(c.min, 3) : c.type === 'datetime' ? fmtDate(c.min) : '—') },
            { key: 'max', label: 'Max', render: (c) => (c.type === 'numeric' ? fmtNum(c.max, 3) : c.type === 'datetime' ? fmtDate(c.max) : '—') },
            { key: 'mean', label: 'Mean', render: (c) => (c.type === 'numeric' ? fmtNum(c.mean, 3) : '—') },
            { key: 'std', label: 'Std', render: (c) => (c.type === 'numeric' ? fmtNum(c.std, 3) : '—') },
          ]} />))}
        {tab === 'preview' && <Preview id={d._id} />}
        {tab === 'mapping' && <MappingEditor dataset={d} onSaved={reload} />}
        {tab === 'chart' && (mappedVars.length ? (
          <div className="space-y-3">
            <Field label="Variable" htmlFor="v"><select id="v" className="input max-w-xs" value={mappedVars.includes(variable) ? variable : mappedVars[0]} onChange={(e) => setVariable(e.target.value)}>{mappedVars.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></Field>
            <TrendChart datasetId={d._id} variable={mappedVars.includes(variable) ? variable : mappedVars[0]} />
          </div>) : <Notice tone="warning">Map a timestamp and at least one variable column to see a time series.</Notice>)}
        {tab === 'versions' && (
          <>
            {dlErr && <p role="alert" className="mb-2 text-sm text-red-600">{dlErr}</p>}
            <DataTable caption="Dataset versions" rows={versions} rowKey={(v) => v._id} columns={[
              { key: 'version', label: 'Version', render: (v) => `v${v.version}` },
              { key: 'kind', label: 'Kind' },
              { key: 'note', label: 'Note' },
              { key: 'sha', label: 'SHA-256', render: (v) => <code className="text-xs">{v.sha256?.slice(0, 16)}…</code> },
              { key: 'at', label: 'Created', render: (v) => fmtDate(v.createdAt) },
              { key: 'dl', label: '', render: (v) => <button className="btn-secondary" onClick={() => downloadFile(`/datasets/${d._id}/download`, { version: v.version }, `v${v.version}.csv`).catch((e) => setDlErr(errMsg(e)))}><Download size={14} /> Download</button> },
            ]} />
          </>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {[['quality', 'Quality report'], ['anomalies', 'Anomaly explorer'], ['recovery', 'Recovery analysis'], ['benchmarks', 'Benchmarking']].map(([p, l]) => <button key={p} className="btn-secondary" onClick={() => nav(`/app/${p}?dataset=${d._id}`)}>{l}</button>)}
      </div>
    </>
  );
}
