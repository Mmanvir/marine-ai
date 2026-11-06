"""Framework-free request handlers (testable without FastAPI).

Every handler takes plain dicts/strings and returns JSON-safe dicts. Source data
is never modified: the processed CSV *adds* columns and leaves originals intact.
"""
from __future__ import annotations

import io
import math
from typing import Any

import numpy as np
import pandas as pd

from .. import ALGORITHM_VERSION
from ..anomaly.detectors import IForestConfig, MadConfig, compare_detectors
from ..evaluation.benchmark import BenchConfig, clean_reference_frame, evaluate
from ..quality.checks import QualityConfig, assess_quality
from ..recovery.methods import METHODS
from ..recovery.pipeline import ReconConfig, reconstruct
from ..schema import CANONICAL_FIELDS, NUMERIC_VARIABLES, present_variables, prepare, suggest_mapping
from ..uncertainty.intervals import HoldoutConfig


class BadRequest(ValueError):
    """Client error (maps to HTTP 422)."""


def clean(obj: Any) -> Any:
    """Recursively convert numpy/pandas/NaN values into JSON-safe Python."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if obj is pd.NaT or obj is pd.NA:
        return None
    return obj


def read_csv_text(text: str) -> pd.DataFrame:
    if not text or not text.strip():
        raise BadRequest("CSV is empty")
    try:
        raw = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=True)
    except Exception as exc:  # malformed CSV
        raise BadRequest(f"Could not parse CSV: {exc}") from exc
    if raw.shape[1] == 0:
        raise BadRequest("CSV has no columns")
    return raw


def load(text: str, mapping: dict[str, str] | None):
    raw = read_csv_text(text)
    try:
        typed, problems = prepare(raw, mapping)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    return raw, typed, problems


def _infer_type(s: pd.Series) -> str:
    nn = s.dropna()
    nn = nn[nn.astype(str).str.strip() != ""]
    if len(nn) == 0:
        return "empty"
    num = pd.to_numeric(nn, errors="coerce")
    if num.notna().mean() >= 0.9:
        return "numeric"
    ts = pd.to_datetime(nn, errors="coerce", utc=True, format="mixed")
    if ts.notna().mean() >= 0.9:
        return "datetime"
    return "string"


def profile(text: str) -> dict:
    raw = read_csv_text(text)
    cols = []
    for c in raw.columns:
        s = raw[c]
        t = _infer_type(s)
        entry: dict[str, Any] = {"name": c, "type": t, "non_null": int(s.notna().sum()),
                                 "missing": int(s.isna().sum()), "unique": int(s.nunique(dropna=True))}
        if t == "numeric":
            n = pd.to_numeric(s, errors="coerce").dropna()
            if len(n):
                entry.update(min=float(n.min()), max=float(n.max()), mean=float(n.mean()),
                             median=float(n.median()), std=float(n.std()) if len(n) > 1 else 0.0)
        elif t == "datetime":
            ts = pd.to_datetime(s, errors="coerce", utc=True, format="mixed").dropna()
            if len(ts):
                entry.update(min=ts.min().isoformat(), max=ts.max().isoformat())
        cols.append(entry)
    return clean({"n_rows": int(len(raw)), "n_columns": int(raw.shape[1]), "columns": cols,
                  "suggested_mapping": suggest_mapping(list(raw.columns)),
                  "canonical_fields": CANONICAL_FIELDS})


def _quality_cfg(c: dict) -> QualityConfig:
    c = c or {}
    kw: dict[str, Any] = {}
    for key in ["expected_interval_seconds", "delay_tolerance", "irregular_cv_threshold",
                "constant_run_length", "outlier_z", "outlier_window"]:
        if c.get(key) is not None:
            kw[key] = c[key]
    if c.get("valid_ranges"):
        kw["valid_ranges"] = {k: (float(v[0]), float(v[1])) for k, v in c["valid_ranges"].items()}
    if c.get("cross_rules"):
        kw["cross_rules"] = c["cross_rules"]
    return QualityConfig(**kw)


def quality(text: str, mapping: dict | None, config: dict | None) -> dict:
    _, typed, problems = load(text, mapping)
    res = assess_quality(typed, problems, _quality_cfg(config or {}))
    res["algorithm_version"] = ALGORITHM_VERSION
    return clean(res)


def anomalies(text: str, mapping: dict | None, columns: list[str] | None, mad: dict | None,
              iforest: dict | None) -> dict:
    _, typed, _ = load(text, mapping)
    cols = columns or present_variables(typed)
    if not cols:
        raise BadRequest("No numeric variable columns are mapped; nothing to analyse")
    out: dict[str, Any] = {}
    for col in cols:
        if col not in typed.columns:
            raise BadRequest(f"Column '{col}' is not mapped/present")
        cmp_ = compare_detectors(typed, col, MadConfig(**(mad or {})), IForestConfig(**(iforest or {})))
        scores = cmp_.pop("scores")
        rows = sorted(set(cmp_["mad"]["row_ids"]) | set(cmp_["isolation_forest"]["row_ids"]))
        a, b = set(cmp_["mad"]["row_ids"]), set(cmp_["isolation_forest"]["row_ids"])
        cmp_["flagged"] = [{
            "row_id": r,
            "methods": [m for m, s in (("mad", a), ("isolation_forest", b)) if r in s],
            "mad_score": scores["mad"].get(r),
            "isolation_forest_score": scores["isolation_forest"].get(r),
        } for r in rows]
        out[col] = cmp_
    return clean({"columns": out, "algorithm_version": ALGORITHM_VERSION,
                  "note": "Flags are suspected anomalies, not confirmed sensor errors."})


def reconstruct_handler(text: str, mapping: dict | None, column: str, method: str, max_gap: int,
                        min_obs_fraction: float, max_relative_halfwidth: float | None, alpha: float,
                        seed: int) -> dict:
    raw, typed, _ = load(text, mapping)
    if column not in typed.columns:
        raise BadRequest(f"Variable '{column}' is not mapped/present")
    if column not in NUMERIC_VARIABLES:
        raise BadRequest(f"'{column}' is not a numeric marine variable")
    if "timestamp" not in typed.columns:
        raise BadRequest("Reconstruction requires a mapped timestamp column")
    if method != "mare" and method not in METHODS:
        raise BadRequest(f"Unknown method '{method}'")
    cfg = ReconConfig(method=method, max_gap=max_gap, min_obs_fraction=min_obs_fraction,
                      max_relative_halfwidth=max_relative_halfwidth,
                      holdout=HoldoutConfig(alpha=alpha, seed=seed))
    res = reconstruct(typed, column, cfg)

    # Processed CSV: originals untouched, estimates in separate clearly named columns.
    proc = raw.copy()
    n = len(proc)
    est = [None] * n
    status = [""] * n
    lo = [None] * n
    hi = [None] * n
    meth = [""] * n
    for r in res["records"]:
        i = r["row_id"]
        status[i] = r["status"]
        meth[i] = r["method"] or ""
        if r["reconstructed_value"] is not None:
            est[i] = r["reconstructed_value"]
            iv = r["uncertainty"].get("interval") if r["uncertainty"].get("available") else None
            if iv:
                lo[i], hi[i] = iv["low"], iv["high"]
    proc[f"{column}__estimated"] = est
    proc[f"{column}__interval_low"] = lo
    proc[f"{column}__interval_high"] = hi
    proc[f"{column}__recovery_method"] = meth
    proc[f"{column}__recovery_status"] = status
    proc["is_estimated_" + column] = [v is not None for v in est]
    res["processed_csv"] = proc.to_csv(index=False)
    return clean(res)


TRUTH_COLUMNS = {"sea_surface_temperature": "truth_sst", "salinity": "truth_salinity"}


def evaluate_handler(text: str, mapping: dict | None, column: str, n_repeats: int, seed: int, max_gap: int,
                     alpha: float, truth_csv: str | None) -> dict:
    _, typed, _ = load(text, mapping)
    if column not in typed.columns or "timestamp" not in typed.columns:
        raise BadRequest("Evaluation requires a mapped timestamp and the chosen variable column")
    spikes = None
    ref = typed
    reference_source = "observed values of the uploaded data (hidden and re-estimated)"
    if truth_csv:
        truth = read_csv_text(truth_csv)
        tcol = TRUTH_COLUMNS.get(column)
        needed = {"row_id", "is_duplicate", "is_spike", tcol}
        if tcol is None or not needed.issubset(truth.columns):
            raise BadRequest("Truth file does not match the synthetic generator format for this variable")
        truth["row_id"] = truth["row_id"].astype(int)
        truth[tcol] = pd.to_numeric(truth[tcol], errors="coerce")
        for c in ("is_duplicate", "is_spike"):
            truth[c] = truth[c].astype(str).str.lower().isin(["true", "1"])
        ref, spikes = clean_reference_frame(typed, truth, column, tcol)
        reference_source = "SYNTHETIC ground truth (complete series without injected defects)"
    cfg = BenchConfig(n_repeats=n_repeats, seed=seed, max_gap=max_gap, holdout=HoldoutConfig(alpha=alpha, seed=seed))
    res = evaluate(ref, column, cfg, spike_rows=spikes, detection_df=typed if spikes is not None else None)
    res["reference_source"] = reference_source
    return clean(res)
