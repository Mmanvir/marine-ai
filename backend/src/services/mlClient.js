const axios = require('axios');
const config = require('../config/env');
const { AppError } = require('../middleware');

const client = axios.create({
  baseURL: config.mlServiceUrl,
  timeout: 15 * 60 * 1000,
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
  headers: { 'X-Service-Token': config.mlServiceToken },
});

async function post(url, body) {
  try {
    const { data } = await client.post(url, body);
    return data;
  } catch (e) {
    if (e.response) {
      const d = e.response.data;
      const msg = d && d.detail ? (typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)) : `status ${e.response.status}`;
      throw new AppError(e.response.status === 422 ? 422 : 502, `Analysis service: ${msg}`);
    }
    throw new AppError(503, 'Analysis service is unreachable. Start the ML service (see README) and try again.');
  }
}

async function ping() {
  const { data } = await client.get('/health', { timeout: 3000 });
  return data;
}

module.exports = {
  ping,
  profile: (csv) => post('/v1/profile', { csv }),
  quality: (body) => post('/v1/quality', body),
  anomalies: (body) => post('/v1/anomalies', body),
  reconstruct: (body) => post('/v1/reconstruct', body),
  evaluate: (body) => post('/v1/evaluate', body),
};
