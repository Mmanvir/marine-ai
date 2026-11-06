import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { api, errMsg } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAnalysis } from '../hooks/useAnalysis';
import { DatasetPicker, JobPicker, useDatasets, useJobs } from '../components/Pickers';
import AnalysisProgress from '../components/AnalysisProgress';
import ChartCard from '../components/ChartCard';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';
import TrendChart from '../components/TrendChart';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Field, MetricCard, Notice, PageHeader, StatusBadge } from '../components/ui';
import { AXIS, COLORS, GRID, TOOLTIP_STYLE } from '../utils/palette';
import { fmtFrac, fmtNum, titleCase, VARIABLES } from '../utils/format';

export default function AnomalyExplorer() {
  const [sp] = useSearchParams();
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState(sp.get('dataset') || '');
  const [jobId, setJobId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [cols, setCols] = useState(['sea_surface_temperature']);
  const [madZ, setMadZ] = useState('3.5');
  const [contam, setContam] = useState('0.02');
  const [view, setView] = useState('sea_surface_temperature');
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const jobs = useJobs(datasetId, 'anomalies', refresh);
  const onPick = useCallback((id) => { setJobId(id); setPage(1); }, []);
  const run = useAnalysis('anomalies', (j) => { setRefresh((k) => k + 1); if (j.status === 'succeeded') setJobId(j._id); });

  const job = useAsync(async () => (await api.get(`/analysis/jobs/${jobId}`)).data.job, [jobId], !!jobId);
  const list = useAsync(async () => (await api.get(`/reports/${jobId}/quality`, { params: { category: 'suspected_anomaly', column: view, page, limit: 20 } })).data, [jobId, view, page], !!jobId);

  const toggle = (v) => setCols((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]));
  const start = () => run.start(datasetId, { columns: cols, madZ: Number(madZ), contamination: Number(contam) });
  const review = async (i, decision) => { setErr(''); try { await api.patch(`/reports/issues/${i._id}/review`, { decision }); list.reload(); } catch (e) { setErr(errMsg(e)); } };

  const summary = job.data?.summary;
  const colKeys = summary ? Object.keys(summary.columns) : [];
  const current = summary?.columns?.[view] || (colKeys.length ? summary.columns[colKeys[0]] : null);
  const viewCol = summary?.columns?.[view] ? view : colKeys[0];

  return (
    <>
      <PageHeader title="Anomaly explorer" subtitle="Robust MAD (statistical) and Isolation Forest (unsupervised ML), compared on the same data. A flag means an observation is unusual relative to its neighbours; it is not proof the sensor was wrong." />
      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <DatasetPicker datasets={ds.data} value={datasetId} onChange={(v) => { setDatasetId(v); setJobId(''); }} />
          <Field label="MAD threshold (robust z)" htmlFor="madz"><input id="madz" className="input w-32" type="number" step="0.1" min="1" max="20" value={madZ} onChange={(e) => setMadZ(e.target.value)} /></Field>
          <Field label="Isolation Forest contamination" htmlFor="cont" hint="Expected anomaly share (0.001-0.2)"><input id="cont" className="input w-32" type="number" step="0.005" min="0.001" max="0.2" value={contam} onChange={(e) => setContam(e.target.value)} /></Field>
          <button className="btn-primary" onClick={start} disabled={!datasetId || !cols.length || run.running}><Play size={16} /> Run detection</button>
          <JobPicker jobs={jobs.data} value={jobId} onChange={onPick} />
        </div>
        <fieldset className="flex flex-wrap gap-4"><legend className="label">Variables</legend>
          {VARIABLES.map((v) => <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cols.includes(v)} onChange={() => toggle(v)} /> {titleCase(v)}</label>)}
        </fieldset>
      </div>
      <AnalysisProgress job={run.job} error={run.error} />

      {!jobId ? <div className="mt-4"><EmptyState title="No anomaly results yet">Run detection to compare the two methods.</EmptyState></div>
        : job.loading && !job.data ? <Loading /> : job.error ? <ErrorState message={job.error} onRetry={job.reload} /> : !summary ? null : (
          <div className="mt-4 space-y-4">
            <Notice title="Anomaly ≠ confirmed error">Use the review buttons to record your own judgement; reviews are written to the audit trail.</Notice>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Variable shown" htmlFor="vv"><select id="vv" className="input" value={viewCol} onChange={(e) => { setView(e.target.value); setPage(1); }}>{colKeys.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></Field>
              <ExportButton url={`/reports/${jobId}/quality`} params={{ format: 'csv' }} filename="anomalies.csv" label="Export flagged CSV" />
            </div>
            {current && (
              <div className="grid gap-4 lg:grid-cols-3">
                <MetricCard label="Robust MAD flagged" value={fmtNum(current.mad.nFlagged, 0)} />
                <MetricCard label="Isolation Forest flagged" value={fmtNum(current.isolationForest.nFlagged, 0)} />
                <MetricCard label="Agreement (Jaccard)" value={current.agreement.jaccard === null ? '—' : fmtFrac(current.agreement.jaccard, 0)} hint={`${current.agreement.both} flagged by both`} />
              </div>
            )}
            {current && (
              <ChartCard title="Method comparison" subtitle="How the flags overlap" height={220}>
                <BarChart data={[{ name: 'Only MAD', n: current.agreement.only_mad }, { name: 'Both', n: current.agreement.both }, { name: 'Only Isolation Forest', n: current.agreement.only_isolation_forest }]} margin={{ left: 0, right: 10 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="name" {...AXIS} /><YAxis {...AXIS} allowDecimals={false} /><Tooltip contentStyle={TOOLTIP_STYLE} /><Legend />
                  <Bar dataKey="n" name="Observations" fill={COLORS.primary} />
                </BarChart>
              </ChartCard>
            )}
            <TrendChart datasetId={datasetId} variable={viewCol} jobId={jobId} title={`${titleCase(viewCol)} with flagged observations`} />
            <section className="card" aria-label="Flagged observations">
              {err && <p role="alert" className="mb-2 text-sm text-red-600">{err}</p>}
              {list.data && <DataTable caption="Flagged observations" rows={list.data.issues} rowKey={(i) => i._id} empty="Nothing was flagged for this variable."
                pagination={{ page, limit: list.data.limit, total: list.data.total, onPage: setPage }}
                columns={[
                  { key: 'rowId', label: 'Row' },
                  { key: 'by', label: 'Flagged by', render: (i) => <span className="flex gap-1">{i.detectedBy.map((m) => <StatusBadge key={m} tone="accent">{m === 'mad' ? 'MAD' : 'Isolation Forest'}</StatusBadge>)}</span> },
                  { key: 'sev', label: 'Confidence', render: (i) => <StatusBadge value={i.severity}>{i.detectedBy.length === 2 ? 'both agree' : 'single method'}</StatusBadge> },
                  { key: 'scores', label: 'Scores', render: (i) => <span className="text-xs">MAD |z| {fmtNum(i.scores?.mad, 1)} · IF {fmtNum(i.scores?.isolationForest, 3)}</span> },
                  { key: 'rv', label: 'Review', render: (i) => <div className="flex flex-col gap-1"><StatusBadge value={i.reviewStatus} /><div className="flex gap-1"><button className="btn-secondary px-2 py-1 text-xs" onClick={() => review(i, 'confirmed_error')}>Confirm error</button><button className="btn-secondary px-2 py-1 text-xs" onClick={() => review(i, 'dismissed')}>Dismiss</button></div></div> },
                ]} />}
            </section>
          </div>)}
    </>
  );
}
