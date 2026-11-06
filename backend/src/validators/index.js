const { z } = require('zod');

const VARIABLES = ['sea_surface_temperature', 'salinity', 'wave_height', 'current_speed'];
const CANONICAL = ['timestamp', 'latitude', 'longitude', ...VARIABLES, 'sensor_id'];
const METHODS = ['mare', 'linear', 'time', 'rolling', 'iterative'];

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit');

const register = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  password,
  institution: z.string().trim().max(120).optional(),
});
const login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });

const prefs = z.object({
  maxGap: z.number().int().min(1).max(500).optional(),
  minObsFraction: z.number().min(0).max(1).optional(),
  alpha: z.number().min(0.01).max(0.5).optional(),
  outlierZ: z.number().min(1).max(20).optional(),
  contamination: z.number().min(0.001).max(0.2).optional(),
  method: z.enum(METHODS).optional(),
});
const updateMe = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  institution: z.string().trim().max(120).optional(),
  preferences: prefs.optional(),
});
const changePassword = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

const mapping = z.record(z.enum(CANONICAL), z.string().min(1).max(200));
const setMapping = z.object({ mapping });

const upload = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  mapping: z.string().max(5000).optional(), // JSON string (multipart field)
});

const crossRule = z.object({
  name: z.string().max(80).optional(),
  when: z.enum(VARIABLES), op: z.enum(['>', '<', '>=', '<=']), value: z.number(),
  then: z.enum(VARIABLES), op2: z.enum(['>', '<', '>=', '<=']), value2: z.number(),
});
const qualityParams = z.object({
  expected_interval_seconds: z.number().positive().max(86400 * 30).optional(),
  outlier_z: z.number().min(1).max(20).optional(),
  constant_run_length: z.number().int().min(3).max(1000).optional(),
  valid_ranges: z.record(z.enum(VARIABLES), z.tuple([z.number(), z.number()])).optional(),
  cross_rules: z.array(crossRule).max(10).optional(),
}).default({});

const anomalyParams = z.object({
  columns: z.array(z.enum(VARIABLES)).min(1).max(4).optional(),
  madZ: z.number().min(1).max(20).optional(),
  window: z.number().int().min(5).max(101).optional(),
  contamination: z.number().min(0.001).max(0.2).optional(),
  nEstimators: z.number().int().min(50).max(500).optional(),
}).default({});

const reconstructParams = z.object({
  variable: z.enum(VARIABLES).default('sea_surface_temperature'),
  method: z.enum(METHODS).optional(),
  maxGap: z.number().int().min(1).max(500).optional(),
  minObsFraction: z.number().min(0).max(1).optional(),
  maxRelativeHalfwidth: z.number().positive().max(100).optional(),
  alpha: z.number().min(0.01).max(0.5).optional(),
  seed: z.number().int().optional(),
}).default({});

const evaluateParams = z.object({
  variable: z.enum(VARIABLES).default('sea_surface_temperature'),
  nRepeats: z.number().int().min(1).max(5).default(3),
  seed: z.number().int().default(7),
  maxGap: z.number().int().min(1).max(500).optional(),
  alpha: z.number().min(0.01).max(0.5).optional(),
  useTruth: z.boolean().default(true),
}).default({});

const reviewIssue = z.object({ decision: z.enum(['confirmed_error', 'dismissed', 'unreviewed']) });
const reviewRecord = z.object({ decision: z.enum(['accepted', 'rejected', 'unreviewed']) });
const adminUser = z.object({ role: z.enum(['researcher', 'admin']).optional(), isActive: z.boolean().optional() });

module.exports = {
  register, login, updateMe, changePassword, setMapping, upload, mapping,
  analysis: { quality: qualityParams, anomalies: anomalyParams, reconstruct: reconstructParams, evaluate: evaluateParams },
  reviewIssue, reviewRecord, adminUser, VARIABLES,
};
