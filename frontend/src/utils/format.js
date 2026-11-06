export const fmtNum = (n, d = 2) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const fmtPct = (n, d = 1) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : `${Number(n).toFixed(d)}%`);
export const fmtFrac = (n, d = 1) => (n === null || n === undefined ? '—' : `${(Number(n) * 100).toFixed(d)}%`);
export const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtShortDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
export const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};
export const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
export const durationSec = (a, b) => (a && b ? Math.max(0, (new Date(b) - new Date(a)) / 1000) : null);

export const METHOD_LABELS = {
  mare: 'MARE (adaptive)', linear: 'Linear', time: 'Time-based', rolling: 'Rolling median', iterative: 'Iterative imputer',
  mad: 'Robust MAD', isolation_forest: 'Isolation Forest',
};
export const methodLabel = (m) => METHOD_LABELS[m] || titleCase(m);
export const VARIABLES = ['sea_surface_temperature', 'salinity', 'wave_height', 'current_speed'];
export const CANONICAL = ['timestamp', 'latitude', 'longitude', ...VARIABLES, 'sensor_id'];

const ALIASES = {
  timestamp: ['timestamp', 'time', 'datetime', 'date_time', 'date', 'obs_time', 'time_utc'],
  latitude: ['latitude', 'lat', 'lat_deg'],
  longitude: ['longitude', 'lon', 'long', 'lng', 'lon_deg'],
  sea_surface_temperature: ['sea_surface_temperature', 'sst', 'sea_temp', 'water_temp', 'temperature', 'temp'],
  salinity: ['salinity', 'sal', 'psu', 'sss'],
  wave_height: ['wave_height', 'hs', 'swh', 'significant_wave_height', 'wvht'],
  current_speed: ['current_speed', 'current', 'cur_speed', 'water_speed'],
  sensor_id: ['sensor_id', 'sensor', 'station', 'station_id', 'platform', 'buoy_id'],
};
export function suggestMapping(columns) {
  const lower = new Map(columns.map((c) => [c.toLowerCase().trim(), c]));
  const used = new Set();
  const out = {};
  for (const [canon, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      if (lower.has(n) && !used.has(lower.get(n))) { out[canon] = lower.get(n); used.add(lower.get(n)); break; }
    }
  }
  return out;
}

/** First line of a CSV as column names (handles simple quoting). */
export function parseHeaderLine(text) {
  const line = text.replace(/^﻿/, '').split(/\r?\n/)[0] || '';
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((c) => c !== '');
}
