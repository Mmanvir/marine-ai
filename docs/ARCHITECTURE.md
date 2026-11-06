# Architecture

## System overview

```mermaid
flowchart LR
  U[Researcher / Admin<br/>browser] -->|HTTPS, JWT| FE[React SPA<br/>Vite dev / nginx]
  FE -->|/api REST| BE[Express API<br/>auth · validation · jobs · exports]
  BE -->|Mongoose| DB[(MongoDB<br/>users · datasets · jobs · issues · records · audit)]
  BE -->|files| FS[(Upload dir<br/>original + processed CSV)]
  BE -->|HTTP + shared token| ML[FastAPI ML service<br/>pandas · scikit-learn]
  ML -. stateless .-> ML
```

Responsibilities are strictly separated:

* **Frontend** renders and calls the REST API only. It never talks to the ML service.
* **Backend** owns identity, authorization (ownership checks on every dataset/job/report), file storage, job lifecycle, persistence, CSV exports and the audit log.
* **ML service** is stateless and pure: it receives CSV text + a column mapping and returns JSON. It trusts the backend through a shared secret header and stores nothing.

## Workflow data flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as Express
  participant M as ML service
  participant D as MongoDB / disk
  B->>A: POST /datasets/upload (CSV + mapping)
  A->>D: save original file (random name), Dataset v1, audit "dataset_uploaded"
  B->>A: POST /analysis/:id/reconstruct
  A->>D: AnalysisJob(queued) -> 202
  A-->>A: runner picks up job (in-process)
  A->>M: POST /v1/reconstruct (csv, mapping, params)
  M-->>A: records + summary + processed_csv
  A->>D: ReconstructionRecords, AuditLog rows, processed DatasetVersion (v2)
  loop poll 1.2s → 5s
    B->>A: GET /analysis/jobs/:id
    A-->>B: status, progress, summary
  end
  B->>A: GET /reports/:job/reconstruction | /processed (CSV)
```

## MARE pipeline

```mermaid
flowchart TD
  S[Per sensor: sort by time, drop duplicate timestamps] --> G[Find gaps]
  G --> E{Interior gap<br/>and ≤ max_gap?}
  E -- no --> K[skipped: no extrapolation / too long]
  E -- yes --> O{Observed fraction<br/>≥ minimum?}
  O -- no --> AB[abstained]
  O -- yes --> EL[Eligible methods by minimum evidence]
  EL --> H[Holdout validation on OBSERVED values<br/>same gap-length class, calibration period only]
  H --> SEL[Pick lowest holdout RMSE<br/>ties within 2% → simpler method]
  SEL --> UN[Empirical interval from holdout residuals]
  UN --> GATE{Interval width gate<br/>and residual count OK?}
  GATE -- no --> AB
  GATE -- yes --> OUT[reconstructed + full decision record]
```

## Database ER diagram

```mermaid
erDiagram
  USER ||--o{ DATASET : owns
  DATASET ||--|{ DATASET_VERSION : has
  DATASET ||--o{ ANALYSIS_JOB : analysed_by
  ANALYSIS_JOB ||--o{ QUALITY_ISSUE : produces
  ANALYSIS_JOB ||--o{ RECONSTRUCTION_RECORD : produces
  ANALYSIS_JOB ||--o| MODEL_EVALUATION : produces
  ANALYSIS_JOB |o--o| DATASET_VERSION : creates_processed
  DATASET ||--o{ AUDIT_LOG : traced_by
  USER ||--o{ AUDIT_LOG : performed
  ANALYSIS_JOB ||--o{ AUDIT_LOG : context
```

## Schema notes (`backend/src/models/index.js`)

| Collection | Purpose | Key fields / indexes |
|---|---|---|
| `User` | Account | unique `email`; `passwordHash` (`select:false`, bcrypt cost 12); `role` researcher\|admin; `preferences` |
| `Dataset` | One upload | `owner` (indexed), `storagePath` (relative, random name), `sha256`, `columns`, `mapping`, `isSynthetic`, `truthPath`, cached `profile`; index `{owner, createdAt}` |
| `DatasetVersion` | Version chain | `{dataset, version}` unique; `kind` original\|processed; `parentVersion`; `job` |
| `AnalysisJob` | Lifecycle of one run | `type`, `params`, `status`, `progress`, `stage`, small `summary`, `error`, timings; index `{dataset, type, createdAt}` |
| `QualityIssue` | One finding per row | `job`, `rowId`, `column`, `category`, `severity`, `method`, `detectedBy`, `reviewStatus` (unreviewed / confirmed_error / dismissed), optional lat/lon |
| `ReconstructionRecord` | One missing value's outcome | `originalValue` (always null: it was missing), `reconstructedValue`, `method`, `status` (reconstructed / abstained / skipped), `evidence`, `uncertainty`, `limitations`, `algorithmVersion`, `reviewStatus` |
| `ModelEvaluation` | Benchmark output | `summaryTable`, `verdict`, full `results`; unique per job |
| `AuditLog` | Append-only history | `action`, `observationState` (original / flagged / reconstructed / manually_reviewed), `rowId`, `column`, `method`, `originalValue`, `newValue`, `uncertainty`, `algorithmVersion`, `datasetVersion`, `job`, `user`; update/delete hooks throw |

**Storage strategy.** No document grows with dataset size: CSV files live on disk (referenced by relative path), per-row results are separate small documents inserted in chunks of 500–1000, and `AnalysisJob.summary` holds only aggregates. Issue storage is capped at 100,000 per job and flagged as truncated.

**Original data is immutable.** Version 1 is the uploaded file. Reconstruction writes a *new* file (version ≥ 2) that keeps every original column byte-for-byte and adds `<var>__estimated`, `__interval_low/high`, `__recovery_method`, `__recovery_status`, and `is_estimated_<var>`.

## Row identifiers

`row_id` is the zero-based position of the data row in the uploaded CSV (blank lines skipped). The backend and ML service use the same definition, so issues, records, map points and audit entries all refer to the same row.
