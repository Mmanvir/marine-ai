import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../services/api';
import FileUploader from '../components/FileUploader';
import { Field, Notice, PageHeader } from '../components/ui';
import { CANONICAL, parseHeaderLine, suggestMapping, titleCase } from '../utils/format';

export default function UploadDataset() {
  const nav = useNavigate();
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [pct, setPct] = useState(null);

  const onFile = async (f) => {
    setFile(f);
    setName((n) => n || f.name.replace(/\.csv$/i, ''));
    const head = await f.slice(0, 65536).text();
    const cols = parseHeaderLine(head);
    if (cols.length === 0) { setError('Could not read a header row from this file.'); return; }
    if (new Set(cols).size !== cols.length) { setError('The header contains duplicate column names. Rename them and try again.'); return; }
    setColumns(cols);
    setMapping(suggestMapping(cols));
  };

  const setMap = (canon, src) => setMapping((m) => { const n = { ...m }; if (src) n[canon] = src; else delete n[canon]; return n; });

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setError('Choose a CSV file first.');
    const used = Object.values(mapping);
    if (new Set(used).size !== used.length) return setError('A source column can only be mapped to one canonical field.');
    if (!Object.keys(mapping).length) return setError('Map at least one column (for example timestamp and sea_surface_temperature).');
    const fd = new FormData();
    fd.append('name', name.trim() || file.name);
    if (description.trim()) fd.append('description', description.trim());
    fd.append('mapping', JSON.stringify(mapping));
    fd.append('file', file); // file last so text fields are parsed first
    setError(null); setPct(0);
    try {
      const { data } = await api.post('/datasets/upload', fd, { onUploadProgress: (p) => setPct(p.total ? Math.round((p.loaded / p.total) * 100) : null), timeout: 300000 });
      nav(`/app/datasets/${data.dataset._id}`);
    } catch (err) {
      setError(errMsg(err)); setPct(null);
    }
  };

  return (
    <>
      <PageHeader title="Upload dataset" subtitle="CSV only. Map your columns to the canonical schema; you do not need every field. Your original file is stored unchanged." />
      <form onSubmit={submit} className="space-y-5">
        <FileUploader file={file} onFile={onFile} onError={setError} />
        {error && <Notice tone="danger" title="Cannot upload">{error}</Notice>}
        {file && columns.length > 0 && (
          <>
            <div className="card grid gap-4 sm:grid-cols-2">
              <Field label="Dataset name" htmlFor="name"><input id="name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Description (optional)" htmlFor="desc"><input id="desc" className="input" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            </div>
            <section className="card" aria-labelledby="map-h">
              <h2 id="map-h" className="text-sm font-semibold">Column mapping</h2>
              <p className="mb-3 text-xs text-muted">Suggested automatically from column names. Change anything that is wrong; leave a field blank if your file lacks it.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {CANONICAL.map((c) => (
                  <Field key={c} label={titleCase(c)} htmlFor={`map-${c}`}>
                    <select id={`map-${c}`} className="input" value={mapping[c] || ''} onChange={(e) => setMap(c, e.target.value)}>
                      <option value="">— not in file —</option>
                      {columns.map((col) => <option key={col} value={col}>{col}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </section>
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={pct !== null}>{pct !== null ? `Uploading… ${pct}%` : 'Upload dataset'}</button>
              {pct !== null && <div className="h-2 w-48 overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-brand-500" style={{ width: `${pct}%` }} /></div>}
            </div>
          </>
        )}
      </form>
    </>
  );
}
