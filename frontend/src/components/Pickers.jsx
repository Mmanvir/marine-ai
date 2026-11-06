import { useEffect } from 'react';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { fmtDate } from '../utils/format';

/** Loads the user's datasets once. */
export function useDatasets() {
  return useAsync(async () => (await api.get('/datasets')).data.datasets, []);
}

/** Dataset <select>. Auto-selects the first dataset if none chosen. */
export function DatasetPicker({ value, onChange, datasets, id = 'dataset-picker' }) {
  useEffect(() => {
    if (!value && datasets?.length) onChange(datasets[0]._id);
  }, [value, datasets, onChange]);
  return (
    <div>
      <label className="label" htmlFor={id}>Dataset</label>
      <select id={id} className="input min-w-[14rem]" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {!datasets?.length && <option value="">No datasets</option>}
        {datasets?.map((d) => <option key={d._id} value={d._id}>{d.isSynthetic ? '[SYNTHETIC] ' : ''}{d.name}</option>)}
      </select>
    </div>
  );
}

/** Past succeeded jobs of given type(s) for a dataset. `refreshKey` reloads after a new run. */
export function useJobs(datasetId, types, refreshKey = 0) {
  return useAsync(async () => {
    const out = [];
    for (const t of [].concat(types)) {
      const { data } = await api.get('/analysis/jobs', { params: { datasetId, type: t, status: 'succeeded', limit: 30 } });
      out.push(...data.jobs);
    }
    return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [datasetId, [].concat(types).join(','), refreshKey], !!datasetId);
}

export function JobPicker({ jobs, value, onChange, id = 'job-picker' }) {
  useEffect(() => {
    if (jobs?.length && !jobs.some((j) => j._id === value)) onChange(jobs[0]._id);
    if (jobs && !jobs.length && value) onChange('');
  }, [jobs, value, onChange]);
  return (
    <div>
      <label className="label" htmlFor={id}>Result set</label>
      <select id={id} className="input min-w-[14rem]" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={!jobs?.length}>
        {!jobs?.length && <option value="">No results yet</option>}
        {jobs?.map((j) => <option key={j._id} value={j._id}>{j.type} · {fmtDate(j.finishedAt || j.createdAt)}</option>)}
      </select>
    </div>
  );
}
