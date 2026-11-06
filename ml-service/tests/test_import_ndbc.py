"""Tests the NDBC converter against a small hand-written sample in the documented layout.

The sample reflects our reading of the NDBC format; it is not a downloaded file, so this verifies the
converter's logic, not that NOAA's current files match the assumptions.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from import_ndbc import read_ndbc, to_canonical  # noqa: E402

SAMPLE = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT    hPa  degC  degC  degC  nmi  hPa    ft
2024 03 01 01 00 180  5.0  6.0   1.2     7   5.5  170 1015.0  24.0  26.5  20.0   MM   MM    MM
2024 03 01 00 00 175  4.0  5.0  99.00     7   5.5  170 1015.0  24.0  26.4  20.0   MM   MM    MM
2024 03 01 02 00 185  5.0  6.0   1.3     7   5.5  170 1015.0  24.0    MM  20.0   MM   MM    MM
"""


class NdbcTests(unittest.TestCase):
    def test_converts_sorts_and_handles_missing_sentinels(self):
        out = to_canonical(read_ndbc(SAMPLE), "TEST1", 10.5, -70.25)
        self.assertEqual(list(out["timestamp"]), ["2024-03-01T00:00:00Z", "2024-03-01T01:00:00Z", "2024-03-01T02:00:00Z"])
        self.assertEqual(out["sea_surface_temperature"].iloc[0], 26.4)
        self.assertTrue(out["sea_surface_temperature"].isna().iloc[2])   # 'MM' -> missing
        self.assertTrue(out["wave_height"].isna().iloc[0])               # 99.00 sentinel -> missing
        self.assertEqual(set(out["sensor_id"]), {"TEST1"})
        self.assertEqual(out["latitude"].iloc[0], 10.5)

    def test_rejects_unrecognised_files(self):
        with self.assertRaises(ValueError):
            read_ndbc("hello\nworld\n")


if __name__ == "__main__":
    unittest.main()
