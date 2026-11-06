# REST API

Base URL `http://localhost:4000/api`. JSON in/out. Protected routes need `Authorization: Bearer <JWT>`.
Errors: `{ "error": { "message": "…", "details"?: [...] } }` with 400 (validation), 401, 403, 404, 409, 413, 422, 429, 502/503 (analysis service).

## Auth
| Method & path | Body | Notes |
|---|---|---|
| `POST /auth/register` | `name, email, password (≥10 chars, letter+digit), institution?` | Always creates a `researcher`. Returns `{token, user}`. Rate-limited. |
| `POST /auth/login` | `email, password` | Generic error for unknown email / bad password / disabled account. Rate-limited. |
| `POST /auth/logout` | – | Stateless JWT: client discards the token. |
| `GET /auth/me` | – | Current user. |
| `PUT /auth/me` | `name?, institution?, preferences?` | Preferences = default analysis parameters. |
| `PUT /auth/password` | `currentPassword, newPassword` | – |

## Datasets (owner-only; others get 404)
| Method & path | Notes |
|---|---|
| `POST /datasets/upload` | multipart: `file` (.csv, ≤ `MAX_UPLOAD_MB`), `name?`, `description?`, `mapping?` (JSON string canonical→source). Validates extension, size, header uniqueness, ≤ 200 columns, ≥ 1 row, mapping. Stored under a random filename. |
| `POST /datasets/demo` | Registers the bundled SYNTHETIC dataset (+ ground truth) for the user. |
| `GET /datasets` | List with latest quality score per dataset. |
| `GET /datasets/:id` | Detail, versions, summary statistics (computed lazily by the ML service). |
| `DELETE /datasets/:id` | Removes files + derived data; audit keeps a deletion record. |
| `GET /datasets/:id/preview?page&limit` | Raw rows as uploaded, with `_rowId`. |
| `GET /datasets/:id/download?version` | Original (default) or a processed version. |
| `PUT /datasets/:id/mapping` | `{mapping}`; audit-logged. |
| `GET /datasets/:id/series?variable&sensor&jobId&limit` | Downsampled series for charts (missing values returned as `null`). Rows flagged as suspected anomalies by `jobId` are always kept, so downsampling never hides them. |

Canonical fields: `timestamp, latitude, longitude, sea_surface_temperature, salinity, wave_height, current_speed, sensor_id` (none required).

## Analysis (asynchronous: `202 {job}`; poll `GET /analysis/jobs/:id`)
| Method & path | Body (all optional; defaults from user preferences) |
|---|---|
| `POST /analysis/:datasetId/quality` | `expected_interval_seconds, outlier_z, constant_run_length, valid_ranges{var:[lo,hi]}, cross_rules[]` |
| `POST /analysis/:datasetId/anomalies` | `columns[], madZ, window, contamination, nEstimators` |
| `POST /analysis/:datasetId/reconstruct` | `variable, method (mare\|linear\|time\|rolling\|iterative), maxGap, minObsFraction, maxRelativeHalfwidth, alpha, seed` |
| `POST /analysis/:datasetId/evaluate` | `variable, nRepeats (1–5), seed, maxGap, alpha, useTruth` |
| `GET /analysis/jobs?datasetId&type&status&limit` | List. |
| `GET /analysis/jobs/:id` | `status` queued→running→succeeded\|failed, `progress`, `stage`, `summary`, `error`. |

Limits: 3 concurrent jobs per user (429). Jobs run in-process; a restart marks unfinished jobs failed.

## Reports (add `?format=csv` for download)
| Path | Content |
|---|---|
| `GET /reports/:jobId/quality` | Issues (also for anomaly jobs). Filters: `severity, category, column, reviewStatus, page, limit`. |
| `GET /reports/dataset/:datasetId/summary` | Dataset-level quality summary (latest quality job). |
| `GET /reports/:jobId/reconstruction` | Records. Filters: `status, method, page, limit`. CSV includes interval, nominal level, `interval_calibrated=false`. |
| `GET /reports/:jobId/processed` | Processed dataset CSV. |
| `GET /reports/:jobId/benchmark` | Full evaluation; CSV = summary table. |
| `PATCH /reports/issues/:id/review` | `{decision: confirmed_error\|dismissed\|unreviewed}` → audit entry `manually_reviewed`. |
| `PATCH /reports/records/:id/review` | `{decision: accepted\|rejected\|unreviewed}`. |

## Audit, dashboard, map, admin
| Path | Notes |
|---|---|
| `GET /audit/:datasetId?action&observationState&rowId&jobId&page&limit` (`format=csv`) | Append-only history. |
| `GET /dashboard` | Aggregates computed from the user's latest completed jobs; `null` where nothing has been run. |
| `GET /map/points?datasetId&variable&from&to&status` | Only rows with valid coordinates; flagged and reconstructed overlays. |
| `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/:id` | Admin only. Cannot change own role/status. |
| `GET /health`, `GET /health/ml` | Liveness. |

## ML service (`http://localhost:8000`, interactive docs at `/docs`)
`POST /v1/profile | /v1/quality | /v1/anomalies | /v1/reconstruct | /v1/evaluate` — header `X-Service-Token`. Request bodies carry `csv` (text) and `mapping`. 422 for bad input.
