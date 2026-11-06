const path = require('path');
const dotenv = require('dotenv');

// Project-root .env first, then backend/.env (does not override already-set variables).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const env = process.env;
const isTest = env.NODE_ENV === 'test';
const isPlaceholder = (v) => !v || v.startsWith('CHANGE_ME');

if (!isTest && isPlaceholder(env.JWT_SECRET)) {
  throw new Error(
    'JWT_SECRET is missing or still the placeholder. Run `node scripts/setup-env.js` from the project root ' +
      '(creates .env with random secrets) or set JWT_SECRET yourself.'
  );
}

const backendRoot = path.resolve(__dirname, '../..');

module.exports = {
  isTest,
  nodeEnv: env.NODE_ENV || 'development',
  port: parseInt(env.PORT || '4000', 10),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/marinetrace',
  jwtSecret: env.JWT_SECRET || 'test-only-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  corsOrigins: (env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  maxUploadBytes: parseInt(env.MAX_UPLOAD_MB || '25', 10) * 1024 * 1024,
  uploadDir: path.resolve(backendRoot, env.UPLOAD_DIR || './uploads'),
  mlServiceUrl: (env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
  mlServiceToken: env.ML_SERVICE_TOKEN || '',
  demoDataDir: path.resolve(backendRoot, env.DEMO_DATA_DIR || '../data/synthetic'),
  maxActiveJobsPerUser: 3,
};
