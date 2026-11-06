const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const { requireAuth, requireRole, validate, validId } = require('../middleware');
const v = require('../validators');
const auth = require('../controllers/auth');
const datasets = require('../controllers/datasets');
const analysis = require('../controllers/analysis');
const reports = require('../controllers/reports');
const misc = require('../controllers/misc');
const csv = require('../services/csvService');
const { newStoredName } = require('../services/datasetService');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  skip: () => config.isTest, message: { error: { message: 'Too many attempts. Try again in a few minutes.' } },
});

const upload = multer({
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      csv.ensureUploadDir();
      cb(null, config.uploadDir);
    },
    filename: (_req, _file, cb) => cb(null, newStoredName()), // random name: client filename never touches the disk path
  }),
  fileFilter: (_req, file, cb) => {
    const okExt = /\.csv$/i.test(file.originalname);
    const okType = ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
    if (!okExt || !okType) return cb(Object.assign(new Error('Only .csv files are accepted'), { status: 400 }));
    cb(null, true);
  },
});

// health
router.get('/health', misc.health);
router.get('/health/ml', misc.healthMl);

// auth
router.post('/auth/register', authLimiter, validate(v.register), auth.register);
router.post('/auth/login', authLimiter, validate(v.login), auth.login);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, auth.me);
router.put('/auth/me', requireAuth, validate(v.updateMe), auth.updateMe);
router.put('/auth/password', requireAuth, authLimiter, validate(v.changePassword), auth.changePassword);

// everything below needs a signed-in user
router.use(requireAuth);

// datasets
router.post('/datasets/upload', upload.single('file'), validate(v.upload), datasets.upload);
router.post('/datasets/demo', datasets.demo);
router.get('/datasets', datasets.list);
router.get('/datasets/:id', validId(), datasets.get);
router.delete('/datasets/:id', validId(), datasets.remove);
router.get('/datasets/:id/preview', validId(), datasets.preview);
router.get('/datasets/:id/download', validId(), datasets.download);
router.get('/datasets/:id/series', validId(), datasets.series);
router.put('/datasets/:id/mapping', validId(), validate(v.setMapping), datasets.setMapping);

// analysis
router.post('/analysis/:datasetId/quality', validId('datasetId'), analysis.quality);
router.post('/analysis/:datasetId/anomalies', validId('datasetId'), analysis.anomalies);
router.post('/analysis/:datasetId/reconstruct', validId('datasetId'), analysis.reconstruct);
router.post('/analysis/:datasetId/evaluate', validId('datasetId'), analysis.evaluate);
router.get('/analysis/jobs', analysis.listJobs);
router.get('/analysis/jobs/:id', validId(), analysis.getJob);

// reports
router.get('/reports/dataset/:datasetId/summary', validId('datasetId'), reports.datasetSummary);
router.patch('/reports/issues/:id/review', validId(), validate(v.reviewIssue), reports.reviewIssue);
router.patch('/reports/records/:id/review', validId(), validate(v.reviewRecord), reports.reviewRecord);
router.get('/reports/:jobId/quality', validId('jobId'), reports.quality);
router.get('/reports/:jobId/reconstruction', validId('jobId'), reports.reconstruction);
router.get('/reports/:jobId/processed', validId('jobId'), reports.processed);
router.get('/reports/:jobId/benchmark', validId('jobId'), reports.benchmark);

// audit, dashboard, map
router.get('/audit/:datasetId', validId('datasetId'), misc.audit);
router.get('/dashboard', misc.dashboard);
router.get('/map/points', misc.mapPoints);

// admin
router.get('/admin/stats', requireRole('admin'), misc.adminStats);
router.get('/admin/users', requireRole('admin'), misc.adminUsers);
router.patch('/admin/users/:id', requireRole('admin'), validId(), validate(v.adminUser), misc.adminUpdateUser);

module.exports = router;
