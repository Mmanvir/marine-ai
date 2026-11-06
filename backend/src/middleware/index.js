const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { ZodError } = require('zod');
const config = require('../config/env');

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req[source] with a zod schema and replace it with the parsed value. */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const parsed = schema.safeParse(req[source]);
  if (!parsed.success) return next(parsed.error);
  req[source] = parsed.data;
  next();
};

const validId = (param = 'id') => (req, _res, next) => {
  if (!mongoose.isValidObjectId(req.params[param])) return next(new AppError(404, 'Not found'));
  next();
};

const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }
  const { User } = require('../models');
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw new AppError(401, 'Account not found or disabled');
  req.user = user;
  next();
});

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new AppError(403, 'Insufficient permissions'));
  next();
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message;
  let details = err.details;

  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  } else if (err.code === 11000) {
    status = 409;
    message = 'A record with that value already exists';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = `File too large (limit ${Math.round(config.maxUploadBytes / 1048576)} MB)`;
  } else if (err.name === 'MulterError') {
    status = 400;
  } else if (status >= 500) {
    // Log server-side; never leak internals to the client.
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err.stack || err);
    message = 'Internal server error';
    details = undefined;
  }
  res.status(status).json({ error: { message, ...(details ? { details } : {}) } });
}

const notFound = (_req, _res, next) => next(new AppError(404, 'Route not found'));

module.exports = { AppError, asyncHandler, validate, validId, requireAuth, requireRole, errorHandler, notFound };
