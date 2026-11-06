"""Reproducible benchmark of recovery methods against hidden reference values.

Protocol
--------
* Reference series: observed (or ground-truth) values of one variable. Existing
  NaNs stay NaN and are never used as targets.
* Temporal split per run: values before ``boundary`` (default: 60th percentile of
  timestamps) form the calibration period (method selection and interval
  calibration by holdout validation use ONLY this period); hidden test values
  are placed only after the boundary. Hidden values are removed from the input
  before any method sees the data, and are used only to score.
* Scenarios: ``random`` isolated points, ``contiguous_short`` (2-5 samples),
  ``contiguous_long`` (12-24 samples). Repeated with different mask seeds.
* Methods: linear, time, rolling, iterative (fixed baselines) and MARE.
* Metrics: MAE, RMSE, bias, % of hidden values reconstructed, prediction-interval
  coverage and width, runtime, plus a breakdown by gap length. Because MARE may
  abstain, all methods are also scored on the subset of hidden values that every
  method reconstructed ("common subset"), which removes selection bias.
Nothing is hard-coded: every number comes from running this code on the data.
"""
from __future__ import annotations

import time
import zlib
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .. import ALGORITHM_VERSION
from ..recovery.methods import METHODS
from ..recovery.pipeline import ReconConfig, reconstruct
from ..uncertainty.intervals import HoldoutConfig

ALL_METHODS = [*METHODS, "mare"]
SCENARIOS = {
    "random": {"lengths": (1, 1)},
    "contiguous_short": {"lengths": (2, 5)},
    "contiguous_long": {"lengths": (12, 24)},
}
GAP_BUCKETS = [("short_1-3", 1, 3), ("medium_4-11", 4, 11), ("long_12+", 12, 10_000)]


@dataclass
class BenchConfig:
    scenarios: tuple[str, ...] = ("random", "contiguous_short", "contiguous_long")
    methods: tuple[str, ...] = tuple(ALL_METHODS)
    n_repeats: int = 3
    seed: int = 7
    train_fraction: float = 0.6
    target_missing_fraction: float = 0.10  # of test-period reference values per sensor
    max_gap: int = 24
    holdout: HoldoutConfig = field(default_factory=HoldoutConfig)


def _make_mask(df: pd.DataFrame, column: str, scenario: str, boundary: pd.Timestamp,
               rng: np.random.Generator, target_fraction: float) -> list[tuple[int, int, int]]:
    """Return hidden windows as (df_index_start_pos_in_sensor_order, length, sensor_idx)."""
    lo, hi = SCENARIOS[scenario]["lengths"]
    windows: list[np.ndarray] = []
    groups = df.groupby("sensor_id", dropna=False) if "sensor_id" in df else [(None, df)]
    for _, g in groups:
        g = g.dropna(subset=["timestamp"]).sort_values(["timestamp", "row_id"])
        g = g.drop_duplicates(subset=["timestamp"], keep="first")
        idx = g.index.to_numpy()
        obs = g[column].notna().to_numpy()
        in_test = (g["timestamp"] >= boundary).to_numpy()
        n = len(g)
        n_test_obs = int((obs & in_test).sum())
        budget = int(target_fraction * n_test_obs)
        used = np.zeros(n, dtype=bool)
        tries = 0
        hidden = 0
        while hidden < budget and tries < 2000:
            tries += 1
            L = int(rng.integers(lo, hi + 1))
            st = int(rng.integers(1, max(2, n - L - 1)))
            seg = slice(st - 1, st + L + 1)  # include one neighbour each side
            if (st + L) >= n - 1 or not in_test[st:st + L].all():
                continue
            if not obs[seg].all() or used[max(0, st - 2): st + L + 2].any():
                continue
            used[st:st + L] = True
            windows.append(idx[st:st + L])
            hidden += L
    return windows


def _gap_bucket(L: int) -> str:
    for name, a, b in GAP_BUCKETS:
        if a <= L <= b:
            return name
    return GAP_BUCKETS[-1][0]


def _metrics(rows: list[dict], n_hidden: int) -> dict[str, Any]:
    got = [r for r in rows if r["est"] is not None]
    out: dict[str, Any] = {"n_hidden": n_hidden, "n_reconstructed": len(got),
                           "pct_reconstructed": (100 * len(got) / n_hidden) if n_hidden else None}
    if not got:
        out.update(mae=None, rmse=None, bias=None, pi_coverage=None, pi_width=None, n_with_interval=0)
        return out
    err = np.array([r["truth"] - r["est"] for r in got])
    out.update(mae=float(np.mean(np.abs(err))), rmse=float(np.sqrt(np.mean(err ** 2))), bias=float(np.mean(-err)))
    iv = [r for r in got if r["low"] is not None]
    out["n_with_interval"] = len(iv)
    if iv:
        out["pi_coverage"] = float(np.mean([r["low"] <= r["truth"] <= r["high"] for r in iv]))
        out["pi_width"] = float(np.mean([r["high"] - r["low"] for r in iv]))
    else:
        out["pi_coverage"] = out["pi_width"] = None
    return out


def evaluate(df: pd.DataFrame, column: str, cfg: BenchConfig | None = None,
             spike_rows: set[int] | None = None, detection_df: pd.DataFrame | None = None) -> dict[str, Any]:
    """Run the benchmark on typed frame ``df`` (from ``schema.prepare``).

    ``spike_rows`` are labelled anomaly row_ids that exist in the *observed* data, so detection must be
    scored on ``detection_df`` (the observed frame, defects included), never on the clean reference ``df``.
    """
    cfg = cfg or BenchConfig()
    if column not in df.columns or "timestamp" not in df.columns:
        raise ValueError("Evaluation requires the variable column and timestamp")
    ref = df.dropna(subset=["timestamp"])
    if ref[column].notna().sum() < 100:
        return {"status": "insufficient_data",
                "message": "At least 100 observed reference values are required to evaluate.",
                "algorithm_version": ALGORITHM_VERSION}
    ts = ref["timestamp"]
    boundary = ts.quantile(cfg.train_fraction)
    truth_all = df.set_index("row_id")[column]

    results: dict[str, Any] = {"status": "ok", "algorithm_version": ALGORITHM_VERSION, "variable": column,
                               "boundary": boundary.isoformat(), "protocol": __doc__.strip().split("\n")[0],
                               "config": {"n_repeats": cfg.n_repeats, "seed": cfg.seed, "scenarios": list(cfg.scenarios),
                                          "train_fraction": cfg.train_fraction, "max_gap": cfg.max_gap,
                                          "target_missing_fraction": cfg.target_missing_fraction},
                               "scenarios": {}}
    for sc in cfg.scenarios:
        per_method_rows: dict[str, list[dict]] = {m: [] for m in cfg.methods}
        runtimes: dict[str, list[float]] = {m: [] for m in cfg.methods}
        n_hidden_total = 0
        for rep in range(cfg.n_repeats):
            rng = np.random.default_rng(cfg.seed + 1000 * rep + zlib.crc32(sc.encode()) % 997)
            wins = _make_mask(df, column, sc, boundary, rng, cfg.target_missing_fraction)
            if not wins:
                continue
            hidden_idx = np.concatenate(wins)
            win_len = {int(i): len(w) for w in wins for i in w}
            masked = df.copy()
            truth_vals = df.loc[hidden_idx, column].to_numpy()
            rid = df.loc[hidden_idx, "row_id"].to_numpy()
            masked.loc[hidden_idx, column] = np.nan  # hidden values removed before any method runs
            n_hidden_total += len(hidden_idx)
            for m in cfg.methods:
                rc = ReconConfig(method=m, max_gap=cfg.max_gap, attach_uncertainty=True,
                                 holdout=cfg.holdout, calibration_end=boundary)
                t0 = time.perf_counter()
                out = reconstruct(masked, column, rc)
                runtimes[m].append(time.perf_counter() - t0)
                by_row = {r["row_id"]: r for r in out["records"]}
                for k, (r_id, tv, di) in enumerate(zip(rid, truth_vals, hidden_idx)):
                    rec = by_row.get(int(r_id))
                    est = rec["reconstructed_value"] if rec and rec["status"] == "reconstructed" else None
                    iv = (rec["uncertainty"].get("interval") if rec and est is not None
                          and rec["uncertainty"].get("available") else None)
                    per_method_rows[m].append({
                        "key": (rep, int(r_id)), "truth": float(tv), "est": est,
                        "low": iv["low"] if iv else None, "high": iv["high"] if iv else None,
                        "gap": win_len[int(di)], "method_used": rec["method"] if rec else None,
                        "status": rec["status"] if rec else "missing_record",
                    })
        if n_hidden_total == 0:
            results["scenarios"][sc] = {"status": "no_valid_windows"}
            continue
        common = set.intersection(*[{r["key"] for r in rows if r["est"] is not None}
                                    for rows in per_method_rows.values()])
        sc_out: dict[str, Any] = {"n_hidden": n_hidden_total, "n_common": len(common), "methods": {}}
        for m, rows in per_method_rows.items():
            entry = {
                "overall": _metrics(rows, len(rows)),
                "common_subset": _metrics([r for r in rows if r["key"] in common], len(common)),
                "by_gap_length": {},
                "runtime_seconds_mean": float(np.mean(runtimes[m])) if runtimes[m] else None,
                "status_counts": _counts(rows, "status"),
            }
            if m == "mare":
                entry["method_selection_counts"] = _counts([r for r in rows if r["est"] is not None], "method_used")
            for name, a, b in GAP_BUCKETS:
                sub = [r for r in rows if a <= r["gap"] <= b]
                if sub:
                    entry["by_gap_length"][name] = _metrics(sub, len(sub))
            sc_out["methods"][m] = entry
        results["scenarios"][sc] = sc_out

    results["summary_table"] = _table(results)
    results["verdict"] = _verdict(results)
    if spike_rows is not None:
        if detection_df is None:
            raise ValueError("spike_rows requires detection_df (the observed data containing the labelled spikes)")
        from ..anomaly.detectors import compare_detectors
        results["anomaly_detection"] = {k: v for k, v in
                                        compare_detectors(detection_df, column, truth_rows=spike_rows).items() if k != "scores"}
    return results


def _counts(rows, key):
    out: dict[str, int] = {}
    for r in rows:
        out[str(r[key])] = out.get(str(r[key]), 0) + 1
    return out


def _table(res: dict) -> list[dict]:
    rows = []
    for sc, d in res["scenarios"].items():
        if "methods" not in d:
            continue
        for m, e in d["methods"].items():
            o, c = e["overall"], e["common_subset"]
            rows.append({"scenario": sc, "method": m, "pct_reconstructed": o["pct_reconstructed"],
                         "mae": o["mae"], "rmse": o["rmse"], "bias": o["bias"],
                         "common_rmse": c["rmse"], "pi_coverage": o["pi_coverage"], "pi_width": o["pi_width"],
                         "runtime_s": e["runtime_seconds_mean"]})
    return rows


def _verdict(res: dict) -> list[dict]:
    """Plain comparison of MARE against the best fixed baseline. No spin."""
    out = []
    for sc, d in res["scenarios"].items():
        if "methods" not in d or "mare" not in d["methods"]:
            continue
        fixed = {m: e["common_subset"]["rmse"] for m, e in d["methods"].items()
                 if m != "mare" and e["common_subset"]["rmse"] is not None}
        mare = d["methods"]["mare"]["common_subset"]["rmse"]
        if not fixed or mare is None:
            out.append({"scenario": sc, "result": "not_comparable"})
            continue
        best_m, best = min(fixed.items(), key=lambda kv: kv[1])
        out.append({"scenario": sc, "n_common": d["n_common"], "mare_rmse": mare, "best_fixed": best_m,
                    "best_fixed_rmse": best,
                    "result": "mare_better" if mare < best else ("tie" if mare == best else "mare_not_better"),
                    "relative_difference": (mare - best) / best if best else None})
    return out


def clean_reference_frame(observed: pd.DataFrame, truth: pd.DataFrame, column: str,
                          truth_column: str) -> tuple[pd.DataFrame, set[int]]:
    """Synthetic-data helper: replace a variable with its clean ground truth.

    ``observed`` is the typed frame (``schema.prepare``); ``truth`` is the
    generator's ground-truth CSV (row aligned). Duplicate records are dropped.
    Returns the reference frame and the set of row_ids that carry injected spikes.
    """
    t = truth.set_index("row_id")
    df = observed.copy()
    df[column] = t.loc[df["row_id"], truth_column].to_numpy()
    dup = t.loc[df["row_id"], "is_duplicate"].to_numpy().astype(bool)
    spikes = {int(r) for r in t.index[t["is_spike"].astype(bool)]}
    return df.loc[~dup].reset_index(drop=True), spikes
