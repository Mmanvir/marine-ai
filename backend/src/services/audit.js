const { AuditLog } = require('../models');

async function log(entry) {
  return AuditLog.create(entry);
}

async function logMany(entries, chunk = 1000) {
  for (let i = 0; i < entries.length; i += chunk) {
    await AuditLog.insertMany(entries.slice(i, i + chunk), { ordered: false });
  }
}

async function insertChunked(Model, docs, chunk = 1000) {
  for (let i = 0; i < docs.length; i += chunk) {
    await Model.insertMany(docs.slice(i, i + chunk), { ordered: false });
  }
}

module.exports = { log, logMany, insertChunked };
