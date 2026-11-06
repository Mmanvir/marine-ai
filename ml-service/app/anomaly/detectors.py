"""Anomaly detection: robust MAD and Isolation Forest, plus comparison.

Both detectors return *suspected anomalies*. A flag is a statement that an
observation is unusual relative to its neighbours, not proof that it is wrong.
Detection is done per sensor on time-ordered data.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from ..quality.checks import local_baseline, robust_z


@dataclass
class MadConfig:
    z_threshold: float = 3.5
    window: int = 9


@dataclass
class IForestConfig:
    contamination: float = 0.02
    n_estimators: int = 200
    window: int = 9
    random_state: int = 42


MIN_POINTS = 12


def _sorted_groups(df: pd.DataFrame, column: str):
    d = df[["row_id", column] + [c for c in ["timestamp", "sensor_id"] if c in df.columns]].copy()
    if "timestamp" in d:
        d = d.sort_values("timestamp")
    key = "sensor_id" if "sensor_id" in d else None
    if key:
        for sid, g in d.groupby(key, dropna=False):
            yield sid, g
    else:
        yield None, d


def detect_mad(df: pd.DataFrame, column: str, cfg: MadConfig | None = None) -> pd.DataFrame:
    cfg = cfg or MadConfig()
    parts = []
    for _, g in _sorted_groups(df, column):
        s = g[column].reset_index(drop=True)
        if s.notna().sum() < MIN_POINTS:
            parts.append(pd.DataFrame({"row_id": g["row_id"].to_numpy(), "score": np.nan, "flag": False}))
            continue
        z = robust_z(s, cfg.window)
        parts.append(pd.DataFrame({"row_id": g["row_id"].to_numpy(), "score": z.abs().to_numpy(),
                                   "flag": (z.abs() > cfg.z_threshold).fillna(False).to_numpy()}))
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["row_id", "score", "flag"])


def detect_iforest(df: pd.DataFrame, column: str, cfg: IForestConfig | None = None) -> pd.DataFrame:
    cfg = cfg or IForestConfig()
    parts = []
    for _, g in _sorted_groups(df, column):
        s = g[column].reset_index(drop=True)
        rows = g["row_id"].to_numpy()
        ok = s.notna().to_numpy()
        if ok.sum() < MIN_POINTS or s[ok].nunique() <= 1:
            parts.append(pd.DataFrame({"row_id": rows, "score": np.nan, "flag": False}))
            continue
        base = local_baseline(s.to_numpy(), cfg.window)
        feats = np.column_stack([
            s.to_numpy() - base,                 # local deviation (NaN where unscored)
            s.diff().abs().fillna(0).to_numpy(),  # jump from previous
            s.to_numpy(),                         # level
        ])
        scored = ok & ~np.isnan(base)
        if scored.sum() < MIN_POINTS:
            parts.append(pd.DataFrame({"row_id": rows, "score": np.nan, "flag": False}))
            continue
        feats = np.nan_to_num(feats, nan=0.0)
        model = IsolationForest(n_estimators=cfg.n_estimators, contamination=cfg.contamination,
                                random_state=cfg.random_state)
        model.fit(feats[scored])
        score = -model.score_samples(feats)  # higher = more anomalous
        pred = model.predict(feats) == -1
        flag = pred & scored  # edge / unsupported points are never flagged
        parts.append(pd.DataFrame({"row_id": rows, "score": np.where(scored, score, np.nan), "flag": flag}))
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["row_id", "score", "flag"])


def prf(pred: set[int], truth: set[int]) -> dict[str, float | None]:
    tp = len(pred & truth)
    p = tp / len(pred) if pred else None
    r = tp / len(truth) if truth else None
    f1 = (2 * p * r / (p + r)) if p and r and (p + r) > 0 else (0.0 if truth and pred else None)
    return {"tp": tp, "fp": len(pred - truth), "fn": len(truth - pred),
            "precision": p, "recall": r, "f1": f1}


def compare_detectors(
    df: pd.DataFrame,
    column: str,
    mad_cfg: MadConfig | None = None,
    if_cfg: IForestConfig | None = None,
    truth_rows: set[int] | None = None,
) -> dict[str, Any]:
    """Run both detectors and report overlap (and P/R/F1 if labels exist)."""
    if column not in df.columns:
        raise ValueError(f"Column '{column}' not present")
    mad = detect_mad(df, column, mad_cfg)
    iso = detect_iforest(df, column, if_cfg)
    a = set(mad.loc[mad["flag"], "row_id"].astype(int))
    b = set(iso.loc[iso["flag"], "row_id"].astype(int))
    union = a | b
    out: dict[str, Any] = {
        "column": column,
        "mad": {"n_flagged": len(a), "row_ids": sorted(a)},
        "isolation_forest": {"n_flagged": len(b), "row_ids": sorted(b)},
        "agreement": {
            "both": len(a & b),
            "only_mad": len(a - b),
            "only_isolation_forest": len(b - a),
            "jaccard": (len(a & b) / len(union)) if union else None,
        },
        "note": "Flags are suspected anomalies, not confirmed sensor errors.",
        "scores": {
            "mad": dict(zip(mad["row_id"].astype(int).tolist(), mad["score"].tolist())),
            "isolation_forest": dict(zip(iso["row_id"].astype(int).tolist(), iso["score"].tolist())),
        },
    }
    if truth_rows is not None:
        out["mad"]["metrics"] = prf(a, truth_rows)
        out["isolation_forest"]["metrics"] = prf(b, truth_rows)
    return out
