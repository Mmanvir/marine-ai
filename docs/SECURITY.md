# Security notes and production hardening

MarineTrace AI is a research prototype. These are the controls implemented and what is still needed before any real deployment.

## Implemented
* **Secrets:** nothing hard-coded. `scripts/setup-env.js` generates the JWT secret, the backend-to-ML token and demo passwords. The backend refuses to start with a missing or placeholder `JWT_SECRET`. `.env` is git-ignored; only `.env.example` is committed.
* **Passwords:** bcrypt via `bcryptjs` (pure JavaScript implementation of bcrypt; cost 12), minimum 10 characters with a letter and a digit. Hashes are `select:false`. Unknown-email logins compare against a dummy hash to reduce timing differences; one generic error message.
* **AuthN/Z:** JWT (HS256, default 8 h) on every non-public route; user must still exist and be active on each request. Roles: researcher, admin. Self-registration can only create researchers. Admins cannot change their own role or status.
* **Ownership:** every dataset, job, report, issue, record and audit query filters by the signed-in owner; other users' ids return 404. Admins see aggregate statistics only, not other users' data.
* **Uploads:** `.csv` extension + MIME check, size limit (`MAX_UPLOAD_MB`), one file, random server-side filename (client filename never used as a path), ≤ 200 columns, unique headers, strict CSV parsing, mapping validated against real headers. Stored paths are resolved inside the upload directory (traversal guard).
* **CSV export:** text cells starting with `= + - @` are prefixed with `'` to neutralise spreadsheet formula injection (numbers untouched).
* **Input validation:** zod schemas with bounded parameters on every body; 1 MB JSON limit.
* **Errors:** centralised handler; 5xx details are logged server-side, never returned.
* **Transport/headers:** `helmet`, explicit CORS allow-list, `x-powered-by` disabled.
* **Rate limiting:** login, register and password change (30 per 15 minutes per IP).
* **Service boundary:** ML service requires a shared-secret header (constant-time comparison) and is stateless; in Docker Compose it is not published to the host.
* **Immutability:** original uploads are never rewritten; audit entries are append-only at the model layer (update/delete hooks throw).
* **Logging:** request line only; no bodies, tokens or passwords.

## Known limitations / before production
1. **Token storage:** the JWT lives in `localStorage`, readable by any script on the page (XSS). Prefer `HttpOnly; Secure; SameSite` cookies with CSRF protection, shorter expiry and refresh tokens, and server-side revocation (logout is client-side only).
2. **TLS:** none in the repo. Terminate HTTPS at a reverse proxy; the Compose file serves plain HTTP on localhost.
3. **Jobs run in the API process**; heavy analyses can slow the API. Use a queue and worker, per-user quotas and timeouts.
4. **Uploads on local disk**, no virus scanning, no encryption at rest, no quota per user. Use object storage, scanning and quotas.
5. **MongoDB** has no authentication in the Compose file (bound to localhost only). Enable auth and network isolation.
6. **Audit log** is append-only in application code only; a database administrator can still alter it. Use write-once storage or hash chaining for evidentiary needs. Audit rows outlive deleted datasets by design (check privacy rules before retaining).
7. **Rate limiting** is per IP and in memory; use a shared store behind a proxy. No account lockout or MFA.
8. **Dependencies** were never installed or audited in the authoring sandbox. Run `npm audit` and `pip-audit`, pin versions, and add Dependabot or equivalent.
9. **No privacy review** (retention, deletion on request, personal data in uploaded files).
10. **Leaflet tiles** are fetched from openstreetmap.org: follow the OSM tile usage policy for anything beyond light use, or host your own tiles.
