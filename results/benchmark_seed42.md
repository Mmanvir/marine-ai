# Benchmark results (benchmark_seed42)

Data: SYNTHETIC, generator seed 42; mask seed 7; 3 repeats; variable `sea_surface_temperature`.
Temporal boundary (calibration before, hidden test after): 2024-03-19T00:13:48+00:00

## Per-scenario results (all hidden values each method reconstructed)

| Scenario | Method | % reconstructed | MAE | RMSE | Bias | PI coverage | PI width | Runtime (s) |
|---|---|---|---|---|---|---|---|---|
| random | linear | 100.0 | 0.0387 | 0.0482 | -0.0001 | 0.851 | 0.147 | 0.030 |
| random | time | 100.0 | 0.0378 | 0.0475 | -0.0008 | 0.859 | 0.141 | 0.031 |
| random | rolling | 100.0 | 0.0932 | 0.1180 | 0.0056 | 0.807 | 0.331 | 0.036 |
| random | iterative | 100.0 | 0.0373 | 0.0461 | 0.0017 | 0.835 | 0.139 | 0.225 |
| random | mare | 100.0 | 0.0374 | 0.0470 | 0.0006 | 0.843 | 0.141 | 0.255 |
| contiguous_short | linear | 100.0 | 0.0761 | 0.0974 | -0.0037 | 0.935 | 0.389 | 0.049 |
| contiguous_short | time | 100.0 | 0.0757 | 0.0972 | -0.0034 | 0.923 | 0.389 | 0.052 |
| contiguous_short | rolling | 100.0 | 0.1926 | 0.2189 | -0.0074 | 0.943 | 0.775 | 0.059 |
| contiguous_short | iterative | 100.0 | 0.1065 | 0.1276 | -0.0045 | 0.912 | 0.501 | 0.585 |
| contiguous_short | mare | 100.0 | 0.0761 | 0.0974 | -0.0037 | 0.935 | 0.389 | 0.682 |
| contiguous_long | linear | 100.0 | 0.3565 | 0.4325 | 0.0973 | 0.981 | 1.678 | 0.030 |
| contiguous_long | time | 100.0 | 0.3565 | 0.4326 | 0.0976 | 0.981 | 1.677 | 0.032 |
| contiguous_long | rolling | 37.0 | 0.2969 | 0.3429 | 0.0255 | 0.895 | 1.038 | 0.035 |
| contiguous_long | iterative | 100.0 | 0.3759 | 0.4443 | 0.0857 | 0.981 | 1.642 | 0.331 |
| contiguous_long | mare | 100.0 | 0.3669 | 0.4385 | 0.0924 | 0.981 | 1.650 | 0.384 |

## MARE vs best fixed method (common subset, RMSE)

| Scenario | Compared values | MARE | Best fixed | Best fixed RMSE | Relative difference | Result |
|---|---|---|---|---|---|---|
| random | 249 | 0.0470 | iterative | 0.0461 | +2.0% | mare_not_better |
| contiguous_short | 261 | 0.0974 | time | 0.0972 | +0.2% | mare_not_better |
| contiguous_long | 114 | 0.2808 | linear | 0.2399 | +17.1% | mare_not_better |

## Anomaly detection vs injected spikes

| Detector | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| Robust MAD | 18 | 8 | 0 | 0.692 | 1.000 | 0.818 |
| Isolation Forest | 18 | 21 | 0 | 0.462 | 1.000 | 0.632 |
