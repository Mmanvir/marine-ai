# Testing strategy and status

## What was actually executed (authoring sandbox, no package installs possible)

| Suite | Command | Result |
|---|---|---|
| ML engine + handlers + NDBC converter | `cd ml-service && python -m unittest discover -s tests` | **43 tests run, OK, 2 skipped** (HTTP tests, FastAPI not installable there) |
| Benchmark | `python scripts/run_benchmark.py` | Ran; output identical to committed `results/` (runtimes aside) |
| Synthetic generator | `python scripts/generate_synthetic.py --seed 42` | Deterministic (byte-identical on re-run) |
| Backend JS | `node --check` on every file; static import/export resolution script | Passed. **Jest not run** (no dependencies could be installed) |
| Frontend JSX | Parsed every file with the TypeScript compiler's parser; static import/export resolution script | Passed. **Vitest not run; never rendered in a browser** |
| Docker Compose, MongoDB integration, end-to-end flow | - | **Not run** |

Do not treat the untested rows as passing. Run the suites below on your machine first.

## Run on your machine
```bash
cd ml-service && pip install -r requirements.txt && python -m pytest -q     # includes the 2 FastAPI HTTP tests
cd backend    && npm install && npm test        # no MongoDB required
cd frontend   && npm install && npm test
```

## What each suite covers
* **ML engine:** missing/duplicate/invalid timestamp/coordinate/non-numeric detection; outliers reported as *suspected*, never errors; no universal physical limits; constant-run and delayed-observation checks; empty input; mapping validation; originals never mutated; anomaly detectors on normal data, spikes, constant series, tiny and all-NaN series, parameter sensitivity; interpolation accuracy, **no extrapolation at edges**, max-gap respected, unsorted input, sensors never mixed, duplicate timestamps reported, insufficient data, unknown method/column; MARE decision record, abstention (sparse series and interval-width gate); uncertainty unavailable with few residuals, labelled uncalibrated, calibration window respected; benchmark reproducibility and insufficient-data handling; generator determinism.
* **Backend (Jest + Supertest, no database):** every protected route rejects missing/garbage/forged tokens; registration/login validation and error shape (no stack traces); parameter bounds; CSV parsing, type inference, mapping suggestions and validation, formula-injection neutralisation, path-traversal guard, row-id alignment.
* **Frontend (Vitest + Testing Library):** formatters and header parsing; status/synthetic badges, tables, pagination, empty/error states; upload file validation; protected-route redirect, login validation, server-error display and successful login.

## Gaps (known)
No automated tests for: DB-backed controllers, job runner, authorization between two users (ownership), report CSV content, the Leaflet map, charts, or Docker. A manual checklist for first launch:

1. Register two users. User B must get **404** for user A's dataset id on every endpoint.
2. Upload a CSV with a bad header (duplicate names) -> clear 400 message. Upload a `.txt` -> rejected.
3. Load the synthetic demo -> run the pipeline -> dashboard cards fill with numbers, nothing invented.
4. Download the processed CSV; the original column must be unchanged and estimate columns separate.
5. Stop the ML service and start an analysis -> job fails with an "unreachable" message, server keeps running.
6. Audit trail shows detections, reconstructions and your manual reviews; entries cannot be edited via the API.
