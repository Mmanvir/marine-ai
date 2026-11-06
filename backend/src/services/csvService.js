const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const config = require('../config/env');
const { AppError } = require('../middleware');

const CANONICAL = ['timestamp', 'latitude', 'longitude', 'sea_surface_temperature', 'salinity', 'wave_height', 'current_speed', 'sensor_id'];
const VARIABLES = ['sea_surface_temperature', 'salinity', 'wave_height', 'current_speed'];
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
const MAX_COLUMNS = 200;

/** Resolve a stored relative path inside UPLOAD_DIR (blocks path traversal). */
function fullPath(rel) {
  const p = path.resolve(config.uploadDir, rel);
  if (!p.startsWith(config.uploadDir + path.sep)) throw new AppError(400, 'Invalid storage path');
  return p;
}

function ensureUploadDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseCsvText(text) {
  try {
    return parse(text, {
      columns: (header) => {
        const names = header.map((h) => String(h).trim());
        if (names.some((n) => !n)) throw new Error('header contains an empty column name');
        if (new Set(names).size !== names.length) throw new Error('header contains duplicate column names');
        if (names.length > MAX_COLUMNS) throw new Error(`too many columns (max ${MAX_COLUMNS})`);
        return names;
      },
      skip_empty_lines: true,
      bom: true,
    });
  } catch (e) {
    throw new AppError(400, `Invalid CSV: ${e.message}`);
  }
}

function inferColumns(header, rows) {
  return header.map((name) => {
    const vals = [];
    for (const r of rows) {
      const v = r[name];
      if (v !== undefined && String(v).trim() !== '') vals.push(String(v).trim());
      if (vals.length >= 500) break;
    }
    if (!vals.length) return { name, type: 'empty' };
    const numeric = vals.filter((v) => Number.isFinite(Number(v))).length / vals.length;
    if (numeric >= 0.9) return { name, type: 'numeric' };
    const dates = vals.filter((v) => !Number.isNaN(Date.parse(v))).length / vals.length;
    return { name, type: dates >= 0.9 ? 'datetime' : 'string' };
  });
}

function suggestMapping(header) {
  const lower = new Map(header.map((h) => [h.toLowerCase().trim(), h]));
  const out = {};
  const used = new Set();
  for (const [canon, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      if (lower.has(n) && !used.has(lower.get(n))) {
        out[canon] = lower.get(n);
        used.add(lower.get(n));
        break;
      }
    }
  }
  return out;
}

function validateMapping(mapping, header) {
  for (const [canon, src] of Object.entries(mapping || {})) {
    if (!CANONICAL.includes(canon)) throw new AppError(400, `Unsupported canonical field '${canon}'`);
    if (!header.includes(src)) throw new AppError(400, `Source column '${src}' not found in the file`);
  }
  const srcs = Object.values(mapping || {});
  if (new Set(srcs).size !== srcs.length) throw new AppError(400, 'Each source column can be mapped to only one canonical field');
}

const FORMULA = /^[=+\-@\t\r]/;
const NUMLIKE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
/** CSV serialisation that neutralises spreadsheet-formula injection in text cells. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : String(v);
  if (typeof v === 'string' && FORMULA.test(s) && !NUMLIKE.test(s.trim())) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Rows keyed by canonical field; rowId matches the ML service's zero-based row_id. */
function canonicalRows(dataset, text) {
  const rows = parseCsvText(text ?? fs.readFileSync(fullPath(dataset.storagePath), 'utf8'));
  const m = dataset.mapping || {};
  const num = (r, f) => {
    if (!m[f]) return null;
    const v = r[m[f]];
    if (v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return rows.map((r, rowId) => {
    let t = null;
    if (m.timestamp && r[m.timestamp]) {
      const d = new Date(r[m.timestamp]);
      t = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const values = {};
    for (const v of VARIABLES) values[v] = num(r, v);
    return {
      rowId,
      timestamp: t,
      latitude: num(r, 'latitude'),
      longitude: num(r, 'longitude'),
      sensorId: m.sensor_id ? r[m.sensor_id] ?? null : null,
      values,
    };
  });
}

const validCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

module.exports = {
  CANONICAL, VARIABLES, fullPath, ensureUploadDir, sha256File, parseCsvText, inferColumns, suggestMapping,
  validateMapping, toCsv, canonicalRows, validCoord,
};
