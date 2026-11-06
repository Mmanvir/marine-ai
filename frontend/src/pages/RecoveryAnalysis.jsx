import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import { api, errMsg } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAnalysis } from '../hooks/useAnalysis';
import { DatasetPicker, JobPicker, useDatasets, useJobs } from '../components/Pickers';
import AnalysisProgress from '../components/AnalysisProgress';
import ChartCard from '../components/ChartCard';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Field, MetricCard, Notice, PageHeader, StatusBadge } from '../components/ui';
import { AXIS, GRID, METHOD_COLORS, COLORS, TOOLTIP_STYLE } from '../utils/palette';
import { fmtNum, methodLabel, titleCase, VARIABLES } from '../utils/format';

function Evidence({ r }) {
  const dec = r.evidence?.decision;
  return (
    <div className="space-y-2 bg-brand-500/5 p-3 text-sm">
      <p><strong>Why:</strong> {r.statusReason}</p>
      <p className="text-xs text-muted">Gap of {r.evidence?.gap_length_samples} samples · series {fmtNum((r.evidence?.observed_fraction || 0) * 100, 0)}% observed · algorithm {r.algorithmVersion}</p>
      {r.evidence?.left_neighbour && <p className="text-xs text-muted">Neighbours: {fmtNum(r.evidence.left_neighbour.value, 3)} before, {fmtNum(r.evidence.right_neighbour.value, 3)} after</p>}
      {dec?.candidates?.length > 0 && (
        <table className="text-xs"><caption className="sr-only">Candidate methods</caption>
          <thead><tr><th className="th">Candidate</th><th className="th">Eligible</th><th className="th">Holdout RMSE</th><th className="th">Residuals</th></tr></thead>
          <tbody>{dec.candidates.map((c) => <tr key={c.method}><td className="td">{methodLabel(c.method)}</td><td className="td">{c.eligible ? (c.available === false ? `no (${c.reason})` : 'yes') : `no (${c.reason})`}</td><td className="td">{fmtNum(c.holdout_rmse, 4)}</td><td className="td">{c.n_residuals ?? '—'}</td></tr>)}</tbody>
        </table>
      )}
      <ul className="list-inside list-disc text-xs text-muted">{r.limitations?.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

export default function RecoveryAnalysis() {
  const [sp] = useSearchParams();
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState(sp.get('dataset') || '');
  const [jobId, setJobId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [f, setF] = useState({ variable: 'sea_surface_temperature', method: 'mare', maxGap: '24', minObs: '0.5', maxRel: '', alpha: '0.1' });
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const jobs = useJobs(datasetId, 'reconstruct', refresh);
  const onPick = useCallback((id) => { setJobId(id); setPage(1); }, []);
  const run = useAnalysis('reconstruct', (j) => { setRefresh((k) => k + 1); if (j.status === 'succeeded') setJobId(j._id); });
  const rep = useAsync(async () => (await api.get(`/reports/${jobId}/reconstruction`, { params: { page, limit: 20, status: status || undefined } })).data, [jobId, page, status], !!jobId);

  const start = () => run.start(datasetId, {
    variable: f.variable, method: f.method, maxGap: Number(f.maxGap), minObsFraction: Number(f.minObs), alpha: Number(f.alpha),
    ...(f.maxRel ? { maxRelativeHalfwidth: Number(f.maxRel) } : {}),
  });
  const review = async (r, decision) => { setErr(''); try { await api.patch(`/reports/records/${r._id}/review`, { decision }); rep.reload(); } catch (e) { setErr(errMsg(e)); } };

  const sum = rep.data?.job?.summary;
  const methods = sum ? Object.entries(sum.by_method || {}).map(([method, n]) => ({ method, label: methodLabel(method), n })) : [];
  const sc = rep.data?.statusCounts || {};

  return (
    <>
      <PageHeader title="Recovery analysis" subtitle="Fills interior gaps only (no extrapolation), within a maximum gap length, never across sensors. MARE picks a method per gap from holdout evidence and abstains when evidence is inadequate. Estimates are stored separately from original observations." />
      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <DatasetPicker datasets={ds.data} value={datasetId} onChange={(v) => { setDatasetId(v); setJobId(''); }} />
          <Field label="Variable" htmlFor="rv"><select id="rv" className="input" value={f.variable} onChange={set('variable')}>{VARIABLES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></Field>
          <Field label="Method" htmlFor="rm"><select id="rm" className="input" value={f.method} onChange={set('method')}>{['mare', 'linear', 'time', 'rolling', 'iterative'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></Field>
          <JobPicker jobs={jobs.data} value={jobId} onChange={onPick} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Max gap (samples)" htmlFor="mg"><input id="mg" className="input w-28" type="number" min="1" max="500" value={f.maxGap} onChange={set('maxGap')} /></Field>
          <Field label="Min observed fraction" htmlFor="mo" hint="MARE abstains below this"><input id="mo" className="input w-28" type="number" step="0.05" min="0" max="1" value={f.minObs} onChange={set('minObs')} /></Field>
          <Field label="Interval level (1-α)" htmlFor="al" hint="α = 0.1 → 90% nominal"><input id="al" className="input w-28" type="number" step="0.01" min="0.01" max="0.5" value={f.alpha} onChange={set('alpha')} /></Field>
          <Field label="Max rel. half-width" htmlFor="mr" hint="Optional: abstain if interval too wide"><input id="mr" className="input w-28" type="number" step="0.1" min="0" value={f.maxRel} onChange={set('maxRel')} placeholder="none" /></Field>
          <button className="btn-primary" onClick={start} disabled={!datasetId || run.running}><Play size={16} /> Run recovery</button>
        </div>
      </div>
      <AnalysisProgress job={run.job} error={run.error} />

      {!jobId ? <div className="mt-4"><EmptyState title="No reconstruction yet">Choose a dataset and run recovery. Missing values with insufficient evidence are left missing.</EmptyState></div>
        : rep.loading && !rep.data ? <Loading /> : rep.error ? <ErrorState message={rep.error} onRetry={rep.reload} /> : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Reconstructed" value={fmtNum(sc.reconstructed || 0, 0)} />
              <MetricCard label="Abstained" value={fmtNum(sc.abstained || 0, 0)} hint="evidence inadequate or too uncertain" tone="warning" />
              <MetricCard label="Skipped" value={fmtNum(sc.skipped || 0, 0)} hint="edge gap, too long, or ineligible" />
              <MetricCard label="Configured method" value={methodLabel(sum.configured_method)} hint={`max gap ${sum.max_gap}, extrapolation ${sum.extrapolation}`} />
            </div>
            {sum.excludedRowCount > 0 && <Notice tone="warning">{sum.excludedRowCount} rows were excluded from reconstruction (duplicate or invalid timestamps) and left untouched.</Notice>}
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Methods selected" subtitle="Values reconstructed per method" empty={!methods.length} height={220}>
                <BarChart data={methods} margin={{ left: 0, right: 10 }}><CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="label" {...AXIS} /><YAxis {...AXIS} allowDecimals={false} /><Tooltip contentStyle={TOOLTIP_STYLE} /><Bar dataKey="n" name="Values" fill={COLORS.primary} /></BarChart>
              </ChartCard>
              <section className="card lg:col-span-2" aria-label="Reconstruction records">
                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <Field label="Status" htmlFor="st"><select id="st" className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option>reconstructed</option><option>abstained</option><option>skipped</option></select></Field>
                  <div className="ml-auto flex gap-2">
                    <ExportButton url={`/reports/${jobId}/reconstruction`} params={{ format: 'csv' }} filename="reconstruction.csv" label="Records CSV" />
                    <ExportButton url={`/reports/${jobId}/processed`} filename="processed.csv" label="Processed dataset" />
                  </div>
                </div>
                {err && <p role="alert" className="mb-2 text-sm text-red-600">{err}</p>}
                <DataTable caption="Reconstruction records" rows={rep.data.records} rowKey={(r) => r._id} empty="No records for this filter."
                  pagination={{ page, limit: rep.data.limit, total: rep.data.total, onPage: setPage }}
                  columns={[
                    { key: 'x', label: '', render: (r) => <button aria-label="Show evidence" aria-expanded={open === r._id} className="btn-ghost px-1 py-1" onClick={() => setOpen(open === r._id ? null : r._id)}>{open === r._id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> },
                    { key: 'row', label: 'Row', render: (r) => <div>{r.rowId}{open === r._id && <div className="mt-2 w-[28rem] max-w-[80vw]"><Evidence r={r} /></div>}</div> },
                    { key: 'time', label: 'Time', render: (r) => (r.timestamp ? new Date(r.timestamp).toLocaleString() : '—') },
                    { key: 'method', label: 'Method', render: (r) => (r.method ? methodLabel(r.method) : '—') },
                    { key: 'val', label: 'Estimate', render: (r) => fmtNum(r.reconstructedValue, 3) },
                    { key: 'int', label: 'Interval', render: (r) => (r.uncertainty?.available && r.uncertainty.interval ? `${fmtNum(r.uncertainty.interval.low, 3)} – ${fmtNum(r.uncertainty.interval.high, 3)}` : <span className="text-muted">unavailable</span>) },
                    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
                    { key: 'rv', label: 'Review', render: (r) => (r.status === 'reconstructed' ? <div className="flex flex-col gap-1"><StatusBadge value={r.reviewStatus} /><div className="flex gap-1"><button className="btn-secondary px-2 py-1 text-xs" onClick={() => review(r, 'accepted')}>Accept</button><button className="btn-secondary px-2 py-1 text-xs" onClick={() => review(r, 'rejected')}>Reject</button></div></div> : '—') },
                  ]} />
              </section>
            </div>
          </div>)}
    </>
  );
}
