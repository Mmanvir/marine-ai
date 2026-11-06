import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { DatasetPicker, useDatasets } from '../components/Pickers';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Field, Notice, PageHeader, StatusBadge } from '../components/ui';
import { fmtDate, fmtNum, methodLabel, titleCase } from '../utils/format';

export default function AuditTrail() {
  const [sp] = useSearchParams();
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState(sp.get('dataset') || '');
  const [f, setF] = useState({ action: '', observationState: '', rowId: '' });
  const [page, setPage] = useState(1);
  const set = (k) => (e) => { setF((s) => ({ ...s, [k]: e.target.value })); setPage(1); };
  const { data, error, loading, reload } = useAsync(async () => (await api.get(`/audit/${datasetId}`, { params: { page, limit: 25, action: f.action || undefined, observationState: f.observationState || undefined, rowId: f.rowId || undefined } })).data, [datasetId, page, f.action, f.observationState, f.rowId], !!datasetId);

  return (
    <>
      <PageHeader title="Audit trail" subtitle="Append-only history of everything done to a dataset: uploads, detections, reconstructions and manual reviews. Original observations are never overwritten; this log shows what changed, when, by whom, and with which algorithm version." />
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <DatasetPicker datasets={ds.data} value={datasetId} onChange={(v) => { setDatasetId(v); setPage(1); }} />
        <Field label="Observation state" htmlFor="as"><select id="as" className="input" value={f.observationState} onChange={set('observationState')}><option value="">All</option><option value="original">Original</option><option value="flagged">Flagged</option><option value="reconstructed">Reconstructed</option><option value="manually_reviewed">Manually reviewed</option></select></Field>
        <Field label="Action" htmlFor="aa"><select id="aa" className="input" value={f.action} onChange={set('action')}><option value="">All</option>{['dataset_uploaded', 'mapping_changed', 'issue_detected', 'anomaly_flagged', 'value_reconstructed', 'reconstruction_abstained', 'issue_reviewed', 'reconstruction_reviewed', 'quality_started', 'quality_finished', 'reconstruct_started', 'reconstruct_finished'].map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}</select></Field>
        <Field label="Row id" htmlFor="ar"><input id="ar" type="number" min="0" className="input w-28" value={f.rowId} onChange={set('rowId')} /></Field>
        <div className="ml-auto"><ExportButton url={`/audit/${datasetId}`} params={{ format: 'csv', action: f.action || undefined, observationState: f.observationState || undefined }} filename="audit.csv" disabled={!datasetId} /></div>
      </div>
      {!datasetId ? <EmptyState title="Select a dataset" /> : loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <DataTable caption="Audit log" rows={data.entries} rowKey={(e) => e._id} empty="No audit entries match."
            pagination={{ page, limit: data.limit, total: data.total, onPage: setPage }}
            columns={[
              { key: 'at', label: 'When', render: (e) => fmtDate(e.createdAt) },
              { key: 'user', label: 'User', render: (e) => e.user?.email || e.user?.name || '—' },
              { key: 'action', label: 'Action', render: (e) => titleCase(e.action) },
              { key: 'state', label: 'State', render: (e) => (e.observationState ? <StatusBadge value={e.observationState} /> : '—') },
              { key: 'ver', label: 'Version', render: (e) => (e.datasetVersion ? `v${e.datasetVersion}` : '—') },
              { key: 'row', label: 'Row / column', render: (e) => (e.rowId !== null ? `${e.rowId}${e.column ? ` · ${e.column}` : ''}` : '—') },
              { key: 'm', label: 'Method', render: (e) => (e.method ? e.method.split('+').map(methodLabel).join(' + ') : e.issueCategory ? titleCase(e.issueCategory) : '—') },
              { key: 'val', label: 'Original → new', render: (e) => (e.newValue !== null && e.newValue !== undefined ? `${e.originalValue ?? 'missing'} → ${fmtNum(e.newValue, 4)}` : '—') },
              { key: 'u', label: 'Uncertainty', render: (e) => (e.uncertainty ? (e.uncertainty.available && e.uncertainty.interval ? `${fmtNum(e.uncertainty.interval.low, 3)} – ${fmtNum(e.uncertainty.interval.high, 3)}` : 'unavailable') : '—') },
              { key: 'alg', label: 'Algorithm', render: (e) => e.algorithmVersion || '—' },
            ]} />
          <div className="mt-3"><Notice>Audit entries are retained even after a dataset is deleted, to preserve traceability. They are append-only: the API offers no way to edit or remove them.</Notice></div>
        </>)}
    </>
  );
}
