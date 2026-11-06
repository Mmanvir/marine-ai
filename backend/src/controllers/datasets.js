const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config/env');
const { Dataset, DatasetVersion, AnalysisJob, QualityIssue, ReconstructionRecord, ModelEvaluation } = require('../models');
const { AppError, asyncHandler } = require('../middleware');
const csv = require('../services/csvService');
const ml = require('../services/mlClient');
const audit = require('../services/audit');
const svc = require('../services/datasetService');
const { latestJobs } = require('../services/aggregates');

async function findOwned(req) {
  const ds = await Dataset.findOne({ _id: req.params.id, owner: req.user._id });
  if (!ds) throw new AppError(404, 'Dataset not found');
  return ds;
}
exports.findOwned = findOwned;

exports.upload = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'No file received. Send a CSV in the "file" field.');
  const stored = req.file.filename;
  try {
    let mapping = null;
    if (req.body.mapping) {
      try {
        mapping = JSON.parse(req.body.mapping);
      } catch {
        throw new AppError(400, 'mapping must be valid JSON');
      }
      const { mapping: schema } = require('../validators');
      const parsed = schema.safeParse(mapping);
      if (!parsed.success) throw new AppError(400, 'Invalid mapping', parsed.error.issues.map((i) => i.message));
      mapping = parsed.data;
    }
    const dataset = await svc.createFromStoredFile({
      owner: req.user._id, storedName: stored, originalFilename: path.basename(req.file.originalname).slice(0, 255),
      name: req.body.name || path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 120),
      description: req.body.description, mapping,
    });
    res.status(201).json({ dataset });
  } catch (e) {
    svc.removeFileQuiet(stored);
    throw e;
  }
});

exports.demo = asyncHandler(async (req, res) => {
  res.status(201).json({ dataset: await svc.createDemo(req.user._id, config) });
});

exports.list = asyncHandler(async (req, res) => {
  const datasets = await Dataset.find({ owner: req.user._id }).sort({ createdAt: -1 }).select('-profile').lean();
  const jobs = await latestJobs(req.user._id);
  const byDs = {};
  for (const j of jobs) (byDs[j.dataset] ||= {})[j.type] = { id: j._id, finishedAt: j.finishedAt, summary: j.type === 'quality' ? { qualityScore: j.summary?.quality_score, missingPct: j.summary?.missing_pct } : undefined };
  res.json({ datasets: datasets.map((d) => ({ ...d, latestJobs: byDs[d._id] || {} })) });
});

exports.get = asyncHandler(async (req, res) => {
  const ds = await findOwned(req);
  if (!ds.profile) {
    try {
      ds.profile = await ml.profile(fs.readFileSync(csv.fullPath(ds.storagePath), 'utf8'));
      await ds.save();
    } catch {
      /* ML service down: details page still works without summary statistics */
    }
  }
  const versions = await DatasetVersion.find({ dataset: ds._id }).sort({ version: 1 }).lean();
  res.json({ dataset: ds, versions });
});

exports.remove = asyncHandler(async (req, res) => {
  const ds = await findOwned(req);
  const versions = await DatasetVersion.find({ dataset: ds._id });
  for (const v of versions) svc.removeFileQuiet(v.storagePath);
  svc.removeFileQuiet(ds.truthPath);
  await Promise.all([
    DatasetVersion.deleteMany({ dataset: ds._id }), AnalysisJob.deleteMany({ dataset: ds._id }),
    QualityIssue.deleteMany({ dataset: ds._id }), ReconstructionRecord.deleteMany({ dataset: ds._id }),
    ModelEvaluation.deleteMany({ dataset: ds._id }),
  ]);
  await ds.deleteOne();
  // Audit entries are append-only and intentionally retained after deletion.
  await audit.log({ dataset: ds._id, user: req.user._id, action: 'dataset_deleted', details: { name: ds.name, sha256: ds.sha256 } });
  res.status(204).end();
});

exports.preview = asyncHandler(async (req, res) => {
  const ds = await findOwned(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const rows = csv.parseCsvText(fs.readFileSync(csv.fullPath(ds.storagePath), 'utf8'));
  const start = (page - 1) * limit;
  res.json({
    columns: ds.columns.map((c) => c.name), page, limit, total: rows.length,
    rows: rows.slice(start, start + limit).map((r, i) => ({ _rowId: start + i, ...r })),
  });
});

exports.download = asyncHandler(async (req, res) => {
  const ds = await findOwned(req);
  const version = parseInt(req.query.version, 10) || ds.currentVersion;
  const v = await DatasetVersion.findOne({ dataset: ds._id, version });
  if (!v) throw new AppError(404, 'Version not found');
  const base = path.basename(ds.originalFilename || 'dataset.csv', '.csv').replace(/[^\w.-]+/g, '_');
  res.download(csv.fullPath(v.storagePath), v.kind === 'processed' ? `${base}_processed_v${v.version}.csv` : `${base}.csv`);
});

exports.setMapping = asyncHandler(async (req, res) => {
  const ds = await findOwned(req);
  csv.validateMapping(req.body.mapping, ds.columns.map((c) => c.name));
  const before = ds.mapping;
  ds.mapping = req.body.mapping;
  ds.markModified('mapping');
  await ds.save();
  await audit.log({ dataset: ds._id, datasetVersion: ds.currentVersion, user: req.user._id, action: 'mapping_changed', details: { before, after: ds.mapping } });
  res.json({ dataset: ds });
});

/** Time series for charts: downsampled, missing values kept as null. */
exports.series = asyncHandler(async (req, res) => {
  const ds = await findOwned(req);
  const variable = String(req.query.variable || 'sea_surface_temperature');
  if (!csv.VARIABLES.includes(variable) || !ds.mapping[variable] || !ds.mapping.timestamp) {
    throw new AppError(400, `Map a timestamp column and '${variable}' to use this chart`);
  }
  const limit = Math.min(3000, parseInt(req.query.limit, 10) || 1500);
  let rows = csv.canonicalRows(ds).filter((r) => r.timestamp);
  const sensors = [...new Set(rows.map((r) => r.sensorId).filter(Boolean))].slice(0, 50);
  const sensor = req.query.sensor ? String(req.query.sensor) : sensors[0] || null;
  if (sensor) rows = rows.filter((r) => r.sensorId === sensor);
  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  // Rows flagged by a given job are always kept, so downsampling never hides them.
  const flagged = new Set();
  if (req.query.jobId && mongoose.isValidObjectId(req.query.jobId)) {
    const docs = await QualityIssue.find({ job: req.query.jobId, owner: req.user._id, column: variable, category: 'suspected_anomaly' }).select('rowId').lean();
    docs.forEach((d) => flagged.add(d.rowId));
  }
  // Rows reconstructed by a given job are kept too, so estimates are never dropped by downsampling.
  const recon = new Set();
  if (req.query.reconJobId && mongoose.isValidObjectId(req.query.reconJobId)) {
    const docs = await ReconstructionRecord.find({ job: req.query.reconJobId, owner: req.user._id, variable, status: 'reconstructed' }).select('rowId').lean();
    docs.forEach((d) => recon.add(d.rowId));
  }
  const step = Math.max(1, Math.ceil(rows.length / limit));
  const points = rows
    .filter((r, i) => i % step === 0 || flagged.has(r.rowId) || recon.has(r.rowId))
    .map((r) => ({ t: r.timestamp, v: r.values[variable], rowId: r.rowId, flagged: flagged.has(r.rowId) }));
  res.json({ variable, sensor, sensors, step, totalPoints: rows.length, isSynthetic: ds.isSynthetic, points });
});
