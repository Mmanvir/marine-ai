import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, Database, FlaskConical, Gauge, Layers, Percent, ShieldAlert, Target } from 'lucide-react';
import { api, errMsg } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { DatasetPicker, useDatasets } from '../components/Pickers';
import { Loading, ErrorState, EmptyState } from '../components/States';
import ChartCard from '../components/ChartCard';
import TrendChart from '../components/TrendChart';
import DataTable from '../components/DataTable';
import { MetricCard, Notice, PageHeader, StatusBadge, SyntheticBadge, Field } from '../components/ui';
import { AXIS, COLORS, GRID, METHOD_COLORS, TOOLTIP_STYLE } from '../utils/palette';
import { fmtDate, fmtNum, fmtPct, methodLabel, titleCase, VARIABLES } from '../utils/format';

export default function Dashboard() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(async () => (await api.get('/dashboard')).data, []);
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState('');
  const [variable, setVariable] = useState('sea_surface_temperature');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState('');

  const loadDemo = async () => {
    setDemoBusy(true); setDemoErr('');
    try { const r = await api.post('/datasets/demo'); nav(`/app/datasets/${r.data.dataset._id}`); } catch (e) { setDemoErr(errMsg(e)); } finally { setDemoBusy(false); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const { metrics: m, charts: c, recentJobs, alerts } = data;
  const none = (v) => (v === null || v === undefined);

  if (m.totalDatasets === 0) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Live summary of your datasets and analysis results." />
        <EmptyState title="No datasets yet" action={<div className="flex gap-2"><Link className="btn-primary" to="/app/upload">Upload a CSV</Link><button className="btn-secondary" onClick={loadDemo} disabled={demoBusy}><FlaskConical size={16} /> {demoBusy ? 'Loading…' : 'Load synthetic demo dataset'}</button></div>}>
          Upload your own marine CSV, or load the bundled <strong>synthetic</strong> demo dataset (simulated buoys with injected defects and known ground truth).
          {demoErr && <span role="alert" className="mt-2 block text-red-600">{demoErr}</span>}
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Every figure below is computed from your own analysis results. Empty cards mean the corresponding analysis has not been run yet." />
      {m.syntheticDatasets > 0 && <div className="mb-4"><Notice title="Synthetic data present">{m.syntheticDatasets} of your datasets are simulated and labelled SYNTHETIC. Results on them demonstrate the method, not real ocean conditions.</Notice></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Datasets" value={fmtNum(m.totalDatasets, 0)} icon={Database} />
        <MetricCard label="Observations" value={fmtNum(m.totalObservations, 0)} icon={Layers} />
        <MetricCard label="Missing values" value={none(m.missingPct) ? '—' : fmtPct(m.missingPct)} hint={none(m.missingPct) ? 'Run a quality assessment' : 'of variable cells (latest quality runs)'} icon={Percent} />
        <MetricCard label="Suspicious observations" value={none(m.suspiciousCount) ? '—' : fmtNum(m.suspiciousCount, 0)} hint="Suspected anomalies, not confirmed errors" icon={ShieldAlert} tone="warning" />
        <MetricCard label="Reconstructed values" value={none(m.reconstructedCount) ? '—' : fmtNum(m.reconstructedCount, 0)} hint={none(m.reconstructedCount) ? 'Run a recovery analysis' : 'estimates, stored separately from originals'} icon={CheckCircle2} />
        <MetricCard label="Data quality score" value={none(m.qualityScore) ? '—' : fmtNum(m.qualityScore, 1)} hint="Descriptive heuristic (0-100), not a validated metric" icon={Gauge} />
        <MetricCard label="Avg. reconstruction error (MARE MAE)" value={none(m.avgReconstructionError) ? '—' : fmtNum(m.avgReconstructionError, 3)} hint={none(m.avgReconstructionError) ? 'No benchmark has run yet' : m.avgReconstructionErrorNote} icon={Target} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <DatasetPicker datasets={ds.data} value={datasetId} onChange={setDatasetId} id="trend-dataset" />
            <Field label="Variable" htmlFor="trend-var"><select id="trend-var" className="input" value={variable} onChange={(e) => setVariable(e.target.value)}>{VARIABLES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></Field>
          </div>
          <TrendChart datasetId={datasetId} variable={variable} />
        </div>

        <ChartCard title="Missingness before and after reconstruction" subtitle="Values still missing after the latest recovery run" empty={!c.missingness.length} emptyText="Run a recovery analysis to see this chart.">
          <BarChart data={c.missingness} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="name" {...AXIS} tickFormatter={(s) => (s?.length > 14 ? `${s.slice(0, 13)}…` : s)} /><YAxis {...AXIS} />
            <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend />
            <Bar dataKey="before" name="Missing before" fill={COLORS.amber} /><Bar dataKey="after" name="Missing after" fill={COLORS.primary} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Anomaly and issue distribution" subtitle="Issue categories in latest quality / anomaly runs (excluding plain missing values)" empty={!c.anomalyDistribution.length} emptyText="Run a quality assessment or anomaly detection.">
          <BarChart data={c.anomalyDistribution} layout="vertical" margin={{ left: 40, right: 12 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis type="number" {...AXIS} allowDecimals={false} /><YAxis type="category" dataKey="category" width={150} {...AXIS} tickFormatter={titleCase} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtNum(v, 0)} /><Bar dataKey="count" name="Issues" fill={COLORS.blue} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Data quality by dataset" subtitle="Score 0-100 from the latest quality run" empty={!c.qualityByDataset.length}>
          <BarChart data={c.qualityByDataset} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="name" {...AXIS} tickFormatter={(s) => (s?.length > 14 ? `${s.slice(0, 13)}…` : s)} /><YAxis domain={[0, 100]} {...AXIS} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtNum(v, 1)} /><Bar dataKey="score" name="Quality score" fill={COLORS.green} />
          </BarChart>
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard title="Reconstruction performance by algorithm" subtitle="Mean error across benchmark scenarios on hidden values (lower is better)" empty={!c.algorithmPerformance.length} emptyText="Run a benchmark on the Benchmarking page.">
            <BarChart data={c.algorithmPerformance.map((a) => ({ ...a, label: methodLabel(a.method) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="label" {...AXIS} /><YAxis {...AXIS} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtNum(v, 4)} /><Legend />
              <Bar dataKey="mae" name="MAE" fill={COLORS.primary} /><Bar dataKey="rmse" name="RMSE" fill={COLORS.violet} />
            </BarChart>
          </ChartCard>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card" aria-label="Recent analysis jobs">
          <h2 className="mb-3 text-sm font-semibold">Recent analysis jobs</h2>
          <DataTable caption="Recent jobs" rows={recentJobs} empty="No analyses have been run yet."
            columns={[
              { key: 'type', label: 'Type', render: (j) => titleCase(j.type) },
              { key: 'ds', label: 'Dataset', render: (j) => <span className="flex items-center gap-1">{j.dataset?.name}{j.dataset?.isSynthetic && <SyntheticBadge />}</span> },
              { key: 'status', label: 'Status', render: (j) => <StatusBadge value={j.status} /> },
              { key: 'at', label: 'When', render: (j) => fmtDate(j.createdAt) },
            ]} />
        </section>
        <section className="card" aria-label="Recent alerts">
          <h2 className="mb-1 text-sm font-semibold">Recent alerts</h2>
          <p className="mb-3 text-xs text-muted">{data.note}</p>
          {alerts.length === 0 ? <p className="text-sm text-muted">No alerts. Nothing needs attention.</p> : (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm"><AlertTriangle size={16} className={a.level === 'error' ? 'mt-0.5 text-red-500' : a.level === 'warning' ? 'mt-0.5 text-amber-500' : 'mt-0.5 text-sky-500'} aria-hidden="true" /><span>{a.message}<span className="block text-xs text-muted">{fmtDate(a.at)}</span></span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
