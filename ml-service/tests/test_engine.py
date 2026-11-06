"""Engine tests. Plain unittest style so they run under both unittest and pytest."""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from app.anomaly.detectors import compare_detectors, detect_iforest, detect_mad  # noqa: E402
from app.evaluation.benchmark import BenchConfig, clean_reference_frame, evaluate  # noqa: E402
from app.quality.checks import QualityConfig, assess_quality  # noqa: E402
from app.recovery.methods import fill, find_gaps  # noqa: E402
from app.recovery.pipeline import ReconConfig, reconstruct  # noqa: E402
from app.schema import apply_mapping, prepare  # noqa: E402
from app.uncertainty.intervals import HoldoutConfig, holdout_errors, summarize_errors  # noqa: E402
from generate_synthetic import generate  # noqa: E402


def make_series(n=300, seed=0, sensor="A", interval_min=60):
    rng = np.random.default_rng(seed)
    t = pd.Timestamp("2024-01-01", tz="UTC") + pd.to_timedelta(np.arange(n) * interval_min, unit="m")
    x = 25 + np.sin(np.arange(n) / 12) + rng.normal(0, 0.05, n)
    return pd.DataFrame({"timestamp": t, "sea_surface_temperature": x, "sensor_id": sensor})


def typed(df):
    return prepare(df)


class QualityTests(unittest.TestCase):
    def test_clean_data_has_no_high_severity_issues(self):
        df, p = typed(make_series())
        res = assess_quality(df, p)
        self.assertEqual(res["summary"]["missing_count"], 0)
        self.assertFalse([i for i in res["issues"] if i["severity"] == "high"])

    def test_missing_duplicates_invalid(self):
        raw = make_series(50)
        raw.loc[3, "sea_surface_temperature"] = np.nan
        raw["latitude"] = 10.0
        raw["longitude"] = 70.0
        raw.loc[5, "latitude"] = 123.0
        raw = pd.concat([raw, raw.iloc[[7]]], ignore_index=True)
        raw["timestamp"] = raw["timestamp"].astype(str)
        raw.loc[9, "timestamp"] = "not-a-date"
        raw["sea_surface_temperature"] = raw["sea_surface_temperature"].astype(object)
        raw.loc[11, "sea_surface_temperature"] = "abc"
        df, p = typed(raw)
        cats = {i["category"] for i in assess_quality(df, p)["issues"]}
        for c in ["missing_value", "invalid_coordinate", "duplicate_record", "invalid_timestamp", "non_numeric_value"]:
            self.assertIn(c, cats)

    def test_outlier_is_suspected_not_error(self):
        raw = make_series(200)
        raw.loc[100, "sea_surface_temperature"] += 8
        df, p = typed(raw)
        issues = [i for i in assess_quality(df, p)["issues"] if i["row_id"] == 100]
        self.assertTrue(issues)
        self.assertEqual(issues[0]["category"], "suspected_anomaly")
        self.assertIn("NOT confirmed", issues[0]["explanation"])

    def test_constant_run_and_delay(self):
        raw = make_series(100)
        raw.loc[20:30, "sea_surface_temperature"] = 26.0
        raw = raw.drop(index=range(60, 64)).reset_index(drop=True)
        df, p = typed(raw)
        res = assess_quality(df, p, QualityConfig(expected_interval_seconds=3600))
        cats = {i["category"] for i in res["issues"]}
        self.assertIn("constant_reading", cats)
        self.assertIn("delayed_observation", cats)

    def test_no_universal_physical_limits(self):
        raw = make_series(60)
        raw["sea_surface_temperature"] = 80.0 + np.arange(60) * 0.01  # absurd but no rule configured
        df, p = typed(raw)
        self.assertNotIn("out_of_configured_range", {i["category"] for i in assess_quality(df, p)["issues"]})
        cfg = QualityConfig(valid_ranges={"sea_surface_temperature": (-2.0, 40.0)})
        self.assertIn("out_of_configured_range", {i["category"] for i in assess_quality(df, p, cfg)["issues"]})

    def test_empty_and_missing_columns(self):
        df, p = typed(pd.DataFrame({"timestamp": []}))
        self.assertTrue(assess_quality(df, p)["empty"])

    def test_mapping_validation(self):
        raw = pd.DataFrame({"t": ["2024-01-01"], "sst_c": [20.0]})
        out = apply_mapping(raw, {"timestamp": "t", "sea_surface_temperature": "sst_c"})
        self.assertIn("sea_surface_temperature", out.columns)
        with self.assertRaises(ValueError):
            apply_mapping(raw, {"bogus_field": "t"})
        with self.assertRaises(ValueError):
            apply_mapping(raw, {"timestamp": "missing_col"})

    def test_original_not_modified(self):
        raw = make_series(40)
        raw.loc[2, "sea_surface_temperature"] = np.nan
        before = raw.copy()
        df, p = typed(raw)
        assess_quality(df, p)
        reconstruct(df, "sea_surface_temperature", ReconConfig(method="linear"))
        pd.testing.assert_frame_equal(raw, before)


class AnomalyTests(unittest.TestCase):
    def setUp(self):
        raw = make_series(300)
        raw.loc[[50, 150, 250], "sea_surface_temperature"] += [6, -6, 7]
        self.df, _ = typed(raw)

    def test_both_detect_obvious_spikes(self):
        res = compare_detectors(self.df, "sea_surface_temperature", truth_rows={50, 150, 250})
        self.assertEqual(res["mad"]["metrics"]["recall"], 1.0)
        self.assertEqual(res["isolation_forest"]["metrics"]["recall"], 1.0)
        self.assertIn("not confirmed", res["note"].lower())

    def test_normal_data_mad_flags_little(self):
        df, _ = typed(make_series(300, seed=3))
        self.assertLessEqual(int(detect_mad(df, "sea_surface_temperature")["flag"].sum()), 3)

    def test_constant_series_no_flags_no_crash(self):
        raw = make_series(100)
        raw["sea_surface_temperature"] = 20.0
        df, _ = typed(raw)
        self.assertEqual(int(detect_mad(df, "sea_surface_temperature")["flag"].sum()), 0)
        self.assertEqual(int(detect_iforest(df, "sea_surface_temperature")["flag"].sum()), 0)

    def test_tiny_and_all_nan_series(self):
        df, _ = typed(make_series(5))
        self.assertEqual(int(detect_mad(df, "sea_surface_temperature")["flag"].sum()), 0)
        raw = make_series(60)
        raw["sea_surface_temperature"] = np.nan
        df, _ = typed(raw)
        self.assertEqual(int(detect_iforest(df, "sea_surface_temperature")["flag"].sum()), 0)

    def test_missing_column_raises(self):
        with self.assertRaises(ValueError):
            compare_detectors(self.df, "salinity")

    def test_parameters_change_sensitivity(self):
        from app.anomaly.detectors import MadConfig
        strict = detect_mad(self.df, "sea_surface_temperature", MadConfig(z_threshold=2.0))["flag"].sum()
        loose = detect_mad(self.df, "sea_surface_temperature", MadConfig(z_threshold=10.0))["flag"].sum()
        self.assertGreaterEqual(strict, loose)


class RecoveryTests(unittest.TestCase):
    def series_with_gap(self, start=100, length=4):
        raw = make_series(300)
        truth = raw["sea_surface_temperature"].copy()
        raw.loc[start:start + length - 1, "sea_surface_temperature"] = np.nan
        return raw, truth

    def test_interior_fill_accuracy_and_provenance(self):
        raw, truth = self.series_with_gap()
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="linear"))
        recs = out["records"]
        self.assertEqual(len(recs), 4)
        for r in recs:
            self.assertEqual(r["status"], "reconstructed")
            self.assertIsNone(r["original_value"])
            self.assertAlmostEqual(r["reconstructed_value"], truth[r["row_id"]], delta=0.3)
            for key in ["method", "algorithm_version", "evidence", "uncertainty", "limitations", "timestamp"]:
                self.assertIn(key, r)

    def test_no_extrapolation_at_edges(self):
        raw = make_series(100)
        raw.loc[0:2, "sea_surface_temperature"] = np.nan
        raw.loc[97:99, "sea_surface_temperature"] = np.nan
        df, _ = typed(raw)
        for m in ["linear", "time", "rolling", "iterative", "mare"]:
            out = reconstruct(df, "sea_surface_temperature", ReconConfig(method=m, attach_uncertainty=False))
            self.assertTrue(all(r["status"] == "skipped" and r["reconstructed_value"] is None
                                for r in out["records"]), m)

    def test_max_gap_respected(self):
        raw, _ = self.series_with_gap(length=10)
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="linear", max_gap=5))
        self.assertTrue(all(r["status"] == "skipped" for r in out["records"]))

    def test_unsorted_input_is_sorted_by_time(self):
        raw, truth = self.series_with_gap()
        shuffled = raw.sample(frac=1, random_state=1)
        df, _ = typed(shuffled.reset_index(drop=True))
        # row_id follows shuffled order; truth lookup via timestamp
        tmap = dict(zip(raw["timestamp"], truth))
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="time", attach_uncertainty=False))
        for r in out["records"]:
            self.assertAlmostEqual(r["reconstructed_value"], tmap[pd.Timestamp(r["timestamp"])], delta=0.3)

    def test_sensors_not_mixed(self):
        a = make_series(200, sensor="A")
        b = make_series(200, seed=5, sensor="B")
        b["sea_surface_temperature"] += 10  # very different level
        a.loc[50:52, "sea_surface_temperature"] = np.nan
        df, _ = typed(pd.concat([a, b], ignore_index=True))
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="linear", attach_uncertainty=False))
        for r in out["records"]:
            self.assertLess(abs(r["reconstructed_value"] - 25), 2.5)  # nowhere near sensor B's ~35

    def test_duplicate_timestamps_reported_not_silently_used(self):
        raw, _ = self.series_with_gap()
        raw = pd.concat([raw, raw.iloc[[10]]], ignore_index=True)
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="linear", attach_uncertainty=False))
        self.assertTrue(any(e["reason"] == "duplicate_timestamp" for e in out["summary"]["excluded_rows"]))

    def test_insufficient_data_graceful(self):
        raw = make_series(6)
        raw.loc[2, "sea_surface_temperature"] = np.nan
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="mare"))
        self.assertEqual(out["records"][0]["status"], "abstained")
        self.assertIsNone(out["records"][0]["reconstructed_value"])

    def test_unknown_method_and_column(self):
        df, _ = typed(make_series(30))
        with self.assertRaises(ValueError):
            reconstruct(df, "sea_surface_temperature", ReconConfig(method="magic"))
        with self.assertRaises(ValueError):
            reconstruct(df, "salinity", ReconConfig())

    def test_find_gaps(self):
        s = pd.Series([1, np.nan, np.nan, 4, np.nan])
        g = find_gaps(s)
        self.assertEqual([(x["start"], x["length"], x["bounded"]) for x in g], [(1, 2, True), (4, 1, False)])

    def test_methods_do_not_mutate_input(self):
        raw, _ = self.series_with_gap()
        df, _ = typed(raw)
        s = pd.Series(df["sea_surface_temperature"].to_numpy(), index=pd.DatetimeIndex(df["timestamp"]))
        before = s.copy()
        for m in ["linear", "time", "rolling", "iterative"]:
            fill(m, s)
        pd.testing.assert_series_equal(s, before)


class MareTests(unittest.TestCase):
    def test_audit_decision_recorded(self):
        raw = make_series(300)
        raw.loc[100:103, "sea_surface_temperature"] = np.nan
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="mare"))
        dec = out["records"][0]["evidence"]["decision"]
        self.assertTrue(dec["candidates"])
        self.assertIn(dec["status"], {"reconstructed", "abstained"})
        self.assertTrue(dec["reason"])

    def test_abstains_on_sparse_series(self):
        raw = make_series(300)
        raw.loc[raw.index % 3 != 0, "sea_surface_temperature"] = np.nan  # 33% observed
        raw.loc[raw.index % 3 != 0, "sea_surface_temperature"] = np.nan
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="mare", min_obs_fraction=0.5))
        self.assertTrue(all(r["status"] in {"abstained", "skipped"} for r in out["records"]))
        self.assertTrue(any(r["status"] == "abstained" for r in out["records"]))

    def test_interval_width_gate_causes_abstention(self):
        raw = make_series(300)
        raw.loc[100:103, "sea_surface_temperature"] = np.nan
        df, _ = typed(raw)
        out = reconstruct(df, "sea_surface_temperature", ReconConfig(method="mare", max_relative_halfwidth=1e-9))
        self.assertTrue(all(r["status"] == "abstained" and r["reconstructed_value"] is None for r in out["records"]))


class UncertaintyTests(unittest.TestCase):
    def test_unavailable_when_few_residuals(self):
        s = pd.Series(np.arange(10.0), index=pd.date_range("2024", periods=10, freq="h", tz="UTC"))
        res = holdout_errors(s, "linear", 2, cfg=HoldoutConfig())
        self.assertFalse(summarize_errors(res)["available"])

    def test_interval_available_and_labelled_uncalibrated(self):
        raw = make_series(400)
        s = pd.Series(raw["sea_surface_temperature"].to_numpy(), index=pd.DatetimeIndex(raw["timestamp"]))
        u = summarize_errors(holdout_errors(s, "linear", 2))
        self.assertTrue(u["available"])
        self.assertFalse(u["calibrated"])
        self.assertLess(u["offset_low"], u["offset_high"])

    def test_calibration_window_respected(self):
        raw = make_series(400)
        s = pd.Series(raw["sea_surface_temperature"].to_numpy(), index=pd.DatetimeIndex(raw["timestamp"]))
        end = s.index[100]
        res_all = holdout_errors(s, "linear", 2)
        res_cal = holdout_errors(s, "linear", 2, calibration_end=end)
        self.assertLess(res_cal["candidates"], res_all["candidates"])
        self.assertLessEqual(res_cal["candidates"], 100)


class EvaluationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        obs, truth, _ = generate(seed=11, days=20, sensors=2)
        df, _ = prepare(obs)
        cls.ref, cls.spikes = clean_reference_frame(df, truth, "sea_surface_temperature", "truth_sst")

    def test_runs_and_is_reproducible(self):
        cfg = BenchConfig(n_repeats=1, scenarios=("random", "contiguous_short"), methods=("linear", "time", "mare"))
        a = evaluate(self.ref, "sea_surface_temperature", cfg)
        b = evaluate(self.ref, "sea_surface_temperature", cfg)
        self.assertEqual(a["status"], "ok")
        self.assertEqual([r["rmse"] for r in a["summary_table"]], [r["rmse"] for r in b["summary_table"]])
        for row in a["summary_table"]:
            self.assertIsNotNone(row["rmse"])
        self.assertTrue(a["verdict"])

    def test_insufficient_data(self):
        df, _ = prepare(make_series(30))
        self.assertEqual(evaluate(df, "sea_surface_temperature")["status"], "insufficient_data")

    def test_detection_is_scored_on_observed_data_with_spikes(self):
        obs, truth, _ = generate(seed=11, days=20, sensors=2)
        observed, _ = prepare(obs)
        ref, spikes = clean_reference_frame(observed, truth, "sea_surface_temperature", "truth_sst")
        cfg = BenchConfig(n_repeats=1, scenarios=("random",), methods=("linear",))
        res = evaluate(ref, "sea_surface_temperature", cfg, spike_rows=spikes, detection_df=observed)
        m = res["anomaly_detection"]["mad"]["metrics"]
        self.assertGreater(len(spikes), 0)
        self.assertGreater(m["recall"], 0.8)  # spikes of 3-7 deg are obvious; a 0 here means the wrong frame was scored
        with self.assertRaises(ValueError):
            evaluate(ref, "sea_surface_temperature", cfg, spike_rows=spikes)  # detection_df is mandatory with labels


class GeneratorTests(unittest.TestCase):
    def test_same_seed_same_output_and_labels(self):
        a, ta, _ = generate(seed=5, days=5, sensors=2)
        b, tb, _ = generate(seed=5, days=5, sensors=2)
        pd.testing.assert_frame_equal(a, b)
        pd.testing.assert_frame_equal(ta, tb)
        c, _, _ = generate(seed=6, days=5, sensors=2)
        self.assertFalse(a.equals(c))
        self.assertTrue((ta["label"] == "SYNTHETIC").all())
        self.assertGreater(int(ta["is_spike"].sum()), 0)
        self.assertGreater(int(ta["is_duplicate"].sum()), 0)


if __name__ == "__main__":
    unittest.main()
