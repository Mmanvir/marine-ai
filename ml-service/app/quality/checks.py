"""Data quality assessment.

Every issue carries: row_id, column, category, severity, explanation, method,
recommended_action. Statistical outliers are reported as *suspected anomalies*,
never as confirmed errors. No universal physical limits are applied: range and
cross-variable rules only run when the caller supplies them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..schema import ParseProblems, present_variables


@dataclass
class QualityConfig:
    expected_interval_seconds: float | None = None  # sampling schedule, if known
    delay_tolerance: float = 1.5  # interval > tolerance * expected => delayed/gap
    irregular_cv_threshold: float = 0.5  # CV of intervals above this => irregular
    constant_run_length: int = 6  # identical consecutive readings to flag
    outlier_z: float = 3.5  # robust (MAD) z threshold
    outlier_window: int = 9  # local-median window (samples) for the baseline
    valid_ranges: dict[str, tuple[float, float]] = field(default_factory=dict)  # user-supplied
    # cross-variable rules: {"name":..., "when": col, "op": ">"|"<", "value": x, "then": col, "op2":..., "value2":...}
    cross_rules: list[dict[str, Any]] = field(default_factory=list)


def _issue(row_id, column, category, severity, explanation, method, action):
    return {
        "row_id": None if row_id is None else int(row_id),
        "column": column,
        "category": category,
        "severity": severity,
        "explanation": explanation,
        "method": method,
        "recommended_action": action,
    }


def local_baseline(x: np.ndarray, window: int = 9) -> np.ndarray:
    """Median of the neighbours of each point (the point itself is excluded).

    Needs >= 2 observed neighbours on *each* side within ``window // 2`` samples,
    otherwise the baseline is NaN and the point is left unscored. Requiring both
    sides avoids the one-sided bias that a truncated window has on a trend, so the
    first/last few observations of a series and points beside long gaps cannot be
    assessed (documented limitation).
    """
    x = np.asarray(x, dtype=float)
    h = max(window // 2, 2)
    xp = np.concatenate([np.full(h, np.nan), x, np.full(h, np.nan)])
    win = np.lib.stride_tricks.sliding_window_view(xp, 2 * h + 1)
    left, right = win[:, :h], win[:, h + 1:]
    ok = ((~np.isnan(left)).sum(axis=1) >= 2) & ((~np.isnan(right)).sum(axis=1) >= 2)
    nbrs = np.concatenate([left, right], axis=1)
    base = np.full(len(x), np.nan)
    if ok.any():
        base[ok] = np.nanmedian(nbrs[ok], axis=1)
    return base


def robust_z(values: pd.Series, window: int = 9) -> pd.Series:
    """Robust z-score of residuals from a two-sided local median (MAD based)."""
    x = values.astype(float)
    resid = pd.Series(x.to_numpy() - local_baseline(x.to_numpy(), window), index=x.index)
    r = resid.to_numpy()
    if not np.isfinite(r).any():
        return pd.Series(np.nan, index=x.index)
    med = np.nanmedian(r)
    mad = np.nanmedian(np.abs(r - med))
    if not np.isfinite(mad) or mad == 0:
        # fall back to mean absolute deviation; if still zero the series is flat
        mean_ad = np.nanmean(np.abs(r - med))
        if not np.isfinite(mean_ad) or mean_ad == 0:
            return pd.Series(0.0, index=x.index).where(resid.notna())
        return ((resid - med) / (1.253314 * mean_ad)).where(resid.notna())
    return (0.6745 * (resid - med) / mad).where(resid.notna())


def assess_quality(
    df: pd.DataFrame,
    problems: ParseProblems | None = None,
    config: QualityConfig | None = None,
) -> dict[str, Any]:
    cfg = config or QualityConfig()
    problems = problems or ParseProblems()
    issues: list[dict] = []
    n = len(df)
    if n == 0:
        return {"issues": [], "summary": _summary(df, [], cfg), "empty": True}

    variables = present_variables(df)

    # --- parse problems -------------------------------------------------
    for rid in problems.invalid_timestamp:
        issues.append(_issue(rid, "timestamp", "invalid_timestamp", "high",
                             "Timestamp could not be parsed.", "datetime parsing",
                             "Correct the timestamp in the source or exclude the row."))
    for col, rows in problems.non_numeric.items():
        for rid in rows:
            issues.append(_issue(rid, col, "non_numeric_value", "high",
                                 f"Non-numeric value in numeric column '{col}'.", "numeric coercion",
                                 "Correct the value or treat as missing."))

    # --- missing values -------------------------------------------------
    for col in variables:
        for rid in df.loc[df[col].isna(), "row_id"]:
            if rid in set(problems.non_numeric.get(col, [])):
                continue  # already reported as non-numeric
            issues.append(_issue(rid, col, "missing_value", "medium",
                                 f"No value recorded for '{col}'.", "null check",
                                 "Eligible for reconstruction if the gap is short and evidence is sufficient."))

    # --- coordinates ----------------------------------------------------
    if "latitude" in df:
        bad = df[(df["latitude"].abs() > 90)]
        for rid in bad["row_id"]:
            issues.append(_issue(rid, "latitude", "invalid_coordinate", "high",
                                 "Latitude outside [-90, 90].", "range check", "Correct or exclude the row."))
    if "longitude" in df:
        bad = df[(df["longitude"].abs() > 180)]
        for rid in bad["row_id"]:
            issues.append(_issue(rid, "longitude", "invalid_coordinate", "high",
                                 "Longitude outside [-180, 180].", "range check", "Correct or exclude the row."))

    # --- duplicates -----------------------------------------------------
    key_cols = [c for c in ["sensor_id", "timestamp"] if c in df.columns]
    data_cols = [c for c in df.columns if c != "row_id"]
    if data_cols:
        full_dup = df.duplicated(subset=data_cols, keep="first")
        for rid in df.loc[full_dup, "row_id"]:
            issues.append(_issue(rid, None, "duplicate_record", "medium",
                                 "Row is identical to an earlier row.", "exact row comparison",
                                 "Remove the duplicate (original row retained in source file)."))
    else:
        full_dup = pd.Series(False, index=df.index)
    if "timestamp" in key_cols:
        ts_dup = df.duplicated(subset=key_cols, keep="first") & ~full_dup & df["timestamp"].notna()
        for rid in df.loc[ts_dup, "row_id"]:
            issues.append(_issue(rid, "timestamp", "duplicate_timestamp", "medium",
                                 "Another row has the same timestamp for this sensor but different values.",
                                 "key comparison (sensor_id, timestamp)",
                                 "Review which record is correct; do not average silently."))

    # --- configured domain ranges (never universal) ----------------------
    for col, (lo, hi) in cfg.valid_ranges.items():
        if col in df:
            bad = df[(df[col] < lo) | (df[col] > hi)]
            for rid in bad["row_id"]:
                issues.append(_issue(rid, col, "out_of_configured_range", "high",
                                     f"Value outside user-configured range [{lo}, {hi}].",
                                     "configured range rule", "Review against the sensor log."))

    # --- cross-variable rules -------------------------------------------
    for rule in cfg.cross_rules:
        try:
            a, b = rule["when"], rule["then"]
            if a not in df or b not in df:
                continue
            cond = _cmp(df[a], rule["op"], rule["value"])
            viol = cond & ~_cmp(df[b], rule["op2"], rule["value2"]) & df[b].notna()
            for rid in df.loc[viol, "row_id"]:
                issues.append(_issue(rid, b, "cross_variable_inconsistency", "medium",
                                     f"Rule '{rule.get('name', 'unnamed')}' violated.",
                                     "configured cross-variable rule", "Review jointly with " + a))
        except (KeyError, ValueError):
            continue

    # --- per-sensor temporal checks --------------------------------------
    groups = df.groupby("sensor_id", dropna=False) if "sensor_id" in df else [(None, df)]
    for _, g in groups:
        if "timestamp" in g:
            g = g.dropna(subset=["timestamp"]).sort_values("timestamp")
            issues.extend(_interval_issues(g, cfg))
        else:
            g = g.sort_values("row_id")
        for col in variables:
            s = g[col]
            issues.extend(_constant_issues(g, col, cfg))
            if s.notna().sum() >= 8:
                z = robust_z(s.reset_index(drop=True), cfg.outlier_window)
                flagged = np.where(z.abs() > cfg.outlier_z)[0]
                rows = g["row_id"].to_numpy()
                for i in flagged:
                    issues.append(_issue(rows[i], col, "suspected_anomaly",
                                         "medium" if abs(z.iloc[i]) < 2 * cfg.outlier_z else "high",
                                         f"Robust z-score {z.iloc[i]:.1f} versus local rolling median. "
                                         "Statistically unusual; NOT confirmed as an error.",
                                         f"MAD robust z > {cfg.outlier_z} (local window {cfg.outlier_window})",
                                         "Inspect against neighbouring observations and sensor metadata."))

    return {"issues": issues, "summary": _summary(df, issues, cfg), "empty": False}


def _cmp(s: pd.Series, op: str, v: float) -> pd.Series:
    ops = {">": s > v, "<": s < v, ">=": s >= v, "<=": s <= v}
    if op not in ops:
        raise ValueError(op)
    return ops[op]


def _interval_issues(g: pd.DataFrame, cfg: QualityConfig) -> list[dict]:
    out: list[dict] = []
    if len(g) < 3:
        return out
    dt = g["timestamp"].diff().dt.total_seconds().to_numpy()
    valid = dt[1:][dt[1:] > 0]
    if len(valid) == 0:
        return out
    expected = cfg.expected_interval_seconds
    med = float(np.median(valid))
    cv = float(np.std(valid) / med) if med > 0 else 0.0
    rows = g["row_id"].to_numpy()
    if expected:
        for i in range(1, len(g)):
            if dt[i] > expected * cfg.delay_tolerance:
                out.append(_issue(rows[i], "timestamp", "delayed_observation", "medium",
                                  f"Interval {dt[i]:.0f}s exceeds expected {expected:.0f}s "
                                  f"by factor {dt[i] / expected:.1f}.",
                                  "expected sampling schedule", "Check for transmission delay or sensor outage."))
    elif cv > cfg.irregular_cv_threshold:
        out.append(_issue(None, "timestamp", "irregular_sampling", "low",
                          f"Sampling intervals vary (CV={cv:.2f}, median {med:.0f}s). "
                          "Time-based methods are preferable to index-based interpolation.",
                          "interval coefficient of variation",
                          "Provide an expected interval or use time-aware recovery."))
    return out


def _constant_issues(g: pd.DataFrame, col: str, cfg: QualityConfig) -> list[dict]:
    s = g[col]
    if s.notna().sum() < cfg.constant_run_length:
        return []
    run_id = (s != s.shift()).cumsum()
    out: list[dict] = []
    for _, idx in s.groupby(run_id).groups.items():
        if len(idx) >= cfg.constant_run_length and pd.notna(s.loc[idx[0]]):
            out.append(_issue(g.loc[idx[0], "row_id"], col, "constant_reading", "medium",
                              f"{len(idx)} identical consecutive readings ({s.loc[idx[0]]}). "
                              "Possible stuck sensor, but may be genuine.",
                              f"run length >= {cfg.constant_run_length}",
                              "Check sensor maintenance log."))
    return out


def _summary(df: pd.DataFrame, issues: list[dict], cfg: QualityConfig) -> dict[str, Any]:
    n = len(df)
    variables = present_variables(df)
    cells = n * len(variables)
    missing = int(sum(df[c].isna().sum() for c in variables)) if variables else 0
    by_cat: dict[str, int] = {}
    by_sev: dict[str, int] = {"low": 0, "medium": 0, "high": 0}
    flagged_rows: set[int] = set()
    for i in issues:
        by_cat[i["category"]] = by_cat.get(i["category"], 0) + 1
        by_sev[i["severity"]] += 1
        if i["row_id"] is not None and i["category"] != "missing_value":
            flagged_rows.add(i["row_id"])
    missing_pct = (missing / cells * 100) if cells else 0.0
    flagged_pct = (len(flagged_rows) / n * 100) if n else 0.0
    # Transparent heuristic: 100 - missing% - flagged-row%, floored at 0.
    # This is a descriptive index, not a validated scientific metric.
    score = max(0.0, round(100 - missing_pct - flagged_pct, 2))
    return {
        "n_rows": n,
        "n_variable_cells": cells,
        "missing_count": missing,
        "missing_pct": round(missing_pct, 3),
        "flagged_rows": len(flagged_rows),
        "flagged_pct": round(flagged_pct, 3),
        "issues_by_category": by_cat,
        "issues_by_severity": by_sev,
        "quality_score": score,
        "quality_score_definition": "100 - missing% (of variable cells) - flagged-row%; descriptive heuristic, not validated.",
    }
