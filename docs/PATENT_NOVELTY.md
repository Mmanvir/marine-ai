# Patent Research and Novelty Assessment

> **Status: not started.** No prior-art search has been performed for this project. Nothing below is a finding, and nothing here should be read as a claim that MarineTrace AI or MARE is novel, inventive, or patentable. This document is a *plan* and a list of *hypotheses*. It deliberately contains no patent numbers, citations, publications or experimental results other than what the repository itself measured (see [EVALUATION.md](EVALUATION.md)).

## 1. Why this matters
Every individual component (interpolation, robust statistics, Isolation Forest, iterative imputation, holdout validation, audit logging) is long established. Whether a *particular combination or workflow* is new, and whether it would be patentable at all in your jurisdiction (software and algorithm patentability differ widely between countries), can only be decided by a documented prior-art search and advice from a qualified patent attorney or your institution's technology-transfer office.

## 2. Search terms (start here, then widen)
Combine with Boolean operators and synonyms; record every query and date.

| Theme | Example terms |
|---|---|
| Domain | oceanographic OR marine OR "sea surface temperature" OR buoy OR "in situ" |
| Gap filling | "missing data" OR gap-filling OR imputation OR reconstruction OR interpolation, "time series" |
| Method selection | "method selection" OR "model selection" OR "adaptive selection" OR "meta-learning" OR "algorithm selection" |
| Uncertainty | "prediction interval" OR "uncertainty quantification" OR "conformal" OR "bootstrap" OR "empirical interval" |
| Abstention | abstain OR "reject option" OR "selective prediction" OR "confidence threshold" |
| Quality control | "quality control" OR "quality assurance" OR "anomaly detection" OR outlier, "sensor data" |
| Provenance | "audit trail" OR provenance OR lineage OR "data versioning" |
| Related named techniques to look up | DINEOF, kriging / optimal interpolation, Gaussian-process regression, multiple imputation by chained equations, real-time ocean-observation QC manuals (e.g. QARTOD-style tests) |

## 3. Where and how to search
**Patents** (free): Google Patents; Espacenet (EPO); WIPO PATENTSCOPE; USPTO Patent Public Search; for India, the Indian Patent Office search tools (InPASS). Steps: (1) run keyword queries from section 2; (2) open the most relevant hits and note their **CPC classification codes** using the official CPC browser; (3) re-search by those classes to find documents that use different vocabulary; (4) follow forward and backward citations; (5) record publication numbers, dates and what each document does and does not disclose, in a table you maintain yourself.
**Scientific literature:** Google Scholar, Web of Science / Scopus (via your library), arXiv, Copernicus journals, and ocean-data agency technical manuals. Search for gap filling in satellite and in-situ ocean data, automated QC of oceanographic sensors, and uncertainty in imputation. Read the papers and cite only what you have actually read.
**Open-source prior art:** also search GitHub and package indexes (scikit-learn, `fancyimpute`-style libraries, time-series imputation toolkits); public code is prior art too.

## 4. Potentially differentiating features (hypotheses only)
These are the design choices that *might* distinguish MARE from textbook gap filling. Each must be tested against the literature; many may already exist.

| # | Hypothesis | Why it might matter | How it could fail |
|---|---|---|---|
| H1 | Choosing the recovery method **per gap**, from holdout errors measured on the same series and the same gap-length class, using only observed values | Per-gap adaptivity with leakage control | Standard algorithm-selection / model-selection by cross-validation |
| H2 | **Abstention** as a first-class outcome, gated on holdout evidence and relative interval width | Prevents low-evidence fills | "Reject option" and selective prediction are well known |
| H3 | Coupling method choice, empirical intervals and abstention in one **audited decision record** per value | Traceability of each estimate | Components are individually common; the combination may be obvious |
| H4 | Distinguishing observed / flagged / reconstructed / manually-reviewed states in an append-only log tied to dataset versions | Scientific data provenance | Data-lineage tools exist |
| H5 | Exclusion of candidate methods with high holdout failure rate to avoid survivorship bias | Fairer selection | Likely routine in careful practice |

**The repository's own measurements do not support H1 as a performance advantage:** on the included synthetic data MARE was not better than the best fixed method in any scenario ([EVALUATION.md](EVALUATION.md)). Any novelty argument would therefore have to rest on something other than accuracy, and that argument would be weak without evidence.

## 5. Comparison against known approaches (to be completed from your search)
| Approach family | What it does | Overlap with MARE | Unchecked questions |
|---|---|---|---|
| Interpolation (linear, spline, time-based) | Fills between neighbours | Used directly as MARE candidates | None: standard |
| Statistical / EOF-based gap filling (e.g. DINEOF), kriging, GP regression | Exploits spatial/temporal covariance | Not implemented here; MARE is single-series | Would a spatial method dominate? |
| Chained-equation / iterative imputers | Model-based multivariate imputation | Used as a candidate (`IterativeImputer`) | – |
| Automated sensor QC rule sets | Flag suspect values | Overlaps the quality checks | Which rules are standard for your variables? |
| Conformal / bootstrap intervals | Calibrated prediction intervals | MARE's intervals are **not** calibrated | Would conformal methods replace the empirical interval? |
| Algorithm selection / meta-learning | Chooses a model per task | Overlaps H1 | Is per-gap selection published for time-series imputation? |

## 6. Unresolved novelty questions
1. Has per-gap holdout-based method selection with abstention been published or patented for sensor or ocean time series?
2. Is an audit-trail design with the four observation states disclosed in existing data-QA products?
3. Would a spatial or multivariate baseline outperform everything implemented here, making single-series MARE irrelevant for real data?
4. Do the empirical intervals ever reach nominal coverage on *real* data? (Only synthetic data has been tested.)
5. What would be claimed, in which jurisdiction, and is it even eligible subject matter there?

## 7. Warnings
* **Do not describe MARE or MarineTrace AI as novel, innovative in a legal sense, patented, patentable or "patent-pending"** in the report, slides or README unless a proper search and legal assessment support it.
* **Public disclosure can destroy patent rights in many jurisdictions.** Presenting, publishing or posting the code before consulting an attorney may count as disclosure. Ask first if patenting is a goal.
* A search by a student, an AI assistant, or this document is **not** a freedom-to-operate or patentability opinion.
* Cite only sources you have read. Never copy citations from an AI tool without verifying that each exists.

## 8. Suggested record-keeping
Keep a spreadsheet: `date · database · query · hits reviewed · relevant documents (number, title, date, owner) · what it discloses · difference from MARE`. Attach it to the final capstone report.
