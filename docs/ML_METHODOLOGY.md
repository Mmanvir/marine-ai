# ML methodology

All code is in `ml-service/app/`. Nothing here claims novelty; MARE is a transparent, testable *combination* of standard components.

## 1. Typing and identifiers (`schema.py`)
Columns are mapped to a canonical schema, then coerced: unparseable timestamps and non-numeric strings become NaN **and are recorded** as `invalid_timestamp` / `non_numeric_value` issues. `row_id` = zero-based row position in the upload. The raw frame is never altered.

## 2. Data quality (`quality/checks.py`)
Missing values · exact duplicate rows · duplicate `(sensor, timestamp)` with different values · latitude/longitude out of range · invalid timestamps · non-numeric values · constant runs (default ≥ 6 identical readings) · irregular sampling (interval CV > 0.5) · delayed observations (only if an expected interval is supplied) · user-configured valid ranges and cross-variable rules.

* **No universal physical limits** are applied (valid SST depends on place, depth and season). Range and cross-variable rules exist only when the user configures them.
* Every issue has row, column, category, severity, explanation, detection method, recommended action.
* Statistical outliers are `suspected_anomaly`, with the explanation "NOT confirmed as an error"; a human can later mark them *confirmed_error* or *dismissed*.
* **Quality score** = 100 − missing% (of variable cells) − flagged-row% (floored at 0). It is a descriptive heuristic, labelled as such, not a validated metric.

## 3. Anomaly detection (`anomaly/detectors.py`)
Both detectors work per sensor on time-ordered data and score each point against a **two-sided local baseline**: the median of its neighbours (the point itself excluded), requiring ≥ 2 observed neighbours on each side within a window. Series edges and points beside long gaps therefore cannot be scored (documented limitation). An earlier version used a centred rolling median that included the point and truncated at the edges; it produced edge false positives on trending data, and was replaced after a test caught it.

1. **Robust MAD**: residual from the local baseline → robust z = 0.6745·(r − median)/MAD; flag |z| > threshold (default 3.5). If MAD = 0 it falls back to mean absolute deviation; a truly flat series yields no flags.
2. **Isolation Forest** (scikit-learn): features = local deviation, absolute jump from previous value, level. `contamination` is the user-set expected anomaly share.

`compare_detectors` reports flags per method, overlap (both / only-X) and Jaccard, plus precision/recall/F1 when labelled ground truth exists (synthetic only).

## 4. Recovery methods (`recovery/methods.py`)
All fill **interior** gaps only, per sensor, after sorting by time; none extrapolates.

| Method | Idea | Min. observations |
|---|---|---|
| `linear` | Linear in sample index | 2 |
| `time` | Linear in elapsed time (right for irregular sampling) | 2 |
| `rolling` | Centred rolling median (window 11, ≥ 3 values) | 3 |
| `iterative` | scikit-learn `IterativeImputer` (BayesianRidge) on previous/next observed value, time-to-neighbours, hour-of-day, and co-observed variables. Context features use only *other* rows' values. | 30 |

## 5. Uncertainty (`uncertainty/intervals.py`)
**Time-series holdout validation:** hide windows of *observed* values with the same length class as the target gap (power-of-two buckets), reconstruct with the method using only the remaining data, and collect errors (truth − estimate). With ≥ 30 residuals, the interval offsets are the empirical α/2 and 1−α/2 quantiles; otherwise the estimate is explicitly **unavailable**.

* It is an *empirical, method-specific prediction interval*, labelled `calibrated: false`.
* Reported alongside: holdout MAE, RMSE, bias, residual count, failure rate.
* Whether intervals reach their nominal coverage is **measured separately** by the benchmark on hidden test gaps — and in the included run they did not always (docs/EVALUATION.md).
* No low/moderate/high labels are shown because no justified thresholds exist.

## 6. MARE selection policy (`recovery/pipeline.py`)
1. Skip gaps without observations on both sides, or longer than `max_gap`.
2. **Abstain** if the sensor's observed fraction < `min_obs_fraction`.
3. Eligible methods = those whose minimum-evidence requirement is met.
4. Score each by holdout RMSE for this gap-length bucket (calibration period only when benchmarking, so no future leakage). Methods whose holdout failure rate exceeds 10 % are excluded (their RMSE over successes would be survivorship-biased).
5. Choose the lowest RMSE; methods within 2 % are tied and the simpler one (list order linear → time → rolling → iterative) wins.
6. **Abstain** if nothing has enough evidence, or if (optionally) interval half-width / robust series spread exceeds `max_relative_halfwidth`.
7. Record candidates, scores, reasons, evidence, limitations, algorithm version for every value.

Hypothesis under test: *choosing per gap from holdout evidence beats any single fixed method.* On the included synthetic data the hypothesis was **not supported** (docs/EVALUATION.md).

## 7. Known limitations
* Holdout windows come from the same series, so sparse series have little evidence.
* Windows overlap neither each other nor the target gap, but they share the series' dynamics: leakage is controlled, not eliminated.
* Iterative imputation is time-agnostic beyond the engineered features; no seasonal model; no spatial interpolation across sensors.
* Robust-z and Isolation Forest thresholds are defaults, not tuned per variable.
* Only numeric time series; no NetCDF.
