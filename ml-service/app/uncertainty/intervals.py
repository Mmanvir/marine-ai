"""Uncertainty from time-series holdout validation.

Procedure: temporarily hide *observed* values in windows of the same length as
the target gap, reconstruct them with the method under test using only the
remaining data, and collect errors (truth - estimate). Empirical quantiles of
those errors give a prediction interval. This is an empirical, method-specific
estimate; it is NOT a calibrated confidence level unless coverage has been
checked on separate data (done in the evaluation module, never assumed here).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..recovery.methods import fill


@dataclass
class HoldoutConfig:
    n_rounds: int = 6            # refits per (method, gap length)
    windows_per_round: int = 8   # disjoint hidden windows per refit
    alpha: float = 0.10          # 90% nominal empirical interval
    min_residuals: int = 30      # below this the estimate is "unavailable"
    seed: int = 0


def bucket_length(length: int, max_gap: int) -> int:
    """Round gap length up to a power of two (cache key), capped at max_gap."""
    b = 1
    while b < length:
        b *= 2
    return int(min(max(b, 1), max(max_gap, 1)))


def holdout_errors(
    s: pd.Series,
    method: str,
    gap_len: int,
    others: pd.DataFrame | None = None,
    cfg: HoldoutConfig | None = None,
    calibration_end: pd.Timestamp | None = None,
) -> dict:
    """Return errors (truth - estimate) plus bookkeeping for one method."""
    cfg = cfg or HoldoutConfig()
    rng = np.random.default_rng(cfg.seed + gap_len * 7919)
    obs = s.notna().to_numpy()
    n = len(s)
    valid_pos = np.where(obs)[0]
    # candidate window starts: [start-1 .. start+gap_len] all observed, inside calibration period
    cand = []
    for st in range(1, n - gap_len):
        if obs[st - 1: st + gap_len + 1].all():
            if calibration_end is None or s.index[st + gap_len] < calibration_end:
                cand.append(st)
    errors: list[float] = []
    attempted = failed = 0
    if len(cand) == 0:
        return {"errors": np.array([]), "attempted": 0, "failed": 0, "candidates": 0}
    cand = np.array(cand)
    for _ in range(cfg.n_rounds):
        rng.shuffle(cand)
        chosen: list[int] = []
        for st in cand:
            if all(abs(st - c) > gap_len + 2 for c in chosen):
                chosen.append(int(st))
            if len(chosen) >= cfg.windows_per_round:
                break
        if not chosen:
            continue
        masked = s.copy()
        hidden = np.concatenate([np.arange(c, c + gap_len) for c in chosen])
        truth = s.to_numpy()[hidden]
        masked.iloc[hidden] = np.nan
        filled = fill(method, masked, others)
        est = filled.to_numpy()[hidden]
        attempted += len(hidden)
        ok = ~np.isnan(est)
        failed += int((~ok).sum())
        errors.extend((truth[ok] - est[ok]).tolist())
    return {"errors": np.array(errors), "attempted": attempted, "failed": failed, "candidates": int(len(cand))}


def summarize_errors(res: dict, cfg: HoldoutConfig | None = None) -> dict:
    """Turn holdout errors into interval offsets + error metrics (or 'unavailable')."""
    cfg = cfg or HoldoutConfig()
    e = res["errors"]
    if len(e) < cfg.min_residuals:
        return {
            "available": False,
            "reason": f"only {len(e)} holdout residuals (< {cfg.min_residuals}); estimate unavailable",
            "n_residuals": int(len(e)),
        }
    lo, hi = np.quantile(e, [cfg.alpha / 2, 1 - cfg.alpha / 2])
    return {
        "available": True,
        "type": "empirical prediction interval (holdout residual quantiles)",
        "nominal_level": 1 - cfg.alpha,
        "calibrated": False,
        "offset_low": float(lo),
        "offset_high": float(hi),
        "halfwidth": float((hi - lo) / 2),
        "mae": float(np.mean(np.abs(e))),
        "rmse": float(np.sqrt(np.mean(e ** 2))),
        "bias": float(np.mean(e)),
        "n_residuals": int(len(e)),
        "holdout_failure_rate": float(res["failed"] / res["attempted"]) if res["attempted"] else None,
        "note": "Empirical and method-specific. Not a calibrated confidence; "
                "see benchmark for measured coverage on held-out test gaps.",
    }
