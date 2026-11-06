const fs = require('fs');
const { AnalysisJob, QualityIssue, ReconstructionRecord, ModelEvaluation, DatasetVersion, Dataset } = require('../models');
const { AppError, asyncHandler } = require('../middleware');
const csv = require('../services/csvService');
const audit = require('../services/audit');

async function ownedJob(req, types) {
  const job = await AnalysisJob.findOne({ _id: req.params.jobId, owner: req.user._id }).populate('dataset', 'name isSynthetic');
  if (!job) throw new AppError(404, 'Job not found');
  if (types && !types.includes(job.type)) throw new AppError(400, `This report is not available for '${job.type}' jobs`);
  return job;
}

function sendCsv(res, name, rows, columns) {
  res.type('text/csv').attachment(name).send(csv.toCsv(rows, columns));
}

const pageOf = (req, dflt = 100, max = 5000) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(req.query.limit, 10) || dflt));
  return { page, limit, skip: (page - 1) * limit };
};

exports.quality = asyncHandler(async (req, res) => {
  const job = await ownedJob(req, ['quality', 'anomalies']);
  const q = { job: job._id };
  for (const k of ['severity', 'category', 'column', 'reviewStatus']) if (req.query[k]) q[k] = String(req.query[k]);
  if (req.query.format === 'csv') {
    const issues = await QualityIssue.find(q).sort({ rowId: 1 }).limit(200000).lean();
    return sendCsv(res, `quality_issues_${job._id}.csv`, issues.map((i) => ({
      row_id: i.rowId, column: i.column, category: i.category, severity: i.severity, explanation: i.explanation,
      detection_method: i.method, recommended_action: i.recommendedAction, review_status: i.reviewStatus,
    })), ['row_id', 'column', 'category', 'severity', 'explanation', 'detection_method', 'recommended_action', 'review_status']);
  }
  const { page, limit, skip } = pageOf(req);
  const [issues, total] = await Promise.all([
    QualityIssue.find(q).sort({ severity: 1, rowId: 1 }).skip(skip).limit(limit).lean(), QualityIssue.countDocuments(q),
  ]);
  res.json({ job, issues, total, page, limit });
});

exports.datasetSummary = asyncHandler(async (req, res) => {
  const ds = await Dataset.findOne({ _id: req.params.datasetId, owner: req.user._id });
  if (!ds) throw new AppError(404, 'Dataset not found');
  const job = await AnalysisJob.findOne({ dataset: ds._id, type: 'quality', status: 'succeeded' }).sort({ createdAt: -1 });
  if (!job) throw new AppError(404, 'Run a data quality assessment first');
  const s = job.summary;
  const rows = [
    { metric: 'dataset', value: ds.name }, { metric: 'synthetic', value: ds.isSynthetic }, { metric: 'job_id', value: job._id.toString() },
    { metric: 'rows', value: s.n_rows }, { metric: 'missing_count', value: s.missing_count }, { metric: 'missing_pct', value: s.missing_pct },
    { metric: 'flagged_rows', value: s.flagged_rows }, { metric: 'quality_score', value: s.quality_score },
    { metric: 'quality_score_definition', value: s.quality_score_definition },
    ...Object.entries(s.issues_by_category || {}).map(([k, v]) => ({ metric: `issues_${k}`, value: v })),
  ];
  if (req.query.format === 'csv') return sendCsv(res, `dataset_quality_summary_${ds._id}.csv`, rows, ['metric', 'value']);
  res.json({ dataset: ds.name, job: job._id, summary: s });
});

exports.reconstruction = asyncHandler(async (req, res) => {
  const job = await ownedJob(req, ['reconstruct']);
  const q = { job: job._id };
  if (req.query.status) q.status = String(req.query.status);
  if (req.query.method) q.method = String(req.query.method);
  if (req.query.format === 'csv') {
    const recs = await ReconstructionRecord.find(q).sort({ rowId: 1 }).limit(200000).lean();
    const cols = ['row_id', 'sensor_id', 'variable', 'timestamp', 'latitude', 'longitude', 'original_value', 'reconstructed_value', 'method',
      'status', 'status_reason', 'interval_low', 'interval_high', 'interval_nominal_level', 'interval_calibrated', 'uncertainty_note',
      'algorithm_version', 'review_status'];
    return sendCsv(res, `reconstruction_${job._id}.csv`, recs.map((r) => ({
      row_id: r.rowId, sensor_id: r.sensorId, variable: r.variable, timestamp: r.timestamp ? r.timestamp.toISOString() : '',
      latitude: r.latitude, longitude: r.longitude, original_value: r.originalValue, reconstructed_value: r.reconstructedValue,
      method: r.method, status: r.status, status_reason: r.statusReason,
      interval_low: r.uncertainty?.interval?.low, interval_high: r.uncertainty?.interval?.high,
      interval_nominal_level: r.uncertainty?.interval?.nominal_level, interval_calibrated: r.uncertainty?.interval ? 'false' : '',
      uncertainty_note: r.uncertainty?.available ? 'empirical holdout interval; not calibrated' : `unavailable: ${r.uncertainty?.reason || ''}`,
      algorithm_version: r.algorithmVersion, review_status: r.reviewStatus,
    })), cols);
  }
  const { page, limit, skip } = pageOf(req);
  const [records, total, counts] = await Promise.all([
    ReconstructionRecord.find(q).sort({ rowId: 1 }).skip(skip).limit(limit).lean(), ReconstructionRecord.countDocuments(q),
    ReconstructionRecord.aggregate([{ $match: { job: job._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.json({ job, records, total, page, limit, statusCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
});

/** Download the processed dataset version produced by a reconstruction job. */
exports.processed = asyncHandler(async (req, res) => {
  const job = await ownedJob(req, ['reconstruct']);
  const v = await DatasetVersion.findOne({ dataset: job.dataset._id, job: job._id });
  if (!v) throw new AppError(404, 'No processed dataset for this job');
  res.download(csv.fullPath(v.storagePath), `processed_v${v.version}_${job._id}.csv`);
});

exports.benchmark = asyncHandler(async (req, res) => {
  const job = await ownedJob(req, ['evaluate']);
  const ev = await ModelEvaluation.findOne({ job: job._id }).lean();
  if (!ev) throw new AppError(404, 'No evaluation results for this job (it may have failed)');
  if (req.query.format === 'csv') {
    const cols = ['scenario', 'method', 'pct_reconstructed', 'mae', 'rmse', 'bias', 'common_rmse', 'pi_coverage', 'pi_width', 'runtime_s'];
    return sendCsv(res, `benchmark_${job._id}.csv`, ev.summaryTable, cols);
  }
  res.json({ job, evaluation: ev });
});

exports.reviewIssue = asyncHandler(async (req, res) => {
  const issue = await QualityIssue.findOne({ _id: req.params.id, owner: req.user._id });
  if (!issue) throw new AppError(404, 'Issue not found');
  const before = issue.reviewStatus;
  issue.reviewStatus = req.body.decision;
  await issue.save();
  const job = await AnalysisJob.findById(issue.job).select('datasetVersion');
  await audit.log({
    dataset: issue.dataset, datasetVersion: job?.datasetVersion, job: issue.job, user: req.user._id, action: 'issue_reviewed',
    observationState: 'manually_reviewed', rowId: issue.rowId, column: issue.column, issueCategory: issue.category,
    details: { before, after: issue.reviewStatus },
  });
  res.json({ issue });
});

exports.reviewRecord = asyncHandler(async (req, res) => {
  const rec = await ReconstructionRecord.findOne({ _id: req.params.id, owner: req.user._id });
  if (!rec) throw new AppError(404, 'Record not found');
  const before = rec.reviewStatus;
  rec.reviewStatus = req.body.decision;
  await rec.save();
  const job = await AnalysisJob.findById(rec.job).select('datasetVersion');
  await audit.log({
    dataset: rec.dataset, datasetVersion: job?.datasetVersion, job: rec.job, user: req.user._id, action: 'reconstruction_reviewed',
    observationState: 'manually_reviewed', rowId: rec.rowId, column: rec.variable, method: rec.method, newValue: rec.reconstructedValue,
    details: { before, after: rec.reviewStatus },
  });
  res.json({ record: rec });
});
