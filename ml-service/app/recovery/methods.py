"""Gap-filling methods for numeric time series.

All methods fill *interior* gaps only (observations on both sides). They never
extrapolate. They operate on a single sensor's time-ordered series (unique
DatetimeIndex) and return a new Series; inputs are not modified.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer
from sklearn.linear_model import BayesianRidge

METHODS = ["linear", "time", "rolling", "iterative"]  # ordered simple -> complex
MIN_OBS = {"linear": 2, "time": 2, "rolling": 3, "iterative": 30}


def find_gaps(s: pd.Series) -> list[dict]:
    """Contiguous runs of NaN, in sample positions, with boundary flags."""
    isna = s.isna().to_numpy()
    gaps, i, n = [], 0, len(s)
    while i < n:
        if isna[i]:
            j = i
            while j + 1 < n and isna[j + 1]:
                j += 1
            gaps.append({"start": i, "end": j, "length": j - i + 1,
                         "bounded": i > 0 and j < n - 1})
            i = j + 1
        else:
            i += 1
    return gaps


def interior_mask(s: pd.Series) -> np.ndarray:
    """True for NaN positions that have an observation before and after."""
    obs = s.notna().to_numpy()
    if obs.sum() < 2:
        return np.zeros(len(s), dtype=bool)
    first, last = np.argmax(obs), len(obs) - 1 - np.argmax(obs[::-1])
    pos = np.arange(len(s))
    return (~obs) & (pos > first) & (pos < last)


def _linear(s: pd.Series) -> pd.Series:
    obs = s.notna().to_numpy()
    out = s.copy()
    if obs.sum() < 2:
        return out
    pos = np.arange(len(s))
    filled = np.interp(pos, pos[obs], s.to_numpy()[obs])
    m = interior_mask(s)
    out.iloc[np.where(m)[0]] = filled[m]
    return out


def _time(s: pd.Series) -> pd.Series:
    if s.notna().sum() < 2:
        return s.copy()
    return s.interpolate(method="time", limit_area="inside")


def _rolling(s: pd.Series, window: int = 11) -> pd.Series:
    base = s.rolling(window, center=True, min_periods=3).median()
    out = s.copy()
    m = interior_mask(s)
    out.iloc[np.where(m)[0]] = base.to_numpy()[m]
    return out


def _iterative(s: pd.Series, others: pd.DataFrame | None, random_state: int = 0) -> pd.Series:
    """IterativeImputer using co-observed variables plus time-context features.

    Context features use only *other* observations (previous / next observed
    value excluding the row itself), so an observed row cannot see its own value.
    """
    out = s.copy()
    if s.notna().sum() < MIN_OBS["iterative"]:
        return out
    idx = s.index
    prev_obs = s.ffill().shift(1)
    next_obs = s.bfill().shift(-1)
    t = (idx - idx[0]).total_seconds().to_numpy() / 3600.0
    last_t = pd.Series(np.where(s.notna(), t, np.nan), index=idx).ffill().shift(1).to_numpy()
    next_t = pd.Series(np.where(s.notna(), t, np.nan), index=idx).bfill().shift(-1).to_numpy()
    hour = idx.hour.to_numpy() + idx.minute.to_numpy() / 60.0
    feats = {
        "target": s.to_numpy(),
        "prev_obs": prev_obs.to_numpy(),
        "next_obs": next_obs.to_numpy(),
        "dt_prev": t - last_t,
        "dt_next": next_t - t,
        "hsin": np.sin(2 * np.pi * hour / 24),
        "hcos": np.cos(2 * np.pi * hour / 24),
    }
    X = pd.DataFrame(feats, index=idx)
    if others is not None:
        for c in others.columns:
            X["x_" + c] = others[c].to_numpy()
    usable = X[["prev_obs", "next_obs", "dt_prev", "dt_next"]].notna().all(axis=1).to_numpy()
    if usable.sum() < MIN_OBS["iterative"] or X.loc[usable, "target"].notna().sum() < MIN_OBS["iterative"]:
        return out
    # drop constant columns (imputer cannot use them and they break scaling)
    sub = X.loc[usable]
    keep = [c for c in sub.columns if sub[c].nunique(dropna=True) > 1 or c == "target"]
    imp = IterativeImputer(estimator=BayesianRidge(), max_iter=10, random_state=random_state,
                           initial_strategy="median", skip_complete=True)
    try:
        arr = imp.fit_transform(sub[keep].to_numpy())
    except Exception:  # numerical failure: abstain rather than guess
        return out
    filled = pd.Series(arr[:, keep.index("target")], index=sub.index)
    m = interior_mask(s)
    take = m & usable
    out.iloc[np.where(take)[0]] = filled.reindex(idx[take]).to_numpy()
    return out


def fill(method: str, s: pd.Series, others: pd.DataFrame | None = None, **kw) -> pd.Series:
    if method == "linear":
        return _linear(s)
    if method == "time":
        return _time(s)
    if method == "rolling":
        return _rolling(s, kw.get("window", 11))
    if method == "iterative":
        return _iterative(s, others, kw.get("random_state", 0))
    raise ValueError(f"Unknown method '{method}'")


def eligible_methods(s: pd.Series, others: pd.DataFrame | None = None) -> dict[str, str | None]:
    """Map method -> None if eligible, else the reason it is not."""
    n_obs = int(s.notna().sum())
    res: dict[str, str | None] = {}
    for m in METHODS:
        if n_obs < MIN_OBS[m]:
            res[m] = f"needs >= {MIN_OBS[m]} observations, series has {n_obs}"
        else:
            res[m] = None
    return res


def sampling_regularity(s: pd.Series) -> dict:
    """Coefficient of variation of observed-sample intervals (index only)."""
    t = s.index[s.notna()]
    if len(t) < 3:
        return {"cv": None, "median_seconds": None}
    d = np.diff((t - t[0]).total_seconds().to_numpy())  # unit-safe (pandas 2 ns / pandas 3 us)
    d = d[d > 0]
    if len(d) == 0:
        return {"cv": None, "median_seconds": None}
    med = float(np.median(d))
    return {"cv": float(np.std(d) / med) if med > 0 else None, "median_seconds": med}
