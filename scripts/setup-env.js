#!/usr/bin/env node
/**
 * Creates ./.env from ./.env.example with freshly generated random secrets.
 * Uses only Node built-ins (no npm install needed). Never overwrites an existing .env.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('.env already exists - leaving it untouched.');
  process.exit(0);
}
const rnd = (n = 32) => crypto.randomBytes(n).toString('hex');
const pw = () => crypto.randomBytes(9).toString('base64url') + '7a'; // satisfies letter + digit rule

const adminPw = pw();
const demoPw = pw();
let text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
text = text
  .replace('JWT_SECRET=CHANGE_ME', `JWT_SECRET=${rnd()}`)
  .replace('ML_SERVICE_TOKEN=CHANGE_ME', `ML_SERVICE_TOKEN=${rnd(16)}`)
  .replace('SEED_ADMIN_PASSWORD=CHANGE_ME', `SEED_ADMIN_PASSWORD=${adminPw}`)
  .replace('SEED_DEMO_PASSWORD=CHANGE_ME', `SEED_DEMO_PASSWORD=${demoPw}`);
fs.writeFileSync(target, text, { mode: 0o600 });
console.log('Created .env with random secrets.\n');
console.log('Demo logins (created by `npm run seed`):');
console.log(`  researcher@marinetrace.local / ${demoPw}`);
console.log(`  admin@marinetrace.local      / ${adminPw}`);
console.log('(They are also stored in .env. Never commit .env.)');
