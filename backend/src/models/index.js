/**
 * Mongoose models. Large artefacts (uploaded CSVs, processed CSVs) live on disk
 * (UPLOAD_DIR) and are referenced by relative filename; per-row results live in
 * their own collections, so no single document grows with dataset size.
 * Relationships: User 1-n Dataset 1-n DatasetVersion; Dataset 1-n AnalysisJob;
 * AnalysisJob 1-n QualityIssue | ReconstructionRecord | 1-1 ModelEvaluation;
 * AuditLog references dataset, job and user.
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['researcher', 'admin'], default: 'researcher', index: true },
    isActive: { type: Boolean, default: true },
    institution: { type: String, trim: true, maxlength: 120, default: '' },
    preferences: {
      maxGap: { type: Number, default: 24, min: 1, max: 500 },
      minObsFraction: { type: Number, default: 0.5, min: 0, max: 1 },
      alpha: { type: Number, default: 0.1, min: 0.01, max: 0.5 },
      outlierZ: { type: Number, default: 3.5, min: 1, max: 20 },
      contamination: { type: Number, default: 0.02, min: 0.001, max: 0.2 },
      method: { type: String, enum: ['mare', 'linear', 'time', 'rolling', 'iterative'], default: 'mare' },
    },
    lastLoginAt: Date,
  },
  { timestamps: true }
);
userSchema.set('toJSON', {
  transform: (_d, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

const columnSub = new Schema({ name: String, type: String }, { _id: false });

const datasetSchema = new Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    originalFilename: { type: String, maxlength: 255 },
    storagePath: { type: String, required: true }, // relative to UPLOAD_DIR; original, never modified
    sha256: String,
    sizeBytes: Number,
    rowCount: { type: Number, default: 0 },
    columns: [columnSub],
    mapping: { type: Object, default: {} }, // canonical_field -> source column
    profile: { type: Object, default: null }, // cached ML profile (summary statistics)
    isSynthetic: { type: Boolean, default: false },
    truthPath: { type: String, default: null }, // synthetic ground truth (evaluation only)
    currentVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);
datasetSchema.index({ owner: 1, createdAt: -1 });

const datasetVersionSchema = new Schema(
  {
    dataset: { type: ObjectId, ref: 'Dataset', required: true, index: true },
    owner: { type: ObjectId, ref: 'User', required: true },
    version: { type: Number, required: true },
    kind: { type: String, enum: ['original', 'processed'], required: true },
    parentVersion: { type: Number, default: null },
    job: { type: ObjectId, ref: 'AnalysisJob', default: null },
    storagePath: { type: String, required: true },
    sha256: String,
    rowCount: Number,
    note: String,
  },
  { timestamps: true }
);
datasetVersionSchema.index({ dataset: 1, version: 1 }, { unique: true });

const jobSchema = new Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true, index: true },
    dataset: { type: ObjectId, ref: 'Dataset', required: true, index: true },
    datasetVersion: { type: Number, required: true },
    type: { type: String, enum: ['quality', 'anomalies', 'reconstruct', 'evaluate'], required: true },
    params: { type: Object, default: {} },
    status: { type: String, enum: ['queued', 'running', 'succeeded', 'failed'], default: 'queued', index: true },
    progress: { type: Number, default: 0 },
    stage: { type: String, default: 'Queued' },
    summary: { type: Object, default: null },
    error: { type: String, default: null },
    algorithmVersion: String,
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);
jobSchema.index({ dataset: 1, type: 1, createdAt: -1 });

const qualityIssueSchema = new Schema(
  {
    job: { type: ObjectId, ref: 'AnalysisJob', required: true, index: true },
    dataset: { type: ObjectId, ref: 'Dataset', required: true, index: true },
    owner: { type: ObjectId, ref: 'User', required: true },
    rowId: { type: Number, default: null },
    column: { type: String, default: null },
    category: { type: String, required: true, index: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], required: true },
    explanation: String,
    method: String,
    detectedBy: [String],
    scores: { type: Object, default: null },
    recommendedAction: String,
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    reviewStatus: { type: String, enum: ['unreviewed', 'confirmed_error', 'dismissed'], default: 'unreviewed' },
  },
  { timestamps: true }
);
qualityIssueSchema.index({ job: 1, category: 1, severity: 1 });

const reconstructionSchema = new Schema(
  {
    job: { type: ObjectId, ref: 'AnalysisJob', required: true, index: true },
    dataset: { type: ObjectId, ref: 'Dataset', required: true, index: true },
    owner: { type: ObjectId, ref: 'User', required: true },
    rowId: { type: Number, required: true },
    sensorId: { type: String, default: null },
    variable: { type: String, required: true },
    timestamp: Date,
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    originalValue: { type: Number, default: null }, // always null: the value was missing
    reconstructedValue: { type: Number, default: null },
    method: { type: String, default: null },
    status: { type: String, enum: ['reconstructed', 'abstained', 'skipped'], required: true },
    statusReason: String,
    algorithmVersion: String,
    evidence: { type: Object, default: null },
    uncertainty: { type: Object, default: null },
    limitations: [String],
    reviewStatus: { type: String, enum: ['unreviewed', 'accepted', 'rejected'], default: 'unreviewed' },
  },
  { timestamps: true }
);
reconstructionSchema.index({ job: 1, status: 1, rowId: 1 });

const evaluationSchema = new Schema(
  {
    job: { type: ObjectId, ref: 'AnalysisJob', required: true, unique: true },
    dataset: { type: ObjectId, ref: 'Dataset', required: true, index: true },
    owner: { type: ObjectId, ref: 'User', required: true },
    variable: String,
    status: String,
    referenceSource: String,
    summaryTable: { type: Array, default: [] },
    verdict: { type: Array, default: [] },
    results: { type: Object, default: {} },
    algorithmVersion: String,
  },
  { timestamps: true }
);

const auditSchema = new Schema(
  {
    dataset: { type: ObjectId, ref: 'Dataset', index: true },
    datasetVersion: Number,
    job: { type: ObjectId, ref: 'AnalysisJob', default: null },
    user: { type: ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    observationState: { type: String, enum: ['original', 'flagged', 'reconstructed', 'manually_reviewed', null], default: null },
    rowId: { type: Number, default: null },
    column: { type: String, default: null },
    issueCategory: { type: String, default: null },
    method: { type: String, default: null },
    originalValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    uncertainty: { type: Object, default: null },
    algorithmVersion: String,
    details: { type: Object, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ dataset: 1, createdAt: -1 });
// Audit entries are append-only.
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditSchema.pre(op, function (next) {
    if (this.getOptions && this.getOptions().allowAuditPurge) return next();
    next(new Error('AuditLog is append-only'));
  });
}

const m = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
module.exports = {
  User: m('User', userSchema),
  Dataset: m('Dataset', datasetSchema),
  DatasetVersion: m('DatasetVersion', datasetVersionSchema),
  AnalysisJob: m('AnalysisJob', jobSchema),
  QualityIssue: m('QualityIssue', qualityIssueSchema),
  ReconstructionRecord: m('ReconstructionRecord', reconstructionSchema),
  ModelEvaluation: m('ModelEvaluation', evaluationSchema),
  AuditLog: m('AuditLog', auditSchema),
};
