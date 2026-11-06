/**
 * Seed demo accounts and the SYNTHETIC demo dataset.
 *   node src/scripts/seed.js                 create (idempotent)
 *   node src/scripts/seed.js --reset         delete demo accounts' data first
 *   node src/scripts/seed.js --reset --analyze   also run the analyses (needs ML service up)
 * Passwords come from env (SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD); nothing is hardcoded.
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const m = require('../models');
const svc = require('../services/datasetService');
const runner = require('../services/jobRunner');

const args = new Set(process.argv.slice(2));
const env = process.env;

async function ensureUser({ email, password, name, role }) {
  if (!password || password.startsWith('CHANGE_ME')) {
    throw new Error(`Set a real password for ${email} in .env (run: node scripts/setup-env.js)`);
  }
  let u = await m.User.findOne({ email });
  if (!u) u = await m.User.create({ email, name, role, passwordHash: await bcrypt.hash(password, 12) });
  return u;
}

async function wipe(userId) {
  const datasets = await m.Dataset.find({ owner: userId });
  for (const d of datasets) {
    for (const v of await m.DatasetVersion.find({ dataset: d._id })) svc.removeFileQuiet(v.storagePath);
    svc.removeFileQuiet(d.truthPath);
    await Promise.all([
      m.DatasetVersion.deleteMany({ dataset: d._id }), m.AnalysisJob.deleteMany({ dataset: d._id }), m.QualityIssue.deleteMany({ dataset: d._id }),
      m.ReconstructionRecord.deleteMany({ dataset: d._id }), m.ModelEvaluation.deleteMany({ dataset: d._id }),
      m.AuditLog.deleteMany({ dataset: d._id }, { allowAuditPurge: true }),
    ]);
    await d.deleteOne();
  }
}

async function main() {
  await connectDb();
  const admin = await ensureUser({ email: env.SEED_ADMIN_EMAIL || 'admin@marinetrace.local', password: env.SEED_ADMIN_PASSWORD, name: 'Demo Administrator', role: 'admin' });
  const demo = await ensureUser({ email: env.SEED_DEMO_EMAIL || 'researcher@marinetrace.local', password: env.SEED_DEMO_PASSWORD, name: 'Demo Researcher', role: 'researcher' });
  if (args.has('--reset')) await wipe(demo._id);

  let ds = await m.Dataset.findOne({ owner: demo._id, isSynthetic: true });
  if (!ds) ds = await svc.createDemo(demo._id, config);
  console.log(`Accounts ready: ${admin.email} (admin), ${demo.email} (researcher). Demo dataset: "${ds.name}" (SYNTHETIC).`);

  if (args.has('--analyze')) {
    const plan = [
      ['quality', {}], ['anomalies', {}],
      ['reconstruct', { variable: 'sea_surface_temperature', method: 'mare', maxGap: 24, minObsFraction: 0.5, alpha: 0.1 }],
      ['evaluate', { variable: 'sea_surface_temperature', nRepeats: 2, seed: 7, maxGap: 24, alpha: 0.1, useTruth: true }],
    ];
    for (const [type, params] of plan) {
      const job = await m.AnalysisJob.create({ owner: demo._id, dataset: ds._id, datasetVersion: ds.currentVersion, type, params });
      process.stdout.write(`Running ${type}... `);
      await runner.execute(job._id);
      const done = await m.AnalysisJob.findById(job._id);
      console.log(done.status === 'succeeded' ? 'ok' : `FAILED: ${done.error}`);
    }
  }
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('Seed failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
