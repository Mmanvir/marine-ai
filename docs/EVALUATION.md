# Evaluation

Everything here is produced by running code. Regenerate with:

```bash
python scripts/generate_synthetic.py --seed 42
python scripts/run_benchmark.py --seed 42 --repeats 3      # writes results/benchmark_seed42.{json,csv,md}
```
The committed `results/` files were re-generated during packaging: the markdown report was **identical** apart from the runtime column, and regenerating the synthetic CSV with seed 42 gave a byte-identical file.

## Protocol (`ml-service/app/evaluation/benchmark.py`)
* **Reference:** the complete synthetic series *without* injected defects (its ground truth), so hidden values have known truth. On user data the reference is the observed values themselves.
* **Temporal split:** the boundary is the 60th percentile of timestamps. Hidden test values are placed only **after** it. Method selection and interval calibration (holdout validation) may use only observations **before** it.
* **Hiding:** hidden values are removed from the input *before* any method runs and are used only for scoring.
* **Scenarios:** `random` (isolated points), `contiguous_short` (2-5 samples), `contiguous_long` (12-24 samples), each repeated with different mask seeds (3 here).
* **Methods:** linear, time-based, rolling median, iterative imputer (fixed baselines) and MARE.
* **Metrics:** MAE, RMSE, bias, % reconstructed, prediction-interval coverage and width, runtime, RMSE by gap length. Because MARE can abstain, methods are **also compared on the common subset** of values that every method reconstructed, so abstention cannot flatter or penalise a method.
* **Detection:** both detectors are run on the *observed* data (with spikes) and scored against the injected-spike labels.

## Measured results (synthetic data, generator seed 42, mask seed 7, 3 repeats)

| Scenario | MARE RMSE (common subset) | Best fixed method | Best fixed RMSE | Difference | Outcome |
|---|---|---|---|---|---|
| random | 0.0470 | iterative | 0.0461 | +2.0 % | MARE not better |
| contiguous_short | 0.0974 | time | 0.0972 | +0.2 % | MARE not better |
| contiguous_long | 0.2808 | linear | 0.2399 | +17.1 % | MARE not better |

Other observations (full table in `results/benchmark_seed42.md`):
* The rolling median is the weakest baseline; on long gaps it reconstructed only 37 % of the hidden values.
* Nominal-90 % intervals achieved MARE coverage of 0.84 (random), 0.94 (short), 0.98 (long): **not calibrated**; too narrow for isolated points, conservative for long gaps.
* Detection of 18 injected spikes: both detectors recall 1.0; robust MAD precision 0.69 (8 false positives), Isolation Forest precision 0.46 (21 false positives).

## How to read this honestly
* The adaptive method **did not outperform** the best fixed baseline in this experiment. The hypothesis "per-gap selection beats any single fixed method" is **not supported** by this data.
* This is one synthetic dataset, one generator seed and three masks. It supports **no general conclusion** about real oceans. Synthetic series built from smooth sinusoids plus AR noise favour simple interpolation.
* On long gaps MARE's choice was worse than always picking linear. A plausible reason (not tested): holdout windows come from earlier, different conditions, so the evidence it selects on does not transfer; confirm before believing it.
* No statistical test is reported; the differences for random and short gaps (≤ 2 %) are within what you would expect from mask randomness.

## Ideas to test next
More seeds and generators with real structure; real NDBC series via `scripts/import_ndbc.py`; confidence intervals over many masks; conformal calibration of intervals; spatial/multivariate baselines; tuning the tie tolerance and holdout size.

## Assumptions and edge cases
Interior gaps only; max gap 24 samples; abstention when < 30 holdout residuals; duplicate timestamps keep the first row; sensors never mixed; series with < 100 observed values cannot be benchmarked (`insufficient_data`).
