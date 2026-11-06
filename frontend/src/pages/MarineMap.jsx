import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { DatasetPicker, useDatasets } from '../components/Pickers';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Field, MetricCard, Notice, PageHeader, SyntheticBadge } from '../components/ui';
import { COLORS } from '../utils/palette';
import { fmtNum, titleCase, VARIABLES } from '../utils/format';

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
    map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [30, 30], maxZoom: 9 });
  }, [points, map]);
  return null;
}

export default function MarineMap() {
  const [sp] = useSearchParams();
  const ds = useDatasets();
  const [datasetId, setDatasetId] = useState(sp.get('dataset') || '');
  const [f, setF] = useState({ variable: '', status: 'all', from: '', to: '' });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { data, error, loading, reload } = useAsync(async () => (await api.get('/map/points', {
    params: { datasetId, variable: f.variable || undefined, status: f.status, from: f.from || undefined, to: f.to ? `${f.to}T23:59:59Z` : undefined },
  })).data, [datasetId, f.variable, f.status, f.from, f.to], !!datasetId);

  const all = data ? [...data.points, ...data.reconstructed] : [];

  return (
    <>
      <PageHeader title="Marine data map" subtitle="Plots only observations with valid coordinates from your file. Nothing is geocoded or invented." />
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <DatasetPicker datasets={ds.data} value={datasetId} onChange={setDatasetId} />
        <Field label="Variable" htmlFor="mv"><select id="mv" className="input" value={f.variable} onChange={set('variable')}><option value="">Any</option>{VARIABLES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></Field>
        <Field label="Quality status" htmlFor="ms"><select id="ms" className="input" value={f.status} onChange={set('status')}><option value="all">All</option><option value="ok">No issues</option><option value="flagged">Flagged</option><option value="reconstructed">Reconstructed only</option></select></Field>
        <Field label="From" htmlFor="mf"><input id="mf" type="date" className="input" value={f.from} onChange={set('from')} /></Field>
        <Field label="To" htmlFor="mt"><input id="mt" type="date" className="input" value={f.to} onChange={set('to')} /></Field>
        <button className="btn-secondary" onClick={() => { setF({ variable: '', status: 'all', from: '', to: '' }); }}>Reset filters</button>
      </div>
      {!datasetId ? <EmptyState title="No dataset selected" /> : loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            <MetricCard label="With valid coordinates" value={fmtNum(data.totals.withValidCoordinates, 0)} />
            <MetricCard label="Shown on map" value={fmtNum(data.totals.shown, 0)} hint={data.sampled ? 'unflagged points are sampled' : ''} />
            <MetricCard label="Flagged" value={fmtNum(data.totals.flagged, 0)} tone="warning" />
            <MetricCard label="Reconstructed" value={fmtNum(data.totals.reconstructed, 0)} />
          </div>
          {data.dataset.isSynthetic && <div className="mb-3 flex items-center gap-2 text-sm"><SyntheticBadge /> Simulated positions of fictional buoys.</div>}
          {all.length === 0 ? <EmptyState title="Nothing to plot">No observations with valid coordinates match these filters, or latitude/longitude are not mapped.</EmptyState> : (
            <div className="overflow-hidden rounded-xl border border-line" role="region" aria-label="Map of observations">
              <MapContainer center={[all[0].lat, all[0].lon]} zoom={5} scrollWheelZoom style={{ height: 520, width: '100%' }}>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FitBounds points={all} />
                {data.points.map((p) => (
                  <CircleMarker key={`p${p.rowId}`} center={[p.lat, p.lon]} radius={p.state === 'flagged' ? 6 : 3}
                    pathOptions={{ color: p.state === 'flagged' ? COLORS.red : COLORS.blue, fillOpacity: p.state === 'flagged' ? 0.8 : 0.5, weight: 1 }}>
                    <Popup><strong>Row {p.rowId}</strong><br />{p.sensor && <>Sensor {p.sensor}<br /></>}{p.t && new Date(p.t).toLocaleString()}<br />{p.value !== null && p.value !== undefined && <>Value: {fmtNum(p.value, 3)}<br /></>}{p.state === 'flagged' ? `Flagged: ${p.categories.map(titleCase).join(', ')}` : 'No issues recorded'}</Popup>
                  </CircleMarker>
                ))}
                {data.reconstructed.map((r) => (
                  <CircleMarker key={`r${r.rowId}`} center={[r.lat, r.lon]} radius={7} pathOptions={{ color: COLORS.amber, fillColor: COLORS.amber, fillOpacity: 0.35, weight: 2 }}>
                    <Popup><strong>Reconstructed (estimate)</strong><br />Row {r.rowId} · {titleCase(r.variable)}<br />Value {fmtNum(r.value, 3)}{r.interval ? ` (${fmtNum(r.interval.low, 3)} – ${fmtNum(r.interval.high, 3)})` : ' (interval unavailable)'}<br />Method: {r.method}</Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          )}
          <ul className="mt-3 flex flex-wrap gap-4 text-sm" aria-label="Legend">
            <li><span className="mr-1 inline-block h-3 w-3 rounded-full" style={{ background: COLORS.blue }} />Observation</li>
            <li><span className="mr-1 inline-block h-3 w-3 rounded-full" style={{ background: COLORS.red }} />Quality issue / suspected anomaly</li>
            <li><span className="mr-1 inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: COLORS.amber }} />Reconstructed value</li>
          </ul>
          <div className="mt-3"><Notice>Map tiles load from openstreetmap.org, so the map needs an internet connection; everything else works offline.</Notice></div>
        </>
      )}
    </>
  );
}
