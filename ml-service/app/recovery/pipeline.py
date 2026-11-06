"""Reconstruction pipeline, including MARE (MarineTrace Adaptive Recovery Engine).

MARE policy (documented, testable, no novelty claim):
  1. Per sensor, sort by time, drop duplicate timestamps (first kept, rest reported).
  2. Find gaps. Skip gaps with no observation on both sides (no extrapolation)
     or longer than ``max_gap``.
  3. Gate: abstain if the sensor series is too sparse (``min_obs_fraction``).
  4. Eligible methods = those whose minimum-evidence requirements are met.
  5. Evaluate every eligible method by holdout validation on *observed* values
     (windows of the same length class as the gap, optionally restricted to
     before ``calibration_end``). No hidden ground truth is ever used.
  6. Select the method with the lowest holdout RMSE; methods within 2% of the
     best are treated as tied and the simpler one is preferred.
  7. Abstain if there are too few holdout residuals, or (if configured) the
     interval half-width relative to series spread exceeds the threshold.
  8. Record every decision, including candidates' scores, in the audit trail.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .. import ALGORITHM_VERSION
from ..schema import present_variables
from ..uncertainty.intervals import HoldoutConfig, bucket_length, holdout_errors, summarize_errors
from .methods import METHODS, eligible_methods, fill, find_gaps, sampling_regularity

FIXED_METHODS = list(METHODS)
TIE_TOLERANCE = 0.02
MAX_HOLDOUT_FAILURE_RATE = 0.10

LIMITATIONS = {
    "linear": "Index-based linear interpolation ignores uneven sampling intervals.",
    "time": "Assumes smooth change between the neighbouring observations.",
    "rolling": "Local median smooths real short-term variation.",
    "iterative": "Learned from this series only; can mis-estimate sharp or unseen behaviour.",
}


@dataclass
class ReconConfig:
    method: str = "mare"  # "mare" or one of FIXED_METHODS
    max_gap: int = 24  # samples
    min_obs_fraction: float = 0.5
    max_relative_halfwidth: float | None = None  # halfwidth / robust spread; None = no gate
    attach_uncertainty: bool = True
    holdout: HoldoutConfig = field(default_factory=HoldoutConfig)
    calibration_end: pd.Timestamp | None = None


def _robust_spread(s: pd.Series) -> float:
    x = s.dropna().to_numpy()
    if len(x) < 3:
        return float("nan")
    return float(1.4826 * np.median(np.abs(x - np.median(x))))


def _clean_series(g: pd.DataFrame, column: str):
    """Sort, drop NaT and duplicate timestamps. Returns (frame, excluded rows)."""
    excluded: list[dict] = []
    nat = g["timestamp"].isna()
    for rid in g.loc[nat, "row_id"]:
        excluded.append({"row_id": int(rid), "reason": "invalid_timestamp"})
    g = g.loc[~nat].sort_values(["timestamp", "row_id"], kind="stable")
    dup = g.duplicated(subset=["timestamp"], keep="first")
    for rid in g.loc[dup, "row_id"]:
        excluded.append({"row_id": int(rid), "reason": "duplicate_timestamp"})
    return g.loc[~dup], excluded


def reconstruct(df: pd.DataFrame, column: str, cfg: ReconConfig | None = None) -> dict[str, Any]:
    cfg = cfg or ReconConfig()
    if cfg.method != "mare" and cfg.method not in FIXED_METHODS:
        raise ValueError(f"Unknown method '{cfg.method}'")
    if column not in df.columns:
        raise ValueError(f"Column '{column}' not present")
    if "timestamp" not in df.columns:
        raise ValueError("Reconstruction requires a timestamp column")

    others_cols = [c for c in present_variables(df) if c != column]
    records: list[dict] = []
    excluded_all: list[dict] = []
    series_info: list[dict] = []

    groups = df.groupby("sensor_id", dropna=False) if "sensor_id" in df.columns else [(None, df)]
    for sid, g in groups:
        g, excluded = _clean_series(g, column)
        excluded_all.extend({**e, "sensor_id": None if sid is None else str(sid)} for e in excluded)
        if len(g) == 0:
            continue
        s = pd.Series(g[column].to_numpy(), index=pd.DatetimeIndex(g["timestamp"]), name=column)
        others = pd.DataFrame({c: g[c].to_numpy() for c in others_cols}, index=s.index) if others_cols else None
        rows = g["row_id"].to_numpy()
        obs_frac = float(s.notna().mean())
        reg = sampling_regularity(s)
        series_info.append({"sensor_id": None if sid is None else str(sid), "n": len(s),
                            "observed_fraction": round(obs_frac, 4), "sampling_cv": reg["cv"]})
        gaps = find_gaps(s)
        if not gaps:
            continue

        elig = eligible_methods(s, others)
        fills: dict[str, pd.Series] = {}
        cache: dict[tuple[str, int], dict] = {}
        spread = _robust_spread(s)

        def get_fill(m):
            if m not in fills:
                fills[m] = fill(m, s, others)
            return fills[m]

        def get_unc(m, bucket):
            key = (m, bucket)
            if key not in cache:
                res = holdout_errors(s, m, bucket, others, cfg.holdout, cfg.calibration_end)
                cache[key] = summarize_errors(res, cfg.holdout)
            return cache[key]

        for gap in gaps:
            L = gap["length"]
            positions = range(gap["start"], gap["end"] + 1)
            base_evidence = {
                "gap_length_samples": L,
                "gap_start": s.index[gap["start"]].isoformat(),
                "gap_end": s.index[gap["end"]].isoformat(),
                "n_observed_in_series": int(s.notna().sum()),
                "observed_fraction": round(obs_frac, 4),
                "sampling_cv": reg["cv"],
            }
            if gap["bounded"]:
                lpos, rpos = gap["start"] - 1, gap["end"] + 1
                base_evidence["left_neighbour"] = {"timestamp": s.index[lpos].isoformat(), "value": float(s.iloc[lpos])}
                base_evidence["right_neighbour"] = {"timestamp": s.index[rpos].isoformat(), "value": float(s.iloc[rpos])}

            decision: dict[str, Any] = {"gap_length": L, "candidates": []}
            chosen: str | None = None
            status, reason = "skipped", ""

            if not gap["bounded"]:
                reason = "No observation on both sides of the gap; extrapolation is disabled."
            elif L > cfg.max_gap:
                reason = f"Gap length {L} exceeds configured max_gap {cfg.max_gap}."
            elif cfg.method == "mare" and obs_frac < cfg.min_obs_fraction:
                status = "abstained"
                reason = f"Series observed fraction {obs_frac:.2f} below minimum {cfg.min_obs_fraction}."
            else:
                bucket = bucket_length(L, cfg.max_gap)
                decision["bucket"] = bucket
                if cfg.method == "mare":
                    scored = []
                    for m in METHODS:
                        if elig[m] is not None:
                            decision["candidates"].append({"method": m, "eligible": False, "reason": elig[m]})
                            continue
                        u = get_unc(m, bucket)
                        decision["candidates"].append({
                            "method": m, "eligible": True, "holdout_rmse": u.get("rmse"),
                            "n_residuals": u["n_residuals"], "available": u["available"],
                            **({} if u["available"] else {"reason": u["reason"]}),
                        })
                        if u["available"] and (u.get("holdout_failure_rate") or 0.0) > MAX_HOLDOUT_FAILURE_RATE:
                            # RMSE over successes only would be survivorship-biased: exclude.
                            decision["candidates"][-1].update(
                                available=False,
                                reason=f"holdout failure rate {u['holdout_failure_rate']:.0%} exceeds "
                                       f"{MAX_HOLDOUT_FAILURE_RATE:.0%} for this gap length")
                        elif u["available"]:
                            scored.append((m, u["rmse"]))
                    if not scored:
                        status = "abstained"
                        reason = "No eligible method has enough holdout evidence for this gap length."
                    else:
                        best = min(r for _, r in scored)
                        near = [m for m, r in scored if r <= best * (1 + TIE_TOLERANCE)]
                        chosen = next(m for m in METHODS if m in near)
                        reason = (f"Lowest holdout RMSE among eligible methods (ties within {TIE_TOLERANCE:.0%} "
                                  f"resolved toward the simpler method). Selected '{chosen}'.")
                        status = "reconstructed"
                else:
                    if elig[cfg.method] is not None:
                        reason = f"Fixed method '{cfg.method}' not eligible: {elig[cfg.method]}"
                    else:
                        chosen, status = cfg.method, "reconstructed"
                        reason = f"Fixed method '{cfg.method}' requested by configuration."

            unc: dict[str, Any] | None = None
            if chosen is not None and (cfg.attach_uncertainty or cfg.method == "mare"):
                unc = get_unc(chosen, decision.get("bucket", bucket_length(L, cfg.max_gap)))
                if (cfg.method == "mare" and unc["available"] and cfg.max_relative_halfwidth is not None
                        and np.isfinite(spread) and spread > 0
                        and unc["halfwidth"] / spread > cfg.max_relative_halfwidth):
                    status = "abstained"
                    reason = (f"Interval half-width {unc['halfwidth']:.3g} is {unc['halfwidth'] / spread:.2f}x the "
                              f"series spread, above the acceptance threshold {cfg.max_relative_halfwidth}.")
                    chosen_for_record = chosen
                    chosen = None
                else:
                    chosen_for_record = chosen
            else:
                chosen_for_record = chosen

            decision["status"], decision["reason"] = status, reason
            for p in positions:
                est = None
                if chosen is not None:
                    v = get_fill(chosen).iloc[p]
                    est = None if pd.isna(v) else float(v)
                    if est is None:
                        status_p, reason_p = "skipped", f"Method '{chosen}' produced no value."
                    else:
                        status_p, reason_p = status, reason
                else:
                    status_p, reason_p = status, reason
                interval = None
                if est is not None and unc is not None and unc["available"]:
                    interval = {"low": est + unc["offset_low"], "high": est + unc["offset_high"],
                                "nominal_level": unc["nominal_level"], "calibrated": False}
                records.append({
                    "row_id": int(rows[p]),
                    "sensor_id": None if sid is None else str(sid),
                    "variable": column,
                    "timestamp": s.index[p].isoformat(),
                    "latitude": _opt(g, p, "latitude"),
                    "longitude": _opt(g, p, "longitude"),
                    "original_value": None,
                    "reconstructed_value": est,
                    "method": chosen_for_record if est is not None or status_p == "abstained" else None,
                    "status": status_p,
                    "status_reason": reason_p,
                    "algorithm_version": ALGORITHM_VERSION,
                    "evidence": {**base_evidence, "decision": decision if cfg.method == "mare" else None},
                    "uncertainty": _unc_view(unc, est, interval),
                    "limitations": _limits(chosen_for_record, L, unc),
                })

    summary = {
        "n_missing_considered": len(records),
        "by_status": _count(records, "status"),
        "by_method": _count([r for r in records if r["status"] == "reconstructed"], "method"),
        "configured_method": cfg.method,
        "max_gap": cfg.max_gap,
        "extrapolation": "disabled",
        "excluded_rows": excluded_all,
        "series": series_info,
    }
    return {"records": records, "summary": summary, "algorithm_version": ALGORITHM_VERSION}


def _opt(g: pd.DataFrame, p: int, col: str):
    if col not in g.columns:
        return None
    v = g[col].iloc[p]
    return None if pd.isna(v) else float(v)


def _unc_view(unc, est, interval):
    if est is None:
        return {"available": False, "reason": "no estimate produced"}
    if unc is None:
        return {"available": False, "reason": "uncertainty not requested"}
    if not unc["available"]:
        return {"available": False, "reason": unc["reason"]}
    return {"available": True, "interval": interval, "type": unc["type"], "calibrated": False,
            "holdout_mae": unc["mae"], "holdout_rmse": unc["rmse"], "holdout_bias": unc["bias"],
            "n_residuals": unc["n_residuals"], "note": unc["note"]}


def _limits(method, L, unc):
    out = ["Estimated value; not an observation."]
    if method in LIMITATIONS:
        out.append(LIMITATIONS[method])
    if unc is not None and unc.get("available"):
        out.append("Interval is empirical from holdout validation and has not been calibrated.")
    else:
        out.append("Uncertainty estimate unavailable.")
    if L >= 6:
        out.append(f"Gap of {L} samples: error typically grows with gap length.")
    return out


def _count(records, key):
    out: dict[str, int] = {}
    for r in records:
        k = r.get(key)
        out[str(k)] = out.get(str(k), 0) + 1
    return out
