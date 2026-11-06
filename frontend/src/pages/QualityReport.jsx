import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
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
import { AXIS, COLORS, GRID, TOOLTIP_STYLE } from '../utils/palette';
import { fmtNum, fmtPct, titleCase } from '../utils/format';

export default function QualityReport() {
  const [sp] = useSearchParams();
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState(sp.get('dataset') || '');
  const [jobId, setJobId] = useState(sp.get('job') || '');
  const [refresh, setRefresh] = useState(0);
  const [interval, setIntervalS] = useState('');
  const [z, setZ] = useState('3.5');
  const [filters, setFilters] = useState({ severity: '', category: '' });
  const [page, setPage] = useState(1);
  const jobs = useJobs(datasetId, 'quality', refresh);
  const onPick = useCallback((id) => { setJobId(id); setPage(1); }, []);
  const run = useAnalysis('quality', (j) => { setRefresh((k) => k + 1); if (j.status === 'succeeded') setJobId(j._id); });

  const report = useAsync(async () => (await api.get(`/reports/${jobId}/quality`, { params: { page, limit: 25, severity: filters.severity || undefined, category: filters.category || undefined } })).data, [jobId, page, filters.severity, filters.category], !!jobId);
  const [reviewErr, setReviewErr] = useState('');

  const start = () => {
    const params = {};
    if (interval) params.expected_interval_seconds = Number(interval);
    if (z) params.outlier_z = Number(z);
    run.start(datasetId, params);
  };
  const review = async (issue, decision) => {
    setReviewErr('');
    try { await api.patch(`/reports/issues/${issue._id}/review`, { decision }); report.reload(); } catch (e) { setReviewErr(errMsg(e)); }
  };

  const s = report.data?.job?.summary;
  const cats = s ? Object.entries(s.issues_by_category || {}).map(([category, count]) => ({ category, count })) : [];

  return (
    <>
      <PageHeader title="Data quality report" subtitle="Missing values, duplicates, invalid coordinates and timestamps, non-numeric entries, irregular sampling, stuck sensors and statistical outliers. Outliers are suspected anomalies, never automatically errors." />
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <DatasetPicker datasets={ds.data} value={datasetId} onChange={(v) => { setDatasetId(v); setJobId(''); }} />
        <Field label="Expected interval (s)" htmlFor="ei" hint="Optional: enables delayed-observation checks"><input id="ei" className="input w-40" type="number" min="1" value={interval} onChange={(e) => setIntervalS(e.target.value)} placeholder="e.g. 3600" /></Field>
        <Field label="Outlier threshold (robust z)" htmlFor="z"><input id="z" className="input w-32" type="number" step="0.1" min="1" max="20" value={z} onChange={(e) => setZ(e.target.value)} /></Field>
        <button className="btn-primary" onClick={start} disabled={!datasetId || run.running}><Play size={16} /> Run assessment</button>
        <JobPicker jobs={jobs.data} value={jobId} onChange={onPick} />
      </div>
      <AnalysisProgress job={run.job} error={run.error} />

      {!jobId ? <div className="mt-4"><EmptyState title="No quality report yet">Pick a dataset and run an assessment.</EmptyState></div>
        : report.loading && !report.data ? <Loading /> : report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Quality score" value={fmtNum(s.quality_score, 1)} hint="Descriptive heuristic, not validated" />
              <MetricCard label="Missing values" value={fmtPct(s.missing_pct, 2)} hint={`${fmtNum(s.missing_count, 0)} of ${fmtNum(s.n_variable_cells, 0)} cells`} />
              <MetricCard label="Flagged rows" value={fmtNum(s.flagged_rows, 0)} hint={fmtPct(s.flagged_pct, 2) + ' of rows'} />
              <MetricCard label="Rows" value={fmtNum(s.n_rows, 0)} />
            </div>
            <p className="text-xs text-muted">Score definition: {s.quality_score_definition}</p>
            {s.issuesTruncated && <Notice tone="warning">Only the first {fmtNum(s.issuesStored, 0)} issues are stored; counts above are complete.</Notice>}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <ChartCard title="Issues by category" empty={!cats.length} emptyText="No issues found.">
                  <BarChart data={cats} layout="vertical" margin={{ left: 30, right: 10 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" /><XAxis type="number" {...AXIS} allowDecimals={false} /><YAxis type="category" dataKey="category" width={130} {...AXIS} tickFormatter={titleCase} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} /><Bar dataKey="count" fill={COLORS.primary} name="Issues" />
                  </BarChart>
                </ChartCard>
              </div>
              <section className="card lg:col-span-2" aria-label="Issue list">
                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <Field label="Severity" htmlFor="sev"><select id="sev" className="input" value={filters.severity} onChange={(e) => { setFilters((f) => ({ ...f, severity: e.target.value })); setPage(1); }}><option value="">All</option><option>high</option><option>medium</option><option>low</option></select></Field>
                  <Field label="Category" htmlFor="cat"><select id="cat" className="input" value={filters.category} onChange={(e) => { setFilters((f) => ({ ...f, category: e.target.value })); setPage(1); }}><option value="">All</option>{cats.map((c) => <option key={c.category} value={c.category}>{titleCase(c.category)}</option>)}</select></Field>
                  <div className="ml-auto flex gap-2">
                    <ExportButton url={`/reports/${jobId}/quality`} params={{ format: 'csv' }} filename="quality_issues.csv" label="Issues CSV" />
                    <ExportButton url={`/reports/dataset/${datasetId}/summary`} params={{ format: 'csv' }} filename="dataset_quality_summary.csv" label="Summary CSV" />
                  </div>
                </div>
                {reviewErr && <p role="alert" className="mb-2 text-sm text-red-600">{reviewErr}</p>}
                <DataTable caption="Quality issues" rows={report.data.issues} rowKey={(i) => i._id} empty="No issues match these filters."
                  pagination={{ page, limit: report.data.limit, total: report.data.total, onPage: setPage }}
                  columns={[
                    { key: 'rowId', label: 'Row', render: (i) => i.rowId ?? '—' },
                    { key: 'column', label: 'Column', render: (i) => i.column ?? '—' },
                    { key: 'category', label: 'Category', render: (i) => titleCase(i.category) },
                    { key: 'severity', label: 'Severity', render: (i) => <StatusBadge value={i.severity} /> },
                    { key: 'explanation', label: 'Explanation / method', render: (i) => <div className="max-w-md"><div>{i.explanation}</div><div className="text-xs text-muted">Method: {i.method} · Action: {i.recommendedAction}</div></div> },
                    { key: 'review', label: 'Review', render: (i) => (
                      <div className="flex flex-col gap-1"><StatusBadge value={i.reviewStatus} />
                        <div className="flex gap-1"><button className="btn-secondary px-2 py-1 text-xs" onClick={() => review(i, 'confirmed_error')}>Confirm error</button><button className="btn-secondary px-2 py-1 text-xs" onClick={() => review(i, 'dismissed')}>Dismiss</button></div></div>) },
                  ]} />
              </section>
            </div>
          </div>)}
    </>
  );
}
