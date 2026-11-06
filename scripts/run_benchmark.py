#!/usr/bin/env python3
"""Run the reproducible benchmark offline (no web stack needed) and write result tables.

    python scripts/run_benchmark.py --seed 42 --repeats 3

Reads data/synthetic/marine_synthetic*.csv (generate them first with generate_synthetic.py),
hides known ground-truth values, scores every method, and writes into results/:
  benchmark_seed<seed>.json   full machine-readable results
  benchmark_seed<seed>.csv    summary table
  benchmark_seed<seed>.md     human-readable tables (the numbers quoted in docs/EVALUATION.md)
Every number is computed by this run; nothing is hard-coded.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml-service"))

import pandas as pd  # noqa: E402

from app.evaluation.benchmark import BenchConfig, clean_reference_frame, evaluate  # noqa: E402
from app.schema import prepare  # noqa: E402


def fmt(v, d=4):
    return "—" if v is None else f"{v:.{d}f}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=42, help="seed used when the synthetic data was generated (for file naming)")
    ap.add_argument("--mask-seed", type=int, default=7)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--variable", default="sea_surface_temperature")
    ap.add_argument("--data-dir", default=str(ROOT / "data" / "synthetic"))
    ap.add_argument("--out-dir", default=str(ROOT / "results"))
    a = ap.parse_args()

    data = Path(a.data_dir)
    obs_p, truth_p = data / "marine_synthetic.csv", data / "marine_synthetic_truth.csv"
    if not obs_p.exists() or not truth_p.exists():
        print("Synthetic data not found. Run: python scripts/generate_synthetic.py", file=sys.stderr)
        return 1
    truth_col = {"sea_surface_temperature": "truth_sst", "salinity": "truth_salinity"}.get(a.variable)
    if truth_col is None:
        print(f"No ground-truth column known for {a.variable}", file=sys.stderr)
        return 1

    typed, _ = prepare(pd.read_csv(obs_p, dtype=str))
    ref, spikes = clean_reference_frame(typed, pd.read_csv(truth_p), a.variable, truth_col)
    t0 = time.perf_counter()
    res = evaluate(ref, a.variable, BenchConfig(n_repeats=a.repeats, seed=a.mask_seed), spike_rows=spikes, detection_df=typed)
    res["wall_seconds"] = time.perf_counter() - t0
    res["reference_source"] = "SYNTHETIC ground truth (complete series without injected defects)"
    if res.get("status") != "ok":
        print(res, file=sys.stderr)
        return 1

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stem = f"benchmark_seed{a.seed}"
    (out / f"{stem}.json").write_text(json.dumps(res, indent=1, default=str))
    cols = ["scenario", "method", "pct_reconstructed", "mae", "rmse", "bias", "common_rmse", "pi_coverage", "pi_width", "runtime_s"]
    with open(out / f"{stem}.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(res["summary_table"])

    lines = [f"# Benchmark results ({stem})", "",
             f"Data: SYNTHETIC, generator seed {a.seed}; mask seed {a.mask_seed}; {a.repeats} repeats; variable `{a.variable}`.",
             f"Temporal boundary (calibration before, hidden test after): {res['boundary']}", "",
             "## Per-scenario results (all hidden values each method reconstructed)", "",
             "| Scenario | Method | % reconstructed | MAE | RMSE | Bias | PI coverage | PI width | Runtime (s) |", "|---|---|---|---|---|---|---|---|---|"]
    for r in res["summary_table"]:
        lines.append(f"| {r['scenario']} | {r['method']} | {fmt(r['pct_reconstructed'], 1)} | {fmt(r['mae'])} | {fmt(r['rmse'])} | {fmt(r['bias'])} | "
                     f"{fmt(r['pi_coverage'], 3)} | {fmt(r['pi_width'], 3)} | {fmt(r['runtime_s'], 3)} |")
    lines += ["", "## MARE vs best fixed method (common subset, RMSE)", "",
              "| Scenario | Compared values | MARE | Best fixed | Best fixed RMSE | Relative difference | Result |", "|---|---|---|---|---|---|---|"]
    for v in res["verdict"]:
        if "mare_rmse" not in v:
            lines.append(f"| {v['scenario']} | — | — | — | — | — | {v['result']} |")
            continue
        lines.append(f"| {v['scenario']} | {v['n_common']} | {fmt(v['mare_rmse'])} | {v['best_fixed']} | {fmt(v['best_fixed_rmse'])} | "
                     f"{v['relative_difference'] * 100:+.1f}% | {v['result']} |")
    ad = res.get("anomaly_detection")
    if ad:
        lines += ["", "## Anomaly detection vs injected spikes", "", "| Detector | TP | FP | FN | Precision | Recall | F1 |", "|---|---|---|---|---|---|---|"]
        for k, name in (("mad", "Robust MAD"), ("isolation_forest", "Isolation Forest")):
            m = ad[k]["metrics"]
            lines.append(f"| {name} | {m['tp']} | {m['fp']} | {m['fn']} | {fmt(m['precision'], 3)} | {fmt(m['recall'], 3)} | {fmt(m['f1'], 3)} |")
    (out / f"{stem}.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nWrote {out / (stem + '.json')} (+ .csv, .md) in {res['wall_seconds']:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
