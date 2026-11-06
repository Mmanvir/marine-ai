const mongoose = require('mongoose');
const { Dataset, AnalysisJob, QualityIssue, ReconstructionRecord, AuditLog, User } = require('../models');
const { AppError, asyncHandler } = require('../middleware');
const csv = require('../services/csvService');
const ml = require('../services/mlClient');
const { latestJobs } = require('../services/aggregates');

const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

// ---------------------------------------------------------------- health
exports.health = (_req, res) => res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down', uptimeSeconds: Math.round(process.uptime()) });
exports.healthMl = async (_req, res) => {
  try {
    res.json({ status: 'ok', ml: await ml.ping() });
  } catch {
    res.status(503).json({ status: 'down', error: { message: 'ML service unreachable' } });
  }
};

// ---------------------------------------------------------------- dashboard
exports.dashboard = asyncHandler(async (req, res) => {
  const owner = req.user._id;
  const [datasets, latest, recentJobs] = await Promise.all([
    Dataset.find({ owner }).select('name rowCount isSynthetic').lean(),
    latestJobs(owner),
    AnalysisJob.find({ owner }).sort({ createdAt: -1 }).limit(8).populate('dataset', 'name isSynthetic').lean(),
  ]);
  const nameOf = Object.fromEntries(datasets.map((d) => [d._id.toString(), d]));
  const of = (type) => latest.filter((j) => j.type === type);
  const q = of('quality'), an = of('anomalies'), rc = of('reconstruct'), ev = of('evaluate');

  const cells = sum(q.map((j) => j.summary?.n_variable_cells));
  const missing = sum(q.map((j) => j.summary?.missing_count));
  const suspicious = sum(datasets.map((d) => {
    const a = an.find((j) => j.dataset.toString() === d._id.toString());
    if (a) return a.summary?.suspectedCount;
    const qq = q.find((j) => j.dataset.toString() === d._id.toString());
    return qq?.summary?.issues_by_category?.suspected_anomaly;
  }));

  const issueJobIds = [...q, ...an].map((j) => j._id);
  const dist = issueJobIds.length
    ? await QualityIssue.aggregate([{ $match: { job: { $in: issueJobIds }, category: { $ne: 'missing_value' } } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
    : [];

  const byMethod = {};
  for (const j of ev) for (const m of j.summary?.methodPerformance || []) (byMethod[m.method] ||= []).push(m);

  const alerts = [];
  for (const j of recentJobs.filter((x) => x.status === 'failed').slice(0, 3)) {
    alerts.push({ level: 'error', message: `${j.type} analysis failed on "${j.dataset?.name}": ${j.error}`, at: j.finishedAt || j.updatedAt, jobId: j._id });
  }
  for (const j of q) {
    const s = j.summary || {};
    if (s.quality_score < 70) alerts.push({ level: 'warning', message: `Quality score ${s.quality_score} for "${nameOf[j.dataset]?.name}" is below 70`, at: j.finishedAt, jobId: j._id });
    if (s.issues_by_severity?.high > 0) alerts.push({ level: 'info', message: `${s.issues_by_severity.high} high-severity issues in "${nameOf[j.dataset]?.name}"`, at: j.finishedAt, jobId: j._id });
  }
  for (const j of rc) {
    const ab = j.summary?.by_status?.abstained;
    if (ab) alerts.push({ level: 'info', message: `MARE abstained on ${ab} values in "${nameOf[j.dataset]?.name}" (insufficient evidence or uncertainty too high)`, at: j.finishedAt, jobId: j._id });
  }

  res.json({
    note: 'Alerts are derived from your analysis results, not from live ocean monitoring.',
    metrics: {
      totalDatasets: datasets.length,
      totalObservations: sum(datasets.map((d) => d.rowCount)),
      missingPct: cells ? (missing / cells) * 100 : null,
      suspiciousCount: q.length || an.length ? suspicious : null,
      reconstructedCount: rc.length ? sum(rc.map((j) => j.summary?.by_status?.reconstructed)) : null,
      qualityScore: q.length ? mean(q.map((j) => j.summary?.quality_score)) : null,
      avgReconstructionError: ev.length ? mean(ev.map((j) => j.summary?.mareMae)) : null,
      avgReconstructionErrorNote: 'Mean absolute error of MARE across evaluated experiments',
      syntheticDatasets: datasets.filter((d) => d.isSynthetic).length,
    },
    charts: {
      qualityByDataset: q.map((j) => ({ name: nameOf[j.dataset]?.name, score: j.summary?.quality_score, synthetic: !!nameOf[j.dataset]?.isSynthetic })),
      missingness: rc.map((j) => {
        const before = j.summary?.n_missing_considered ?? 0;
        return { name: nameOf[j.dataset]?.name, before, after: before - (j.summary?.by_status?.reconstructed ?? 0) };
      }),
      anomalyDistribution: dist.map((d) => ({ category: d._id, count: d.count })),
      algorithmPerformance: Object.entries(byMethod).map(([method, ms]) => ({ method, mae: mean(ms.map((m) => m.mae)), rmse: mean(ms.map((m) => m.rmse)) })),
    },
    recentJobs, alerts: alerts.slice(0, 10),
  });
});

// ---------------------------------------------------------------- map
exports.mapPoints = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.datasetId)) throw new AppError(400, 'datasetId is required');
  const ds = await Dataset.findOne({ _id: req.query.datasetId, owner: req.user._id });
  if (!ds) throw new AppError(404, 'Dataset not found');
  if (!ds.mapping.latitude || !ds.mapping.longitude) throw new AppError(400, 'Map latitude and longitude columns to use the map');
  const variable = csv.VARIABLES.includes(req.query.variable) ? req.query.variable : null;
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  const status = ['all', 'ok', 'flagged', 'reconstructed'].includes(req.query.status) ? req.query.status : 'all';

  const jobs = await latestJobs(req.user._id, ds._id);
  const issueJobs = jobs.filter((j) => ['quality', 'anomalies'].includes(j.type)).map((j) => j._id);
  const flaggedDocs = issueJobs.length
    ? await QualityIssue.find({ job: { $in: issueJobs }, category: { $ne: 'missing_value' }, ...(variable ? { column: { $in: [variable, null, 'timestamp'] } } : {}) }).select('rowId category').lean()
    : [];
  const flagged = new Map();
  for (const f of flaggedDocs) if (f.rowId != null) (flagged.get(f.rowId) || flagged.set(f.rowId, new Set()).get(f.rowId)).add(f.category);
  const rcJob = jobs.find((j) => j.type === 'reconstruct');
  const recs = rcJob ? await ReconstructionRecord.find({ job: rcJob._id, status: 'reconstructed', latitude: { $ne: null } }).select('rowId latitude longitude timestamp reconstructedValue method variable uncertainty').lean() : [];

  const inRange = (t) => (!from || (t && new Date(t) >= from)) && (!to || (t && new Date(t) <= to));
  let pts = csv.canonicalRows(ds).filter((r) => csv.validCoord(r.latitude, r.longitude) && inRange(r.timestamp));
  pts = pts.map((r) => ({
    rowId: r.rowId, lat: r.latitude, lon: r.longitude, t: r.timestamp, sensor: r.sensorId, value: variable ? r.values[variable] : null,
    state: flagged.has(r.rowId) ? 'flagged' : 'ok', categories: flagged.has(r.rowId) ? [...flagged.get(r.rowId)] : [],
  }));
  if (status === 'ok') pts = pts.filter((p) => p.state === 'ok');
  if (status === 'flagged') pts = pts.filter((p) => p.state === 'flagged');
  if (status === 'reconstructed') pts = [];
  const MAX = 3000;
  const flaggedPts = pts.filter((p) => p.state === 'flagged').slice(0, MAX);
  const okPts = pts.filter((p) => p.state === 'ok');
  const step = Math.max(1, Math.ceil(okPts.length / (MAX - flaggedPts.length || 1)));
  const shown = [...okPts.filter((_, i) => i % step === 0), ...flaggedPts];
  const reconstructed = status === 'all' || status === 'reconstructed'
    ? recs.filter((r) => csv.validCoord(r.latitude, r.longitude) && inRange(r.timestamp) && (!variable || r.variable === variable))
      .slice(0, 2000).map((r) => ({ rowId: r.rowId, lat: r.latitude, lon: r.longitude, t: r.timestamp, value: r.reconstructedValue, method: r.method, variable: r.variable, interval: r.uncertainty?.interval || null }))
    : [];
  res.json({
    dataset: { id: ds._id, name: ds.name, isSynthetic: ds.isSynthetic }, points: shown, reconstructed,
    totals: { withValidCoordinates: pts.length, shown: shown.length, flagged: flaggedPts.length, reconstructed: reconstructed.length },
    sampled: step > 1,
  });
});

// ---------------------------------------------------------------- audit
exports.audit = asyncHandler(async (req, res) => {
  const ds = await Dataset.findOne({ _id: req.params.datasetId, owner: req.user._id });
  if (!ds) throw new AppError(404, 'Dataset not found');
  const q = { dataset: ds._id };
  for (const k of ['action', 'observationState']) if (req.query[k]) q[k] = String(req.query[k]);
  if (req.query.rowId !== undefined && req.query.rowId !== '') q.rowId = parseInt(req.query.rowId, 10);
  if (req.query.jobId && mongoose.isValidObjectId(req.query.jobId)) q.job = req.query.jobId;
  if (req.query.format === 'csv') {
    const rows = await AuditLog.find(q).sort({ createdAt: -1 }).limit(200000).populate('user', 'email').lean();
    const cols = ['timestamp', 'user', 'action', 'observation_state', 'dataset_version', 'job_id', 'row_id', 'column', 'issue_category', 'method', 'original_value', 'new_value', 'uncertainty', 'algorithm_version'];
    return res.type('text/csv').attachment(`audit_${ds._id}.csv`).send(csv.toCsv(rows.map((r) => ({
      timestamp: r.createdAt.toISOString(), user: r.user?.email, action: r.action, observation_state: r.observationState, dataset_version: r.datasetVersion,
      job_id: r.job, row_id: r.rowId, column: r.column, issue_category: r.issueCategory, method: r.method, original_value: r.originalValue,
      new_value: r.newValue, uncertainty: r.uncertainty ? JSON.stringify(r.uncertainty) : '', algorithm_version: r.algorithmVersion,
    })), cols));
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const [entries, total] = await Promise.all([
    AuditLog.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name email').lean(), AuditLog.countDocuments(q),
  ]);
  res.json({ entries, total, page, limit });
});

// ---------------------------------------------------------------- admin
exports.adminStats = asyncHandler(async (_req, res) => {
  const [users, datasets, jobsByStatus, failed, byRole, obs] = await Promise.all([
    User.countDocuments(), Dataset.countDocuments(),
    AnalysisJob.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    AnalysisJob.find({ status: 'failed' }).sort({ createdAt: -1 }).limit(10).populate('owner', 'email').populate('dataset', 'name').lean(),
    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
    Dataset.aggregate([{ $group: { _id: null, rows: { $sum: '$rowCount' }, bytes: { $sum: '$sizeBytes' } } }]),
  ]);
  const ml_ = await ml.ping().then((d) => ({ status: 'up', ...d })).catch(() => ({ status: 'down' }));
  res.json({
    users, datasets, totalRows: obs[0]?.rows || 0, storageBytes: obs[0]?.bytes || 0,
    jobsByStatus: Object.fromEntries(jobsByStatus.map((j) => [j._id, j.n])), usersByRole: Object.fromEntries(byRole.map((r) => [r._id, r.n])),
    recentFailures: failed, services: { database: mongoose.connection.readyState === 1 ? 'up' : 'down', ml: ml_ },
  });
});

exports.adminUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).limit(500);
  const counts = await Dataset.aggregate([{ $group: { _id: '$owner', n: { $sum: 1 } } }]);
  const c = Object.fromEntries(counts.map((x) => [x._id.toString(), x.n]));
  res.json({ users: users.map((u) => ({ ...u.toJSON(), datasetCount: c[u._id.toString()] || 0 })) });
});

exports.adminUpdateUser = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw new AppError(404, 'User not found');
  if (u._id.equals(req.user._id)) throw new AppError(400, 'You cannot change your own role or active status');
  if (req.body.role) u.role = req.body.role;
  if (req.body.isActive !== undefined) u.isActive = req.body.isActive;
  await u.save();
  res.json({ user: u });
});
