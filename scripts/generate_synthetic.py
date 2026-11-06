#!/usr/bin/env python3
"""Generate a SYNTHETIC marine dataset with known ground truth.

*** All values are simulated. Nothing here is a real ocean measurement. ***

Outputs (in --out-dir):
  marine_synthetic.csv        observed data with injected defects (canonical schema)
  marine_synthetic_truth.csv  row-aligned ground truth + defect labels
  marine_synthetic_meta.json  generation parameters (reproducible via --seed)

Injected defects: random missing values, contiguous missing intervals, sensor
spikes, duplicate records, delayed observations, irregular sampling.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

# Simulated station positions (arbitrary offshore points; synthetic sensors only).
STATIONS = [(14.5, 68.0), (12.0, 85.5), (8.5, 76.0), (16.0, 72.5), (10.0, 80.0)]


def generate(seed=42, days=30, sensors=3, interval_minutes=60, random_missing=0.03,
             n_gaps_per_sensor=3, gap_len_range=(4, 30), spike_rate=0.01, duplicate_rate=0.01,
             delayed_rate=0.02, skip_rate=0.015):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2024-03-01T00:00:00Z")
    frames = []
    for k in range(sensors):
        lat, lon = STATIONS[k % len(STATIONS)]
        n = int(days * 24 * 60 / interval_minutes)
        sched = start + pd.to_timedelta(np.arange(n) * interval_minutes, unit="m")
        # irregular sampling: small jitter and occasionally skipped samples
        jitter = pd.to_timedelta(rng.integers(-4, 5, n), unit="m")
        keep = rng.random(n) > skip_rate
        keep[0] = keep[-1] = True
        t = (sched + jitter)[keep]
        n = len(t)
        hours = (t - start).total_seconds().to_numpy() / 3600
        base = 28.0 - 0.4 * k
        seasonal = 0.6 * np.sin(2 * np.pi * hours / (24 * days))
        diurnal = 0.5 * np.sin(2 * np.pi * (hours % 24 - 9) / 24)
        ar = np.zeros(n)
        for i in range(1, n):
            ar[i] = 0.92 * ar[i - 1] + rng.normal(0, 0.06)
        sst = base + seasonal + diurnal + ar
        sal = 35.0 - 0.4 * (sst - base) + 0.5 * np.sin(2 * np.pi * hours / (24 * 7)) + rng.normal(0, 0.03, n)
        f = pd.DataFrame({
            "timestamp": t, "latitude": lat + rng.normal(0, 0.002, n), "longitude": lon + rng.normal(0, 0.002, n),
            "sea_surface_temperature": sst, "salinity": sal, "sensor_id": f"SYN-{k + 1:02d}",
        })
        f["is_delayed"] = rng.random(n) < delayed_rate
        f.loc[f["is_delayed"], "timestamp"] += pd.to_timedelta(rng.integers(20, 46, int(f["is_delayed"].sum())), unit="m")
        frames.append(f)
    truth = pd.concat(frames, ignore_index=True)
    n = len(truth)
    truth["row_id"] = np.arange(n)
    obs = truth.copy()

    # random missingness (independent per variable)
    truth["missing_random"] = False
    truth["missing_gap"] = False
    truth["is_spike"] = False
    for col in ["sea_surface_temperature", "salinity"]:
        m = rng.random(n) < random_missing
        obs.loc[m, col] = np.nan
        if col == "sea_surface_temperature":
            truth.loc[m, "missing_random"] = True
    # contiguous gaps (within a sensor, interior only)
    for sid, g in truth.groupby("sensor_id"):
        idx = g.index.to_numpy()
        for _ in range(n_gaps_per_sensor):
            L = int(rng.integers(gap_len_range[0], gap_len_range[1] + 1))
            s0 = int(rng.integers(10, len(idx) - L - 10))
            rows = idx[s0:s0 + L]
            obs.loc[rows, "sea_surface_temperature"] = np.nan
            truth.loc[rows, "missing_gap"] = True
    # spikes only where observed
    cand = obs.index[obs["sea_surface_temperature"].notna()].to_numpy()
    sp = rng.choice(cand, size=max(1, int(len(cand) * spike_rate)), replace=False)
    obs.loc[sp, "sea_surface_temperature"] += rng.choice([-1, 1], len(sp)) * rng.uniform(3, 7, len(sp))
    truth.loc[sp, "is_spike"] = True

    cols = ["timestamp", "latitude", "longitude", "sea_surface_temperature", "salinity", "sensor_id"]
    observed = obs[cols].copy()
    t_out = truth.drop(columns=["is_delayed"]).copy()
    t_out["is_delayed"] = obs["is_delayed"].to_numpy()
    t_out["is_duplicate"] = False
    t_out["source_row_id"] = t_out["row_id"]
    # duplicates appended at end (exact copies of observed rows)
    nd = int(n * duplicate_rate)
    src = rng.choice(n, size=nd, replace=False)
    dup_obs = observed.iloc[src].copy()
    dup_truth = t_out.iloc[src].copy()
    dup_truth["is_duplicate"] = True
    dup_truth["source_row_id"] = src
    observed = pd.concat([observed, dup_obs], ignore_index=True)
    t_out = pd.concat([t_out, dup_truth], ignore_index=True)
    t_out["row_id"] = np.arange(len(t_out))
    t_out = t_out.rename(columns={"sea_surface_temperature": "truth_sst", "salinity": "truth_salinity",
                                  "timestamp": "truth_timestamp"})
    t_out["label"] = "SYNTHETIC"
    meta = {"synthetic": True, "seed": seed, "days": days, "sensors": sensors, "interval_minutes": interval_minutes,
            "random_missing": random_missing, "n_gaps_per_sensor": n_gaps_per_sensor,
            "gap_len_range": list(gap_len_range), "spike_rate": spike_rate, "duplicate_rate": duplicate_rate,
            "delayed_rate": delayed_rate, "skip_rate": skip_rate, "rows": int(len(observed))}
    return observed, t_out, meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--sensors", type=int, default=3)
    ap.add_argument("--interval-minutes", type=int, default=60)
    ap.add_argument("--out-dir", default=str(Path(__file__).resolve().parents[1] / "data" / "synthetic"))
    a = ap.parse_args()
    obs, truth, meta = generate(a.seed, a.days, a.sensors, a.interval_minutes)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    obs.to_csv(out / "marine_synthetic.csv", index=False)
    truth.to_csv(out / "marine_synthetic_truth.csv", index=False)
    (out / "marine_synthetic_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"SYNTHETIC data written to {out} ({meta['rows']} rows, seed={a.seed})")


if __name__ == "__main__":
    main()
