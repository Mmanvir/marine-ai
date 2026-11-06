const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { User } = require('../models');
const { AppError, asyncHandler } = require('../middleware');

const BCRYPT_ROUNDS = 12;
// Pre-computed hash so unknown-email logins take similar time to wrong-password logins.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sign = (user) => jwt.sign({ sub: user._id.toString(), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, institution } = req.body;
  if (await User.findOne({ email })) throw new AppError(409, 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // Self-registration is always a researcher; admins are promoted by an existing admin (or the seed script).
  const user = await User.create({ name, email, passwordHash, institution: institution || '', role: 'researcher' });
  res.status(201).json({ token: sign(user), user });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || !user.isActive) throw new AppError(401, 'Invalid email or password');
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: sign(user), user });
});

exports.me = (req, res) => res.json({ user: req.user });

exports.updateMe = asyncHandler(async (req, res) => {
  const { name, institution, preferences } = req.body;
  if (name !== undefined) req.user.name = name;
  if (institution !== undefined) req.user.institution = institution;
  if (preferences) {
    for (const [k, v] of Object.entries(preferences)) req.user.preferences[k] = v;
  }
  await req.user.save();
  res.json({ user: req.user });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw new AppError(401, 'Current password is incorrect');
  user.passwordHash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
  await user.save();
  res.status(204).end();
});

// JWTs are stateless: logout is performed by the client discarding its token.
exports.logout = (_req, res) => res.status(204).end();
