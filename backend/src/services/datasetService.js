const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Dataset, DatasetVersion } = require('../models');
const csv = require('./csvService');
const audit = require('./audit');
const { AppError } = require('../middleware');

/**
 * Register a CSV that is already stored inside UPLOAD_DIR as `storedName`.
 * The stored file is the immutable original; nothing ever rewrites it.
 */
async function createFromStoredFile({ owner, storedName, originalFilename, name, description, mapping, isSynthetic = false, truthPath = null }) {
  const full = csv.fullPath(storedName);
  const text = fs.readFileSync(full, 'utf8');
  if (!text.trim()) throw new AppError(400, 'The file is empty');
  const rows = csv.parseCsvText(text);
  if (rows.length === 0) throw new AppError(400, 'The CSV has a header but no data rows');
  const header = Object.keys(rows[0]);
  const finalMapping = mapping && Object.keys(mapping).length ? mapping : csv.suggestMapping(header);
  csv.validateMapping(finalMapping, header);

  const sha = csv.sha256File(full);
  const dataset = await Dataset.create({
    owner,
    name,
    description: description || '',
    originalFilename,
    storagePath: storedName,
    sha256: sha,
    sizeBytes: fs.statSync(full).size,
    rowCount: rows.length,
    columns: csv.inferColumns(header, rows),
    mapping: finalMapping,
    isSynthetic,
    truthPath,
  });
  await DatasetVersion.create({
    dataset: dataset._id, owner, version: 1, kind: 'original', storagePath: storedName, sha256: sha,
    rowCount: rows.length, note: 'Original upload (immutable)',
  });
  await audit.log({
    dataset: dataset._id, datasetVersion: 1, user: owner, action: 'dataset_uploaded', observationState: 'original',
    details: { filename: originalFilename, rows: rows.length, sha256: sha, synthetic: isSynthetic },
  });
  return dataset;
}

function newStoredName(ext = '.csv') {
  return `${crypto.randomUUID()}${ext}`;
}

function removeFileQuiet(rel) {
  try {
    if (rel) fs.unlinkSync(csv.fullPath(rel));
  } catch {
    /* already gone */
  }
}

/** Copy the bundled synthetic demo files into UPLOAD_DIR and register them. */
async function createDemo(owner, config) {
  const obs = path.join(config.demoDataDir, 'marine_synthetic.csv');
  const truth = path.join(config.demoDataDir, 'marine_synthetic_truth.csv');
  if (!fs.existsSync(obs)) {
    throw new AppError(404, 'Synthetic demo data not found. Run: python scripts/generate_synthetic.py');
  }
  csv.ensureUploadDir();
  const stored = newStoredName();
  fs.copyFileSync(obs, csv.fullPath(stored));
  let truthStored = null;
  if (fs.existsSync(truth)) {
    truthStored = newStoredName();
    fs.copyFileSync(truth, csv.fullPath(truthStored));
  }
  try {
    return await createFromStoredFile({
      owner, storedName: stored, originalFilename: 'marine_synthetic.csv',
      name: 'SYNTHETIC demo - Arabian Sea buoys', description: 'Simulated data with injected defects and known ground truth. Not real measurements.',
      mapping: null, isSynthetic: true, truthPath: truthStored,
    });
  } catch (e) {
    removeFileQuiet(stored);
    removeFileQuiet(truthStored);
    throw e;
  }
}

module.exports = { createFromStoredFile, newStoredName, removeFileQuiet, createDemo };
