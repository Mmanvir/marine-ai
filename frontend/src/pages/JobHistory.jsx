import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import DataTable from '../components/DataTable';
import { ErrorState, Loading } from '../components/States';
import { Field, PageHeader, StatusBadge, SyntheticBadge } from '../components/ui';
import { durationSec, fmtDate, fmtNum, titleCase } from '../utils/format';

const PAGE_FOR = { quality: 'quality', anomalies: 'anomalies', reconstruct: 'recovery', evaluate: 'benchmarks' };

export default function JobHistory() {
  const nav = useNavigate();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useAsync(async () => (await api.get('/analysis/jobs', { params: { type: type || undefined, status: status || undefined, limit: 100 } })).data.jobs, [type, status]);
  const hasActive = data?.some((j) => ['queued', 'running'].includes(j.status));

  return (
    <>
      <PageHeader title="Analysis job history" subtitle="Every analysis is stored with its parameters, status and result summary. Select a finished job to open its results."
        actions={<button className="btn-secondary" onClick={reload}>{hasActive ? 'Refresh (jobs running)' : 'Refresh'}</button>} />
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <Field label="Type" htmlFor="jt"><select id="jt" className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option><option value="quality">Quality</option><option value="anomalies">Anomalies</option><option value="reconstruct">Reconstruct</option><option value="evaluate">Evaluate</option></select></Field>
        <Field label="Status" htmlFor="js"><select id="js" className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option>queued</option><option>running</option><option>succeeded</option><option>failed</option></select></Field>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <DataTable caption="Analysis jobs" rows={data} rowKey={(j) => j._id} empty="No jobs match."
          onRowClick={(j) => j.status === 'succeeded' && nav(`/app/${PAGE_FOR[j.type]}?dataset=${j.dataset?._id}${j.type === 'quality' ? `&job=${j._id}` : ''}`)}
          columns={[
            { key: 'type', label: 'Type', render: (j) => titleCase(j.type) },
            { key: 'ds', label: 'Dataset', render: (j) => <span className="flex items-center gap-1">{j.dataset?.name ?? 'deleted'}{j.dataset?.isSynthetic && <SyntheticBadge />}</span> },
            { key: 'status', label: 'Status', render: (j) => <div><StatusBadge value={j.status} />{j.status === 'failed' && <div className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-300">{j.error}</div>}</div> },
            { key: 'params', label: 'Parameters', render: (j) => <code className="text-xs">{Object.entries(j.params || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ').slice(0, 120)}</code> },
            { key: 'dur', label: 'Duration', render: (j) => (durationSec(j.startedAt, j.finishedAt) !== null ? `${fmtNum(durationSec(j.startedAt, j.finishedAt), 1)} s` : '—') },
            { key: 'v', label: 'Algorithm', render: (j) => j.algorithmVersion || '—' },
            { key: 'at', label: 'Created', render: (j) => fmtDate(j.createdAt) },
          ]} />
      )}
    </>
  );
}
