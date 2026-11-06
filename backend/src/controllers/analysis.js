const { AnalysisJob } = require('../models');
const config = require('../config/env');
const { AppError, asyncHandler } = require('../middleware');
const validators = require('../validators');
const runner = require('../services/jobRunner');
const { findOwned } = require('./datasets');

function buildParams(type, body, ds, user) {
  const prefs = user.preferences || {};
  const parsed = validators.analysis[type].safeParse(body || {});
  if (!parsed.success) throw parsed.error;
  const p = parsed.data;
  const needVar = ['reconstruct', 'evaluate'].includes(type);
  if (needVar) {
    if (!ds.mapping.timestamp) throw new AppError(400, 'Map a timestamp column first (dataset page > Column mapping).');
    if (!ds.mapping[p.variable]) throw new AppError(400, `Map a source column to '${p.variable}' first.`);
  }
  if (!Object.keys(ds.mapping || {}).length) throw new AppError(400, 'Map at least one column to the canonical schema first.');
  if (type === 'quality') return { outlier_z: prefs.outlierZ, ...p };
  if (type === 'anomalies') return { madZ: prefs.outlierZ, contamination: prefs.contamination, ...p };
  if (type === 'reconstruct') {
    return { method: prefs.method || 'mare', maxGap: prefs.maxGap || 24, minObsFraction: prefs.minObsFraction ?? 0.5, alpha: prefs.alpha || 0.1, ...p };
  }
  return { maxGap: prefs.maxGap || 24, alpha: prefs.alpha || 0.1, ...p };
}

const create = (type) =>
  asyncHandler(async (req, res) => {
    const ds = await findOwned({ params: { id: req.params.datasetId }, user: req.user });
    const active = await AnalysisJob.countDocuments({ owner: req.user._id, status: { $in: ['queued', 'running'] } });
    if (active >= config.maxActiveJobsPerUser) throw new AppError(429, `You already have ${active} analyses running. Wait for one to finish.`);
    const params = JSON.parse(JSON.stringify(buildParams(type, req.body, ds, req.user))); // drop undefined
    const job = await AnalysisJob.create({ owner: req.user._id, dataset: ds._id, datasetVersion: ds.currentVersion, type, params });
    runner.start(job._id);
    res.status(202).json({ job });
  });

exports.quality = create('quality');
exports.anomalies = create('anomalies');
exports.reconstruct = create('reconstruct');
exports.evaluate = create('evaluate');

exports.listJobs = asyncHandler(async (req, res) => {
  const q = { owner: req.user._id };
  if (req.query.datasetId) q.dataset = req.query.datasetId;
  if (['quality', 'anomalies', 'reconstruct', 'evaluate'].includes(req.query.type)) q.type = req.query.type;
  if (['queued', 'running', 'succeeded', 'failed'].includes(req.query.status)) q.status = req.query.status;
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const jobs = await AnalysisJob.find(q).sort({ createdAt: -1 }).limit(limit).populate('dataset', 'name isSynthetic').lean();
  res.json({ jobs });
});

exports.getJob = asyncHandler(async (req, res) => {
  const job = await AnalysisJob.findOne({ _id: req.params.id, owner: req.user._id }).populate('dataset', 'name isSynthetic mapping').lean();
  if (!job) throw new AppError(404, 'Job not found');
  res.json({ job });
});
