#!/usr/bin/env python3
"""Convert a downloaded NOAA NDBC "standard meteorological" text file into MarineTrace's canonical CSV.

Optional public-data workflow. This script does NOT download anything.

1. Pick a station at https://www.ndbc.noaa.gov/ and download its standard meteorological data file
   (real-time files look like  https://www.ndbc.noaa.gov/data/realtime2/<STATION>.txt ).
2. Look up the station's latitude/longitude on its station page (the data file does not contain them).
3. Convert:
       python scripts/import_ndbc.py 41001.txt --station 41001 --lat 34.7 --lon -72.7 -o data/public_41001.csv
4. Upload the CSV in the app and use the suggested column mapping.

Assumptions (verify against the file you downloaded; NOAA can change formats):
  * First header line starts with '#YY' (or '#YYYY'), a units line starts with '#yr'/'#', then data rows.
  * Whitespace-separated columns; missing values are 'MM' or all-nines sentinels (99.0, 999, 9999.0 ...).
  * Times are UTC. WTMP is sea surface temperature in deg C; WVHT is significant wave height in metres.
Licensing: NOAA data are generally public, but check the notices for the specific product you use and cite NDBC.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

SENTINEL = re.compile(r"^-?9{2,}(\.0+)?$")  # 99, 99.0, 999, 9999.0, ...


def read_ndbc(text: str) -> pd.DataFrame:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    hdr_idx = next((i for i, ln in enumerate(lines) if re.match(r"^#\s*(YY|YYYY)\b", ln)), None)
    if hdr_idx is None:
        raise ValueError("Could not find the '#YY ...' header line; is this an NDBC standard meteorological file?")
    cols = lines[hdr_idx].lstrip("#").split()
    rows = [ln.split() for ln in lines[hdr_idx + 1:] if not ln.startswith("#")]
    bad = [r for r in rows if len(r) != len(cols)]
    if bad:
        raise ValueError(f"{len(bad)} data rows do not have {len(cols)} columns; unsupported layout")
    df = pd.DataFrame(rows, columns=cols)
    return df.replace({"MM": pd.NA}).map(lambda v: pd.NA if isinstance(v, str) and SENTINEL.match(v) else v)


def to_canonical(df: pd.DataFrame, station: str, lat: float, lon: float) -> pd.DataFrame:
    year_col = "YY" if "YY" in df.columns else "YYYY"
    y = pd.to_numeric(df[year_col], errors="coerce")
    y = y.where(y >= 100, y + 2000)  # two-digit years
    ts = pd.to_datetime(dict(year=y, month=pd.to_numeric(df["MM"] if "MM" in df else df["mo"], errors="coerce"),
                             day=pd.to_numeric(df["DD"], errors="coerce"), hour=pd.to_numeric(df["hh"], errors="coerce"),
                             minute=pd.to_numeric(df["mm"], errors="coerce")), errors="coerce", utc=True)
    out = pd.DataFrame({"timestamp": ts.dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "latitude": lat, "longitude": lon})
    for src, dst in (("WTMP", "sea_surface_temperature"), ("WVHT", "wave_height")):
        if src in df.columns:
            out[dst] = pd.to_numeric(df[src], errors="coerce")
    out["sensor_id"] = station
    return out.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("--station", required=True)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("-o", "--output", required=True)
    a = ap.parse_args()
    if not (-90 <= a.lat <= 90 and -180 <= a.lon <= 180):
        print("lat/lon out of range", file=sys.stderr)
        return 1
    try:
        out = to_canonical(read_ndbc(Path(a.input).read_text()), a.station, a.lat, a.lon)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    out.to_csv(a.output, index=False)
    print(f"Wrote {len(out)} rows to {a.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
