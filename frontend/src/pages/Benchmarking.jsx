import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAnalysis } from '../hooks/useAnalysis';
import { DatasetPicker, JobPicker, useDatasets, useJobs } from '../components/Pickers';
import AnalysisProgress from '../components/AnalysisProgress';
import ChartCard from '../components/ChartCard';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Field, Notice, PageHeader, StatusBadge, SyntheticBadge } from '../components/ui';
import { AXIS, GRID, METHOD_COLORS, SERIES, TOOLTIP_STYLE } from '../utils/palette';
import { fmtFrac, fmtNum, methodLabel, titleCase, VARIABLES } from '../utils/format';

const VERDICT_TEXT = { mare_better: 'MARE better than the best fixed baseline', mare_not_better: 'MARE did not beat the best fixed baseline', tie: 'Tie', not_comparable: 'Not comparable' };

export default function Benchmarking() {
  const [sp] = useSearchParams();
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState(sp.get('dataset') || '');
  const [jobId, setJobId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [f, setF] = useState({ variable: 'sea_surface_temperature', nRepeats: '3', seed: '7', useTruth: true });
  const jobs = useJobs(datasetId, 'evaluate', refresh);
  const onPick = useCallback((id) => setJobId(id), []);
  const run = useAnalysis('evaluate', (j) => { setRefresh((k) => k + 1); if (j.status === 'succeeded') setJobId(j._id); });
  const res = useAsync(async () => (await api.get(`/reports/${jobId}/benchmark`)).data, [jobId], !!jobId);
  const isSynth = ds.data?.find((d) => d._id === datasetId)?.isSynthetic;

  const ev = res.data?.evaluation;
  const job = res.data?.job;
  const scenarios = ev ? Object.entries(ev.results.scenarios).filter(([, v]) => v.methods) : [];
  const methodsList = ev ? [...new Set(ev.summaryTable.map((r) => r.method))] : [];
  const rmseData = scenarios.map(([name, v]) => ({ scenario: titleCase(name), ...Object.fromEntries(Object.entries(v.methods).map(([m, e]) => [m, e.common_subset.rmse])) }));
  const covData = scenarios.map(([name, v]) => ({ scenario: titleCase(name), ...Object.fromEntries(Object.entries(v.methods).map(([m, e]) => [m, e.overall.pi_coverage])) }));
  const nominal = job ? 1 - (job.params?.alpha ?? 0.1) : 0.9;

  return (
    <>
      <PageHeader title="Model benchmarking" subtitle="Known values are hidden after a temporal split; each method must recover them without seeing them. Results are whatever the experiment measures, including cases where the adaptive method does not win." />
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <DatasetPicker datasets={ds.data} value={datasetId} onChange={(v) => { setDatasetId(v); setJobId(''); }} />
        <Field label="Variable" htmlFor="bv"><select id="bv" className="input" value={f.variable} onChange={(e) => setF((s) => ({ ...s, variable: e.target.value }))}>{VARIABLES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></Field>
        <Field label="Repeats" htmlFor="br" hint="1-5 random masks"><input id="br" type="number" min="1" max="5" className="input w-24" value={f.nRepeats} onChange={(e) => setF((s) => ({ ...s, nRepeats: e.target.value }))} /></Field>
        <Field label="Seed" htmlFor="bs"><input id="bs" type="number" className="input w-24" value={f.seed} onChange={(e) => setF((s) => ({ ...s, seed: e.target.value }))} /></Field>
        {isSynth && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.useTruth} onChange={(e) => setF((s) => ({ ...s, useTruth: e.target.checked }))} /> Use synthetic ground truth</label>}
        <button className="btn-primary" disabled={!datasetId || run.running} onClick={() => run.start(datasetId, { variable: f.variable, nRepeats: Number(f.nRepeats), seed: Number(f.seed), useTruth: f.useTruth })}><Play size={16} /> Run benchmark</button>
        <JobPicker jobs={jobs.data} value={jobId} onChange={onPick} />
      </div>
      <AnalysisProgress job={run.job} error={run.error} />

      {!jobId ? <div className="mt-4"><EmptyState title="No benchmark results yet">Run a benchmark. It can take a minute or two.</EmptyState></div>
        : res.loading && !res.data ? <Loading /> : res.error ? <ErrorState message={res.error} onRetry={res.reload} /> : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">Reference: {ev.referenceSource?.startsWith('SYNTHETIC') && <SyntheticBadge />}<span>{ev.referenceSource}</span> · temporal boundary {new Date(ev.results.boundary).toLocaleString()} · {ev.results.config.n_repeats} repeats, seed {ev.results.config.seed}</div>
            <div className="grid gap-3 md:grid-cols-3">
              {ev.verdict.map((v) => (
                <div key={v.scenario} className="card">
                  <div className="text-xs font-semibold uppercase text-muted">{titleCase(v.scenario)}</div>
                  <div className="mt-1"><StatusBadge value={v.result}>{VERDICT_TEXT[v.result] || v.result}</StatusBadge></div>
                  {v.mare_rmse !== undefined && <p className="mt-2 text-sm">MARE RMSE {fmtNum(v.mare_rmse, 4)} vs best fixed <strong>{methodLabel(v.best_fixed)}</strong> {fmtNum(v.best_fixed_rmse, 4)} ({v.relative_difference > 0 ? '+' : ''}{fmtNum(v.relative_difference * 100, 1)}%) on {v.n_common} common values</p>}
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="RMSE by method (common subset)" subtitle="Scored on values every method reconstructed; lower is better" height={280}>
                <BarChart data={rmseData}><CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="scenario" {...AXIS} /><YAxis {...AXIS} /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtNum(v, 4)} /><Legend formatter={methodLabel} />
                  {methodsList.map((m, i) => <Bar key={m} dataKey={m} name={m} fill={METHOD_COLORS[m] || SERIES[i % SERIES.length]} />)}</BarChart>
              </ChartCard>
              <ChartCard title="Prediction-interval coverage" subtitle={`Dashed line = nominal ${fmtFrac(nominal, 0)}. Below it means intervals under-cover`} height={280}>
                <BarChart data={covData}><CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="scenario" {...AXIS} /><YAxis domain={[0, 1]} {...AXIS} tickFormatter={(v) => fmtFrac(v, 0)} /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtFrac(v, 1)} /><Legend formatter={methodLabel} />
                  <ReferenceLine y={nominal} stroke="var(--ink)" strokeDasharray="5 4" />
                  {methodsList.map((m, i) => <Bar key={m} dataKey={m} name={m} fill={METHOD_COLORS[m] || SERIES[i % SERIES.length]} />)}</BarChart>
              </ChartCard>
            </div>
            <section className="card" aria-label="Results table">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">All results</h2><ExportButton url={`/reports/${jobId}/benchmark`} params={{ format: 'csv' }} filename="benchmark.csv" /></div>
              <DataTable caption="Benchmark results" rows={ev.summaryTable} rowKey={(r) => `${r.scenario}-${r.method}`} columns={[
                { key: 'scenario', label: 'Scenario', render: (r) => titleCase(r.scenario) }, { key: 'method', label: 'Method', render: (r) => methodLabel(r.method) },
                { key: 'pct', label: '% reconstructed', render: (r) => fmtNum(r.pct_reconstructed, 1) }, { key: 'mae', label: 'MAE', render: (r) => fmtNum(r.mae, 4) },
                { key: 'rmse', label: 'RMSE', render: (r) => fmtNum(r.rmse, 4) }, { key: 'bias', label: 'Bias', render: (r) => fmtNum(r.bias, 4) },
                { key: 'cov', label: 'PI coverage', render: (r) => fmtFrac(r.pi_coverage, 1) }, { key: 'w', label: 'PI width', render: (r) => fmtNum(r.pi_width, 3) },
                { key: 'rt', label: 'Runtime (s)', render: (r) => fmtNum(r.runtime_s, 2) },
              ]} />
            </section>
            {scenarios.map(([name, v]) => (
              <section key={name} className="card" aria-label={`Gap-length breakdown ${name}`}>
                <h2 className="mb-2 text-sm font-semibold">{titleCase(name)}: RMSE by gap length</h2>
                <DataTable caption="By gap length" rows={Object.entries(v.methods).map(([m, e]) => ({ m, ...Object.fromEntries(Object.entries(e.by_gap_length).map(([g, x]) => [g, x.rmse])) }))} rowKey={(r) => r.m}
                  columns={[{ key: 'm', label: 'Method', render: (r) => methodLabel(r.m) }, ...['short_1-3', 'medium_4-11', 'long_12+'].map((g) => ({ key: g, label: titleCase(g.replace('-', '–')), render: (r) => fmtNum(r[g], 4) }))]} />
                {v.methods.mare?.method_selection_counts && <p className="mt-2 text-xs text-muted">MARE selections: {Object.entries(v.methods.mare.method_selection_counts).map(([m, n]) => `${methodLabel(m)} ${n}`).join(' · ')}</p>}
              </section>
            ))}
            {job?.summary?.anomalyDetection && (
              <section className="card" aria-label="Detection accuracy">
                <h2 className="mb-2 text-sm font-semibold">Anomaly detection against injected spikes (synthetic labels)</h2>
                <DataTable caption="Detection metrics" rows={[{ m: 'Robust MAD', ...job.summary.anomalyDetection.mad }, { m: 'Isolation Forest', ...job.summary.anomalyDetection.isolationForest }]} rowKey={(r) => r.m}
                  columns={[{ key: 'm', label: 'Method' }, { key: 'tp', label: 'TP' }, { key: 'fp', label: 'FP' }, { key: 'fn', label: 'FN' }, { key: 'p', label: 'Precision', render: (r) => fmtNum(r.precision, 3) }, { key: 'r', label: 'Recall', render: (r) => fmtNum(r.recall, 3) }, { key: 'f', label: 'F1', render: (r) => fmtNum(r.f1, 3) }]} />
              </section>
            )}
            <Notice>Limitations: results depend on the dataset, mask seed and gap structure; synthetic data is easier than real data; intervals are empirical and uncalibrated unless coverage matches nominal above.</Notice>
          </div>)}
    </>
  );
}
