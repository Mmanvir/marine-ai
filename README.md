# MarineTrace AI — by Abyssal Labs

**An adaptive, uncertainty-aware marine data recovery and reliability system.** Research prototype for a capstone project.

MarineTrace AI detects suspicious observations in marine time series, assesses data quality, reconstructs eligible missing values, quantifies how uncertain each reconstruction is, and keeps an auditable record of every change. It is **not** an operational forecasting service, and it makes no novelty or patentability claim (see [docs/PATENT_NOVELTY.md](docs/PATENT_NOVELTY.md)).

```
frontend/   React 18 + Vite + Tailwind + Recharts + Leaflet     (http://localhost:5173)
backend/    Node + Express + MongoDB (Mongoose) + JWT           (http://localhost:4000/api)
ml-service/ Python + FastAPI + pandas + scikit-learn            (http://localhost:8000/docs)
data/       synthetic dataset (seeded generator, ground truth kept separately)
scripts/    data generator, offline benchmark, NOAA NDBC converter, .env setup
docs/       architecture, API, ML method, evaluation, testing, security, novelty, capstone report
```

## What has and has not been verified (read this first)

This project was authored in a sandbox that could not install packages from npm or PyPI, so **only the Python parts could actually be executed**.

| Part | Status |
|---|---|
| ML engine (quality, anomalies, recovery, MARE, uncertainty, benchmark, generator, NDBC converter) | **Run.** 43 tests executed, 41 passed, 2 skipped (the HTTP tests need FastAPI, which was not installable there). Benchmark results in `results/` were produced by `scripts/run_benchmark.py`. |
| FastAPI layer (`ml-service/app/main.py`) | Compiles; handler logic is tested; the HTTP layer itself has **not been run**. |
| Express backend | Every file passes `node --check`. Jest tests are written but **not run**. Never connected to MongoDB. |
| React frontend | Every file parses (TypeScript-compiler parser used as a syntax check) and a script confirms the import/export graph resolves. Vitest tests are written but **not run**. **Never rendered in a browser.** |
| Docker Compose | Written, **not run**. |
| Full stack end to end | **Not run.** Expect to fix a few small integration bugs on first launch (typos in field names, a chart prop, etc.). The structure and contracts are consistent, but nothing replaces the first real run. |

Run the test suites (below) first; they tell you quickly whether your environment is healthy.

## Prerequisites

* **Node.js 18+** (22 recommended) and npm
* **Python 3.11+**
* **MongoDB** — either [MongoDB Community Server](https://www.mongodb.com/try/download/community), a free [Atlas](https://www.mongodb.com/atlas) cluster, or Docker: `docker run -d -p 27017:27017 --name mt-mongo mongo:7`
* VS Code (optional but recommended — `.vscode/tasks.json` is included)

## Quick start (local development)

Open the `marinetrace-ai` folder in VS Code, open a terminal, and follow these steps.

### 1. Create your `.env` (random secrets, nothing hardcoded)

```bash
node scripts/setup-env.js
```
This copies `.env.example` to `.env`, generates `JWT_SECRET`, the backend↔ML shared token, and the demo-account passwords, and **prints the demo logins once** (they are also in `.env`).

### 2. ML service (terminal 1)

```bash
cd ml-service
python -m venv .venv
# macOS/Linux:  source .venv/bin/activate        Windows PowerShell:  .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```
Check http://localhost:8000/health and the OpenAPI docs at http://localhost:8000/docs.
The shared token is read from the environment — the simplest way is to export the variables from `.env` first, or run uvicorn with `--env-file ../.env`:
```bash
python -m uvicorn app.main:app --reload --port 8000 --env-file ../.env
```

### 3. Backend (terminal 2)

```bash
cd backend
npm install
npm run seed            # creates demo accounts + the SYNTHETIC demo dataset
npm run dev             # http://localhost:4000/api/health
```
Optional: `npm run seed:analyze` also runs quality → anomalies → reconstruction → benchmark on the demo dataset (needs the ML service running) so the dashboard is populated immediately.

### 4. Frontend (terminal 3)

```bash
cd frontend
npm install
npm run dev             # http://localhost:5173
```

Sign in with the demo researcher printed in step 1 (`researcher@marinetrace.local`), or register your own account.

> **VS Code shortcut:** *Terminal → Run Task → "Start all (ML + API + web)"* launches all three (after the `pip install` / `npm install` steps once).

### Docker alternative

```bash
node scripts/setup-env.js
docker compose up --build
docker compose exec backend npm run seed
# open http://localhost:8080
```

## Five-minute demo

1. Sign in → **Datasets → Load synthetic demo** (clearly badged *Synthetic*).
2. Dataset page → **Analysis workflow → Run quality → anomalies → reconstruction**.
3. **Data quality**: see issue categories, severities, and review an issue (*Confirm error* / *Dismiss*).
4. **Anomaly explorer**: compare robust MAD with Isolation Forest; note both are "suspected", not "wrong".
5. **Recovery analysis**: open *Details* on a record to see MARE's candidate methods and evidence; download the processed CSV (originals untouched, estimates in separate columns).
6. **Uncertainty**: intervals as error bars; read the "How to read these numbers" panel.
7. **Marine map**: flagged (red) and reconstructed (amber rings) points on OpenStreetMap.
8. **Benchmarking → Run benchmark**: see whether MARE actually beats fixed baselines (on the included synthetic data it does **not** — see below).
9. **Audit trail**: filter by *Reconstructed* / *Manually reviewed* and export CSV.

## Measured results (synthetic data, seed 42)

From `results/benchmark_seed42.md`, produced by `python scripts/run_benchmark.py`:

* On the values every method reconstructed, **MARE was not better than the best fixed method in any scenario**: random gaps +2.0 % RMSE, short contiguous gaps +0.2 %, long contiguous gaps +17.1 %.
* Rolling median was clearly the weakest baseline; on long gaps it only reconstructed 37 % of values.
* The nominal-90 % intervals were not calibrated: coverage 0.84 (random), 0.94 (short), 0.98 (long).
* Both detectors found all 18 injected spikes; robust MAD had 8 false positives (precision 0.69), Isolation Forest 21 (precision 0.46).

One synthetic dataset and one seed support **no general conclusion**. See [docs/EVALUATION.md](docs/EVALUATION.md).

## Running the tests

```bash
cd ml-service && python -m pytest -q            # or: python -m unittest discover -s tests
cd backend    && npm test                        # no MongoDB needed
cd frontend   && npm test
python scripts/run_benchmark.py --repeats 3     # regenerates results/
python scripts/generate_synthetic.py --seed 42  # regenerates data/synthetic (deterministic)
```

## Optional: public data (NOAA NDBC)

`scripts/import_ndbc.py` converts a downloaded NDBC standard-meteorological file to the canonical CSV (no download is performed for you; check licensing and the current file format). See the script header.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `JWT_SECRET is missing…` | Run `node scripts/setup-env.js` from the project root. |
| Backend exits with "MongoDB is not reachable" | Start MongoDB, or fix `MONGODB_URI` in `.env`. |
| Jobs fail with "Analysis service is unreachable" | Start the ML service (step 2). |
| Jobs fail with "Invalid or missing service token" | The ML service must see the same `ML_SERVICE_TOKEN` as the backend: use `--env-file ../.env`. |
| "Synthetic demo data not found" | `python scripts/generate_synthetic.py` |
| `python` not found on Windows | Use `py -3 -m venv .venv` and `py -3 -m uvicorn …`. |
| Port already in use | Change `PORT` (backend) / the uvicorn `--port`; update `ML_SERVICE_URL`, and `VITE_PROXY_TARGET` for the frontend. |

## Documentation

[CAPSTONE.md](docs/CAPSTONE.md) (abstract → future scope, presentation outline) ·
[ARCHITECTURE.md](docs/ARCHITECTURE.md) (diagrams, schema) · [API.md](docs/API.md) · [ML_METHODOLOGY.md](docs/ML_METHODOLOGY.md) ·
[EVALUATION.md](docs/EVALUATION.md) · [TESTING.md](docs/TESTING.md) · [SECURITY.md](docs/SECURITY.md) · [PATENT_NOVELTY.md](docs/PATENT_NOVELTY.md)

## Licence and data

Synthetic data is generated by this repository and is free to use. No licence file is included; add one that suits your institution before publishing.
