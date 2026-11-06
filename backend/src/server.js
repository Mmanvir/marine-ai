const config = require('./config/env');
const app = require('./app');
const { connectDb } = require('./config/db');
const { failStaleJobs } = require('./services/jobRunner');
const { ensureUploadDir } = require('./services/csvService');

async function main() {
  ensureUploadDir();
  await connectDb();
  await failStaleJobs();
  app.listen(config.port, () => console.log(`MarineTrace API listening on http://localhost:${config.port}/api (env: ${config.nodeEnv})`));
}

main().catch((e) => {
  console.error('Failed to start server:', e.message);
  if (/ECONNREFUSED|server selection/i.test(e.message)) {
    console.error('MongoDB is not reachable at MONGODB_URI. Start MongoDB (e.g. `docker compose up -d mongo`) and retry.');
  }
  process.exit(1);
});
