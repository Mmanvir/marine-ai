/**
 * In-process job runner. Jobs are persisted in MongoDB so status survives page
 * reloads, but execution is in this Node process (no external queue). Jobs that
 * were running when the server stopped are marked failed on next start.
 */
const fs = require('fs');
const crypto = require('crypto');
const { AnalysisJob, Dataset, DatasetVersion, QualityIssue, ReconstructionRecord, ModelEvaluation } = require('../models');
const csv = require('./csvService');
const ml = require('./mlClient');
const audit = require('./audit');
const { AppError } = require('../middleware');

const MAX_STORED_ISSUES = 100000;
const TRUTH_COLUMN_FOR = { sea_surface_temperature: 'truth_sst', salinity: 'truth_salinity' };

async function setJob(job, patch) {
  Object.assign(job, patch);
  await job.save();
}

const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

async function runQuality(job, dataset, text) {
  await setJob(job, { progress: 15, stage: 'Running data quality checks' });
  const res = await ml.quality({ csv: text, mapping: dataset.mapping, config: job.params });
  await setJob(job, { progress: 60, stage: 'Storing quality issues' });
  const rows = csv.canonicalRows(dataset, text);
  const issues = res.issues.slice(0, MAX_STORED_ISSUES);
  const docs = issues.map((i) => {
    const r = i.row_id != null ? rows[i.row_id] : null;
    return {
      job: job._id, dataset: dataset._id, owner: job.owner, rowId: i.row_id, column: i.column, category: i.category,
      severity: i.severity, explanation: i.explanation, method: i.method, detectedBy: [i.method],
      recommendedAction: i.recommended_action,
      latitude: r && csv.validCoord(r.latitude, r.longitude) ? r.latitude : null,
      longitude: r && csv.validCoord(r.latitude, r.longitude) ? r.longitude : null,
    };
  });
  await audit.insertChunked(QualityIssue, docs);
  await audit.logMany(docs.map((d) => ({
    dataset: dataset._id, datasetVersion: job.datasetVersion, job: job._id, user: job.owner, action: 'issue_detected',
    observationState: d.category === 'missing_value' ? 'original' : 'flagged', rowId: d.rowId, column: d.column,
    issueCategory: d.category, method: d.method, algorithmVersion: res.algorithm_version, details: { severity: d.severity },
  })));
  return { ...res.summary, issuesStored: docs.length, issuesTruncated: res.issues.length > docs.length, algorithmVersion: res.algorithm_version };
}

async function runAnomalies(job, dataset, text) {
  await setJob(job, { progress: 15, stage: 'Running MAD and Isolation Forest' });
  const p = job.params || {};
  const res = await ml.anomalies({
    csv: text, mapping: dataset.mapping, columns: p.columns,
    mad: { z_threshold: p.madZ, window: p.window },
    iforest: { contamination: p.contamination, n_estimators: p.nEstimators, window: p.window },
  });
  await setJob(job, { progress: 60, stage: 'Storing flagged observations' });
  const rows = csv.canonicalRows(dataset, text);
  const docs = [];
  const perColumn = {};
  for (const [col, c] of Object.entries(res.columns)) {
    perColumn[col] = { mad: { nFlagged: c.mad.n_flagged }, isolationForest: { nFlagged: c.isolation_forest.n_flagged }, agreement: c.agreement };
    for (const f of c.flagged) {
      const r = rows[f.row_id];
      const both = f.methods.length === 2;
      docs.push({
        job: job._id, dataset: dataset._id, owner: job.owner, rowId: f.row_id, column: col, category: 'suspected_anomaly',
        severity: both ? 'high' : 'medium',
        explanation: `Flagged by ${f.methods.map((m) => (m === 'mad' ? 'robust MAD' : 'Isolation Forest')).join(' and ')}. ` +
          'Statistically unusual relative to neighbouring observations; NOT confirmed as an error.',
        method: f.methods.join('+'), detectedBy: f.methods, scores: { mad: f.mad_score, isolationForest: f.isolation_forest_score },
        recommendedAction: both ? 'Both detectors agree: review against sensor metadata first.' : 'Single-detector flag: lower confidence, review if impactful.',
        latitude: r && csv.validCoord(r.latitude, r.longitude) ? r.latitude : null,
        longitude: r && csv.validCoord(r.latitude, r.longitude) ? r.longitude : null,
      });
    }
  }
  await audit.insertChunked(QualityIssue, docs);
  await audit.logMany(docs.map((d) => ({
    dataset: dataset._id, datasetVersion: job.datasetVersion, job: job._id, user: job.owner, action: 'anomaly_flagged',
    observationState: 'flagged', rowId: d.rowId, column: d.column, issueCategory: d.category, method: d.method,
    algorithmVersion: res.algorithm_version, details: { severity: d.severity, scores: d.scores },
  })));
  return { columns: perColumn, suspectedCount: docs.length, params: p, algorithmVersion: res.algorithm_version, note: res.note };
}

async function runReconstruct(job, dataset, text) {
  const p = job.params;
  await setJob(job, { progress: 10, stage: `Reconstructing ${p.variable} (${p.method})` });
  const res = await ml.reconstruct({
    csv: text, mapping: dataset.mapping, variable: p.variable, method: p.method, max_gap: p.maxGap,
    min_obs_fraction: p.minObsFraction, max_relative_halfwidth: p.maxRelativeHalfwidth, alpha: p.alpha, seed: p.seed || 0,
  });
  await setJob(job, { progress: 65, stage: 'Storing reconstruction records and audit trail' });
  const docs = res.records.map((r) => ({
    job: job._id, dataset: dataset._id, owner: job.owner, rowId: r.row_id, sensorId: r.sensor_id, variable: r.variable,
    timestamp: r.timestamp ? new Date(r.timestamp) : null, latitude: r.latitude, longitude: r.longitude,
    originalValue: null, reconstructedValue: r.reconstructed_value, method: r.method, status: r.status,
    statusReason: r.status_reason, algorithmVersion: r.algorithm_version, evidence: r.evidence, uncertainty: r.uncertainty,
    limitations: r.limitations,
  }));
  await audit.insertChunked(ReconstructionRecord, docs, 500);
  await audit.logMany(docs.filter((d) => d.status !== 'skipped').map((d) => ({
    dataset: dataset._id, datasetVersion: job.datasetVersion, job: job._id, user: job.owner,
    action: d.status === 'reconstructed' ? 'value_reconstructed' : 'reconstruction_abstained',
    observationState: d.status === 'reconstructed' ? 'reconstructed' : 'original', rowId: d.rowId, column: d.variable,
    method: d.method, originalValue: null, newValue: d.reconstructedValue, uncertainty: d.uncertainty,
    algorithmVersion: d.algorithmVersion, details: { reason: d.statusReason },
  })));

  // Processed dataset = new version; the original file is untouched.
  await setJob(job, { progress: 85, stage: 'Writing processed dataset version' });
  csv.ensureUploadDir();
  const stored = `${crypto.randomUUID()}.csv`;
  fs.writeFileSync(csv.fullPath(stored), res.processed_csv, 'utf8');
  const last = await DatasetVersion.findOne({ dataset: dataset._id }).sort({ version: -1 });
  const version = (last ? last.version : 1) + 1;
  await DatasetVersion.create({
    dataset: dataset._id, owner: job.owner, version, kind: 'processed', parentVersion: job.datasetVersion, job: job._id,
    storagePath: stored, sha256: csv.sha256File(csv.fullPath(stored)), rowCount: dataset.rowCount,
    note: `Reconstruction of ${p.variable} (${p.method}); estimates in separate columns`,
  });
  const { excluded_rows: excluded, ...rest } = res.summary;
  return {
    ...rest, variable: p.variable, processedVersion: version, excludedRowCount: excluded.length, excludedRowsSample: excluded.slice(0, 50),
    algorithmVersion: res.algorithm_version,
  };
}

async function runEvaluate(job, dataset, text) {
  const p = job.params;
  await setJob(job, { progress: 10, stage: 'Running benchmark (this can take a minute)' });
  let truthCsv = null;
  if (p.useTruth && dataset.truthPath && TRUTH_COLUMN_FOR[p.variable]) {
    truthCsv = fs.readFileSync(csv.fullPath(dataset.truthPath), 'utf8');
  }
  const res = await ml.evaluate({
    csv: text, mapping: dataset.mapping, variable: p.variable, n_repeats: p.nRepeats, seed: p.seed, max_gap: p.maxGap,
    alpha: p.alpha, truth_csv: truthCsv,
  });
  if (res.status !== 'ok') throw new AppError(422, res.message || 'Evaluation could not run on this dataset');
  await setJob(job, { progress: 85, stage: 'Storing benchmark results' });
  await ModelEvaluation.create({
    job: job._id, dataset: dataset._id, owner: job.owner, variable: p.variable, status: res.status,
    referenceSource: res.reference_source, summaryTable: res.summary_table, verdict: res.verdict, results: res,
    algorithmVersion: res.algorithm_version,
  });
  const byMethod = {};
  for (const r of res.summary_table) (byMethod[r.method] ||= []).push(r);
  const methodPerformance = Object.entries(byMethod).map(([method, rs]) => ({
    method, mae: mean(rs.map((r) => r.mae)), rmse: mean(rs.map((r) => r.rmse)),
    piCoverage: mean(rs.map((r) => r.pi_coverage)), piWidth: mean(rs.map((r) => r.pi_width)),
  }));
  const mare = methodPerformance.find((m) => m.method === 'mare');
  const ad = res.anomaly_detection;
  return {
    variable: p.variable, referenceSource: res.reference_source, config: res.config, verdict: res.verdict, methodPerformance,
    mareMae: mare ? mare.mae : null, mareRmse: mare ? mare.rmse : null,
    anomalyDetection: ad ? { mad: ad.mad.metrics, isolationForest: ad.isolation_forest.metrics } : null,
    algorithmVersion: res.algorithm_version,
  };
}

const RUNNERS = { quality: runQuality, anomalies: runAnomalies, reconstruct: runReconstruct, evaluate: runEvaluate };

async function execute(jobId) {
  const job = await AnalysisJob.findById(jobId);
  if (!job) return;
  try {
    const dataset = await Dataset.findById(job.dataset);
    if (!dataset) throw new AppError(404, 'Dataset no longer exists');
    await setJob(job, { status: 'running', startedAt: new Date(), progress: 5, stage: 'Reading dataset' });
    await audit.log({ dataset: dataset._id, datasetVersion: job.datasetVersion, job: job._id, user: job.owner, action: `${job.type}_started`, details: { params: job.params } });
    const text = fs.readFileSync(csv.fullPath(dataset.storagePath), 'utf8');
    const summary = await RUNNERS[job.type](job, dataset, text);
    await setJob(job, { status: 'succeeded', progress: 100, stage: 'Done', summary, finishedAt: new Date(), algorithmVersion: summary.algorithmVersion });
    await audit.log({ dataset: dataset._id, datasetVersion: job.datasetVersion, job: job._id, user: job.owner, action: `${job.type}_finished`, algorithmVersion: summary.algorithmVersion });
  } catch (e) {
    const safe = e instanceof AppError ? e.message : 'Unexpected error while running the analysis';
    if (!(e instanceof AppError)) console.error('[job] failed', job._id.toString(), e.stack || e);
    try {
      await setJob(job, { status: 'failed', error: safe, stage: 'Failed', finishedAt: new Date() });
      await audit.log({ dataset: job.dataset, datasetVersion: job.datasetVersion, job: job._id, user: job.owner, action: `${job.type}_failed`, details: { error: safe } });
    } catch (e2) {
      console.error('[job] could not record failure', e2.message);
    }
  }
}

/** Fire-and-forget: returns immediately; progress is polled via the jobs API. */
function start(jobId) {
  setImmediate(() => execute(jobId));
}

async function failStaleJobs() {
  await AnalysisJob.updateMany(
    { status: { $in: ['queued', 'running'] } },
    { $set: { status: 'failed', error: 'Server restarted before the job finished', stage: 'Failed', finishedAt: new Date() } }
  );
}

module.exports = { start, execute, failStaleJobs };
