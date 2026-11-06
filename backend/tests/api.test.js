/**
 * These tests need no MongoDB: they cover validation, auth gating, CSV utilities and error shape.
 * Database-backed flows are covered by the manual end-to-end checklist in docs/TESTING.md.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const csv = require('../src/services/csvService');
const validators = require('../src/validators');

describe('public + auth gating', () => {
  test('health responds', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test.each([
    ['get', '/api/datasets'], ['get', '/api/dashboard'], ['post', '/api/analysis/507f1f77bcf86cd799439011/quality'],
    ['get', '/api/audit/507f1f77bcf86cd799439011'], ['get', '/api/admin/stats'], ['get', '/api/auth/me'],
  ])('%s %s requires a token', async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBeDefined();
  });

  test('garbage and wrongly-signed tokens are rejected', async () => {
    expect((await request(app).get('/api/datasets').set('Authorization', 'Bearer nope')).status).toBe(401);
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin' }, 'another-secret');
    expect((await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  test('unknown route is a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Route not found');
  });
});

describe('request validation (rejected before touching the database)', () => {
  test('register rejects weak password and bad email', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Al', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  test('login requires both fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co' });
    expect(res.status).toBe(400);
  });

  test('error responses never leak stack traces', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });
});

describe('validators', () => {
  test('analysis params are bounded', () => {
    expect(validators.analysis.reconstruct.safeParse({ maxGap: 100000 }).success).toBe(false);
    expect(validators.analysis.reconstruct.safeParse({ method: 'magic' }).success).toBe(false);
    expect(validators.analysis.reconstruct.safeParse({ variable: 'salinity', method: 'linear' }).success).toBe(true);
    expect(validators.analysis.evaluate.parse({}).nRepeats).toBe(3);
    expect(validators.analysis.anomalies.safeParse({ contamination: 0.9 }).success).toBe(false);
  });
  test('mapping accepts only canonical fields', () => {
    expect(validators.mapping.safeParse({ timestamp: 'time' }).success).toBe(true);
    expect(validators.mapping.safeParse({ bogus: 'x' }).success).toBe(false);
  });
});

describe('csv service', () => {
  test('parses, infers types and suggests mapping', () => {
    const rows = csv.parseCsvText('time,SST,station\n2024-01-01T00:00:00Z,25.1,A\n2024-01-01T01:00:00Z,,A\n');
    expect(rows).toHaveLength(2);
    const cols = csv.inferColumns(Object.keys(rows[0]), rows);
    expect(cols.find((c) => c.name === 'SST').type).toBe('numeric');
    expect(cols.find((c) => c.name === 'time').type).toBe('datetime');
    expect(csv.suggestMapping(Object.keys(rows[0]))).toEqual({ timestamp: 'time', sea_surface_temperature: 'SST', sensor_id: 'station' });
  });

  test('rejects duplicate headers, ragged rows and bad mapping', () => {
    expect(() => csv.parseCsvText('a,a\n1,2\n')).toThrow(/duplicate/i);
    expect(() => csv.parseCsvText('a,b\n1\n')).toThrow(/Invalid CSV/);
    expect(() => csv.validateMapping({ timestamp: 'missing' }, ['a'])).toThrow(/not found/);
    expect(() => csv.validateMapping({ timestamp: 'a', salinity: 'a' }, ['a'])).toThrow(/only one/);
  });

  test('csv export neutralises formula injection but keeps negative numbers', () => {
    const out = csv.toCsv([{ a: '=HYPERLINK("x")', b: '-5.2', c: 'plain,comma', d: 3 }], ['a', 'b', 'c', 'd']);
    const [, line] = out.trim().split('\n');
    expect(line.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(line).toContain(',-5.2,');
    expect(line).toContain('"plain,comma"');
  });

  test('stored paths cannot escape the upload dir', () => {
    expect(() => csv.fullPath('../../etc/passwd')).toThrow();
  });

  test('canonicalRows keeps zero-based row ids and nulls non-numeric', () => {
    const ds = { mapping: { timestamp: 't', latitude: 'la', longitude: 'lo', sea_surface_temperature: 'x' } };
    const rows = csv.canonicalRows(ds, 't,la,lo,x\n2024-01-01,10,70,abc\n2024-01-02,10,70,5\n');
    expect(rows[0].values.sea_surface_temperature).toBeNull();
    expect(rows[1].rowId).toBe(1);
    expect(csv.validCoord(rows[0].latitude, rows[0].longitude)).toBe(true);
    expect(csv.validCoord(95, 10)).toBe(false);
  });
});
