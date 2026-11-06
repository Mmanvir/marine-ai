const { AnalysisJob } = require('../models');

/** Latest succeeded job per (dataset, type) for one owner. */
async function latestJobs(owner, datasetId = null) {
  const match = { owner, status: 'succeeded' };
  if (datasetId) match.dataset = datasetId;
  return AnalysisJob.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { dataset: '$dataset', type: '$type' }, doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
  ]);
}

module.exports = { latestJobs };
