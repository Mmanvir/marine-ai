import { useCallback, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { DatasetPicker, JobPicker, useDatasets, useJobs } from '../components/Pickers';
import ChartCard from '../components/ChartCard';
import TrendChart from '../components/TrendChart';
import DataTable from '../components/DataTable';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { MetricCard, Notice, PageHeader } from '../components/ui';
import { AXIS, COLORS, GRID, TOOLTIP_STYLE } from '../utils/palette';
import { fmtFrac, fmtNum, methodLabel } from '../utils/format';

export default function UncertaintyViz() {
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState('');
  const [jobId, setJobId] = useState('');
  const jobs = useJobs(datasetId, 'reconstruct');
  const evals = useJobs(datasetId, 'evaluate');
  const onPick = useCallback((id) => setJobId(id), []);

  const rep = useAsync(async () => (await api.get(`/reports/${jobId}/reconstruction`, { params: { status: 'reconstructed', limit: 5000 } })).data, [jobId], !!jobId);
  const bench = useAsync(async () => (await api.get(`/reports/${evals.data[0]._id}/benchmark`)).data.evaluation, [evals.data?.[0]?._id], !!evals.data?.length);

  const stats = useMemo(() => {
    const recs = rep.data?.records || [];
    const withIv = recs.filter((r) => r.uncertainty?.available && r.uncertainty.interval);
    const by = {};
    for (const r of withIv) {
      const hw = (r.uncertainty.interval.high - r.uncertainty.interval.low) / 2;
      (by[r.method] ||= []).push(hw);
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const hist = (() => {
      const hws = withIv.map((r) => (r.uncertainty.interval.high - r.uncertainty.interval.low) / 2);
      if (!hws.length) return [];
      const max = Math.max(...hws), n = 10, w = max / n || 1;
      const bins = Array.from({ length: n }, (_, i) => ({ label: `${fmtNum(i * w, 2)}`, n: 0 }));
      hws.forEach((h) => { bins[Math.min(n - 1, Math.floor(h / w))].n += 1; });
      return bins;
    })();
    return {
      total: recs.length, withInterval: withIv.length,
      byMethod: Object.entries(by).map(([method, a]) => ({ method, label: methodLabel(method), halfwidth: mean(a), n: a.length })), hist,
    };
  }, [rep.data]);

  const sc = bench.data?.results?.scenarios;
  const nominal = bench.data ? 1 - (evals.data?.[0]?.params?.alpha ?? 0.1) : null;
  const coverageRows = sc ? Object.entries(sc).filter(([, v]) => v.methods).map(([name, v]) => ({ name, ...v.methods.mare.overall })) : [];

  return (
    <>
      <PageHeader title="Uncertainty visualization" subtitle="Each reconstructed value carries an empirical prediction interval from holdout validation. It is an error range observed when the same method was run on known values, not a calibrated probability." />
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <DatasetPicker datasets={ds.data} value={datasetId} onChange={(v) => { setDatasetId(v); setJobId(''); }} />
        <JobPicker jobs={jobs.data} value={jobId} onChange={onPick} />
      </div>
      <Notice title="How to read this page">
        <strong>Point estimate</strong>: the reconstructed value. <strong>Prediction interval</strong>: empirical range from holdout errors (nominal level shown, <em>not calibrated</em>). <strong>Empirical error metrics</strong>: MAE/RMSE/bias of the method on hidden known values. <strong>Calibrated confidence</strong>: only claimed where the benchmark measured coverage (below). Low/moderate/high labels are deliberately not shown because no justified thresholds exist yet.
      </Notice>
      {!jobId ? <div className="mt-4"><EmptyState title="No reconstruction selected">Run a recovery analysis first.</EmptyState></div>
        : rep.loading && !rep.data ? <Loading /> : rep.error ? <ErrorState message={rep.error} onRetry={rep.reload} /> : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard label="Reconstructed values" value={fmtNum(stats.total, 0)} />
              <MetricCard label="With interval" value={fmtNum(stats.withInterval, 0)} hint={stats.total ? `${fmtFrac(stats.withInterval / stats.total, 0)} of values` : ''} />
              <MetricCard label="Interval unavailable" value={fmtNum(stats.total - stats.withInterval, 0)} hint="too few holdout residuals: explicitly marked unavailable" tone="warning" />
            </div>
            <TrendChart datasetId={datasetId} variable={rep.data.job.summary.variable} recon={rep.data.records.slice(0, 2000)} title="Observed series with reconstructed values and empirical intervals" height={340} />
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Interval half-width distribution" subtitle="Wider = less certain" empty={!stats.hist.length} height={220}>
                <BarChart data={stats.hist}><CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="label" {...AXIS} /><YAxis {...AXIS} allowDecimals={false} /><Tooltip contentStyle={TOOLTIP_STYLE} /><Bar dataKey="n" name="Values" fill={COLORS.primary} /></BarChart>
              </ChartCard>
              <ChartCard title="Mean interval half-width by method" empty={!stats.byMethod.length} height={220}>
                <BarChart data={stats.byMethod}><CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis dataKey="label" {...AXIS} /><YAxis {...AXIS} /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtNum(v, 4)} /><Bar dataKey="halfwidth" name="Half-width" fill={COLORS.violet} /></BarChart>
              </ChartCard>
            </div>
            <section className="card" aria-label="Measured coverage">
              <h2 className="text-sm font-semibold">Measured interval coverage (MARE, latest benchmark)</h2>
              {!coverageRows.length ? <p className="mt-2 text-sm text-muted">No benchmark yet. Run one on the Benchmarking page to see whether the nominal level was actually achieved on hidden test values.</p> : (
                <>
                  <p className="mb-2 mt-1 text-xs text-muted">Nominal level {fmtFrac(nominal, 0)}. Coverage far from nominal means the intervals are not calibrated for that scenario.</p>
                  <DataTable caption="Coverage by scenario" rows={coverageRows} rowKey={(r) => r.name} columns={[
                    { key: 'name', label: 'Scenario' }, { key: 'n', label: 'Values with interval', render: (r) => fmtNum(r.n_with_interval, 0) },
                    { key: 'c', label: 'Measured coverage', render: (r) => fmtFrac(r.pi_coverage, 1) }, { key: 'w', label: 'Mean width', render: (r) => fmtNum(r.pi_width, 3) },
                  ]} />
                </>)}
            </section>
          </div>)}
    </>
  );
}
