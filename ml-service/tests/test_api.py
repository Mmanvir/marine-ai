"""Handler tests (no FastAPI needed) plus HTTP tests that run only if FastAPI is installed."""
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import handlers as h  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SYN = ROOT / "data" / "synthetic"
HAS_DATA = (SYN / "marine_synthetic.csv").exists()


def small_csv():
    import numpy as np
    import pandas as pd
    t = pd.date_range("2024-01-01", periods=300, freq="h", tz="UTC")
    x = 25 + np.sin(np.arange(300) / 12)
    df = pd.DataFrame({"time": t.astype(str), "sst": x, "station": "S1"})
    df.loc[100:103, "sst"] = np.nan
    return df.to_csv(index=False)


class HandlerTests(unittest.TestCase):
    def test_profile_suggests_mapping(self):
        p = h.profile(small_csv())
        self.assertEqual(p["n_rows"], 300)
        self.assertEqual(p["suggested_mapping"]["sea_surface_temperature"], "sst")
        self.assertEqual(p["suggested_mapping"]["timestamp"], "time")
        types = {c["name"]: c["type"] for c in p["columns"]}
        self.assertEqual(types["sst"], "numeric")
        self.assertEqual(types["time"], "datetime")

    def test_quality_reports_missing(self):
        m = {"timestamp": "time", "sea_surface_temperature": "sst", "sensor_id": "station"}
        q = h.quality(small_csv(), m, None)
        self.assertEqual(q["summary"]["missing_count"], 4)
        json.dumps(q)  # JSON-safe

    def test_reconstruct_keeps_originals_and_json_safe(self):
        m = {"timestamp": "time", "sea_surface_temperature": "sst", "sensor_id": "station"}
        r = h.reconstruct_handler(small_csv(), m, "sea_surface_temperature", "mare", 24, 0.5, None, 0.1, 0)
        json.dumps(r)
        self.assertEqual(len(r["records"]), 4)
        self.assertIn("sea_surface_temperature__estimated", r["processed_csv"].splitlines()[0])
        import io
        import pandas as pd
        orig = pd.read_csv(io.StringIO(small_csv()), dtype=str)
        proc = pd.read_csv(io.StringIO(r["processed_csv"]), dtype=str)
        pd.testing.assert_series_equal(orig["sst"], proc["sst"])  # original column untouched

    def test_bad_inputs(self):
        with self.assertRaises(h.BadRequest):
            h.profile("")
        with self.assertRaises(h.BadRequest):
            h.quality(small_csv(), {"timestamp": "nope"}, None)
        with self.assertRaises(h.BadRequest):
            h.reconstruct_handler(small_csv(), {"timestamp": "time"}, "salinity", "mare", 24, .5, None, .1, 0)

    @unittest.skipUnless(HAS_DATA, "run scripts/generate_synthetic.py first")
    def test_anomalies_and_evaluate_on_synthetic(self):
        text = (SYN / "marine_synthetic.csv").read_text()
        truth = (SYN / "marine_synthetic_truth.csv").read_text()
        a = h.anomalies(text, None, ["sea_surface_temperature"], None, None)
        json.dumps(a)
        self.assertGreater(len(a["columns"]["sea_surface_temperature"]["flagged"]), 0)
        e = h.evaluate_handler(text, None, "sea_surface_temperature", 1, 7, 24, 0.1, truth)
        json.dumps(e)
        self.assertEqual(e["status"], "ok")
        self.assertIn("SYNTHETIC", e["reference_source"])


try:
    from fastapi.testclient import TestClient
    from app.main import app
    HAS_FASTAPI = True
except Exception:  # fastapi/httpx not installed
    HAS_FASTAPI = False


@unittest.skipUnless(HAS_FASTAPI, "fastapi + httpx not installed")
class HttpTests(unittest.TestCase):
    def setUp(self):
        os.environ["ML_SERVICE_TOKEN"] = "test-token"
        self.c = TestClient(app)

    def test_health_open_and_token_enforced(self):
        self.assertEqual(self.c.get("/health").status_code, 200)
        self.assertEqual(self.c.post("/v1/profile", json={"csv": "a\n1"}).status_code, 401)
        ok = self.c.post("/v1/profile", json={"csv": "a\n1"}, headers={"X-Service-Token": "test-token"})
        self.assertEqual(ok.status_code, 200)

    def test_bad_csv_is_422(self):
        r = self.c.post("/v1/quality", json={"csv": "  "}, headers={"X-Service-Token": "test-token"})
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
