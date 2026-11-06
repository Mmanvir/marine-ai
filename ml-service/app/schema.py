"""Canonical schema handling.

Original uploaded values are never modified: ``prepare`` returns a *new* typed
frame and keeps ``row_id`` (the original zero-based row position) so every
issue and reconstruction can be traced back to the source row.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

CANONICAL_FIELDS = [
    "timestamp",
    "latitude",
    "longitude",
    "sea_surface_temperature",
    "salinity",
    "wave_height",
    "current_speed",
    "sensor_id",
]
NUMERIC_VARIABLES = ["sea_surface_temperature", "salinity", "wave_height", "current_speed"]


@dataclass
class ParseProblems:
    """Per-row parse problems found while typing the raw data."""

    invalid_timestamp: list[int] = field(default_factory=list)
    non_numeric: dict[str, list[int]] = field(default_factory=dict)


def apply_mapping(raw: pd.DataFrame, mapping: dict[str, str] | None) -> pd.DataFrame:
    """Rename source columns to canonical names.

    ``mapping`` maps canonical_field -> source_column. Unmapped columns whose
    name already equals a canonical field are used as-is. Unsupported canonical
    names raise ``ValueError``.
    """
    mapping = mapping or {}
    bad = [k for k in mapping if k not in CANONICAL_FIELDS]
    if bad:
        raise ValueError(f"Unsupported canonical fields: {bad}")
    missing = [v for v in mapping.values() if v not in raw.columns]
    if missing:
        raise ValueError(f"Mapped source columns not found in file: {missing}")
    rename = {src: canon for canon, src in mapping.items()}
    out = raw.rename(columns=rename).copy()
    if out.columns.duplicated().any():
        raise ValueError("Mapping produces duplicate canonical columns")
    return out


def prepare(raw: pd.DataFrame, mapping: dict[str, str] | None = None) -> tuple[pd.DataFrame, ParseProblems]:
    """Return a typed copy with ``row_id`` plus the parse problems found."""
    df = apply_mapping(raw, mapping)
    df = df.reset_index(drop=True)
    problems = ParseProblems()
    typed = pd.DataFrame({"row_id": np.arange(len(df))})

    if "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True, format="mixed")
        nonblank = df["timestamp"].notna() & (df["timestamp"].astype(str).str.strip() != "")
        problems.invalid_timestamp = [int(i) for i in np.where(nonblank & ts.isna())[0]]
        typed["timestamp"] = ts
    for col in ["latitude", "longitude", *NUMERIC_VARIABLES]:
        if col in df.columns:
            num = pd.to_numeric(df[col], errors="coerce")
            nonblank = df[col].notna() & (df[col].astype(str).str.strip() != "")
            bad = np.where(nonblank & num.isna())[0]
            if len(bad):
                problems.non_numeric[col] = [int(i) for i in bad]
            typed[col] = num.astype(float)
    if "sensor_id" in df.columns:
        typed["sensor_id"] = df["sensor_id"].astype("string")
    return typed, problems


def present_variables(df: pd.DataFrame) -> list[str]:
    return [c for c in NUMERIC_VARIABLES if c in df.columns]


ALIASES = {
    "timestamp": ["timestamp", "time", "datetime", "date_time", "date", "obs_time", "time_utc"],
    "latitude": ["latitude", "lat", "lat_deg"],
    "longitude": ["longitude", "lon", "long", "lng", "lon_deg"],
    "sea_surface_temperature": ["sea_surface_temperature", "sst", "sea_temp", "water_temp", "temperature", "temp"],
    "salinity": ["salinity", "sal", "psu", "sss"],
    "wave_height": ["wave_height", "hs", "swh", "significant_wave_height", "wvht"],
    "current_speed": ["current_speed", "current", "cur_speed", "water_speed"],
    "sensor_id": ["sensor_id", "sensor", "station", "station_id", "platform", "buoy_id"],
}


def suggest_mapping(columns: list[str]) -> dict[str, str]:
    """Suggest canonical_field -> source_column by case-insensitive alias match."""
    lower = {c.lower().strip(): c for c in columns}
    out: dict[str, str] = {}
    for canon, names in ALIASES.items():
        for n in names:
            if n in lower and lower[n] not in out.values():
                out[canon] = lower[n]
                break
    return out
