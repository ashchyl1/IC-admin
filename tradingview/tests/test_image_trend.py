"""Tests for image_trend.py, fit_weights.py, and the Pine script against both.

    cd tradingview && python3 -m unittest discover -s tests -v

The Pine parity tests run re_imaged_trendlines.pine through Resin, an offline Pine
v5/v6 compiler and runtime, and compare it bar by bar with image_trend.py. They
are skipped unless RESIN_DIR points at a Resin checkout or unpacked npm package
(npm pack @nullarch/resin) and Node >= 22.18 is on PATH.
"""

from __future__ import annotations

import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

import fit_weights  # noqa: E402
import image_trend as it  # noqa: E402

PINE = ROOT / "re_imaged_trendlines.pine"


def synthetic_bars(n_bars: int, seed: int, flat_at: int | None = None, volume: bool = True) -> dict:
    """Trending and ranging stretches, with repeated highs and an optional flat block."""
    rng = np.random.default_rng(seed)
    drift = np.repeat(rng.normal(0, 0.004, n_bars // 40 + 1), 40)[:n_bars]
    close = 100 * np.exp(np.cumsum(drift + rng.normal(0, 0.012, n_bars)))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.003, n_bars))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.006, n_bars)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.006, n_bars)))
    # Equal highs and lows, so collinear hull points get exercised.
    for i in range(30, n_bars - 7, 37):
        high[i : i + 3] = high[i]
        low[i + 5 : i + 7] = low[i + 5]
        high[i : i + 3] = np.maximum(high[i : i + 3], np.maximum(open_[i : i + 3], close[i : i + 3]))
        low[i + 5 : i + 7] = np.minimum(low[i + 5 : i + 7], np.minimum(open_[i + 5 : i + 7], close[i + 5 : i + 7]))
    if flat_at is not None:
        p = close[flat_at - 1]
        for a in (open_, high, low, close):
            a[flat_at : flat_at + 70] = p
    vol = rng.integers(1_000, 90_000, n_bars).astype(float) if volume else np.zeros(n_bars)
    if volume:
        vol[::23] = 0.0
    return {"open": open_, "high": high, "low": low, "close": close, "volume": vol}


def naive_features(b: dict, n: int, t: int) -> np.ndarray | None:
    """Straight loop over one window, for checking the vectorised version."""
    if t < 2 * n - 2:
        return None
    lo, hi = t - n + 1, t + 1
    hmax, lmin = max(b["high"][lo:hi]), min(b["low"][lo:hi])
    if not hmax > lmin:
        return None
    vols = [0.0 if math.isnan(v) else v for v in b["volume"][lo:hi]]
    vmax = max(vols)
    out = []
    for k, i in enumerate(range(lo, hi)):
        ma = sum(b["close"][i - n + 1 : i + 1]) / n
        rng = hmax - lmin
        out += [
            (b["open"][i] - lmin) / rng,
            (b["high"][i] - lmin) / rng,
            (b["low"][i] - lmin) / rng,
            (b["close"][i] - lmin) / rng,
            min(1.0, max(0.0, (ma - lmin) / rng)),
            vols[k] / vmax if vmax > 0 else 0.0,
        ]
    return np.asarray(out)


class ImageFeatureTests(unittest.TestCase):
    def setUp(self):
        self.b = synthetic_bars(260, seed=1)

    def feats(self, b=None, n=20):
        b = b or self.b
        return it.image_features(b["open"], b["high"], b["low"], b["close"], b["volume"], n)

    def test_matches_naive_loop(self):
        for n in it.LOOKBACKS:
            f = self.feats(n=n)
            for t in range(len(self.b["close"])):
                expect = naive_features(self.b, n, t)
                if expect is None:
                    self.assertTrue(np.isnan(f[t]).all(), (n, t))
                else:
                    np.testing.assert_allclose(f[t], expect, rtol=0, atol=1e-12)

    def test_first_defined_row_is_2n_minus_2(self):
        for n in it.LOOKBACKS:
            f = self.feats(n=n)
            self.assertTrue(np.isnan(f[2 * n - 3]).all())
            self.assertFalse(np.isnan(f[2 * n - 2]).any())

    def test_scale_free(self):
        """The image depends on shape, not on price level, units or volume scale."""
        moved = {k: v * 7.3 + 41.0 for k, v in self.b.items() if k != "volume"}
        moved["volume"] = self.b["volume"] * 1000.0
        np.testing.assert_allclose(self.feats(moved), self.feats(), atol=1e-12, equal_nan=True)

    def test_range_and_layout(self):
        f = self.feats()
        rows = f[~np.isnan(f).any(axis=1)]
        self.assertTrue((rows >= -1e-12).all() and (rows <= 1 + 1e-12).all())
        n = 20
        hi = rows[:, [it.feature_index(k, "high", n) for k in range(n)]]
        lo = rows[:, [it.feature_index(k, "low", n) for k in range(n)]]
        np.testing.assert_allclose(hi.max(axis=1), 1.0)
        np.testing.assert_allclose(lo.min(axis=1), 0.0, atol=1e-12)

    def test_flat_window_is_undefined(self):
        b = synthetic_bars(260, seed=2, flat_at=120)
        f = it.image_features(b["open"], b["high"], b["low"], b["close"], b["volume"], 20)
        self.assertTrue(np.isnan(f[150]).all())
        self.assertFalse(np.isnan(f[110]).any())

    def test_no_volume_reads_as_zero(self):
        b = synthetic_bars(120, seed=3)
        f = it.image_features(b["open"], b["high"], b["low"], b["close"], None, 5)
        vcols = [it.feature_index(k, "volume", 5) for k in range(5)]
        self.assertTrue((f[20:, vcols] == 0).all())


class PriorTests(unittest.TestCase):
    def test_prior_reads_only_the_last_close(self):
        n = 20
        w = it.prior_weights(n)
        self.assertEqual(len(w), 1 + 6 * n)
        self.assertEqual(np.count_nonzero(w[1:]), 1)
        self.assertEqual(w[1 + it.feature_index(n - 1, "close", n)], -it.PRIOR_STRENGTH)

    def test_low_close_leans_up(self):
        n = 5
        x = np.zeros((3, 6 * n))
        x[:, it.feature_index(n - 1, "close", n)] = [0.0, 0.5, 1.0]
        p = it.predict_proba(x, it.prior_weights(n))
        self.assertGreater(p[0], 0.5)
        self.assertAlmostEqual(p[1], 0.5)
        self.assertLess(p[2], 0.5)
        self.assertTrue(0.43 < p[2] and p[0] < 0.57)

    def test_weights_text_round_trip(self):
        w = np.random.default_rng(0).normal(0, 0.3, 31)
        text = it.format_weights(w, 5, 3)
        self.assertTrue(text.startswith("N=5, h=3, "))
        parsed = it.parse_weights(text)
        self.assertEqual((parsed.n, parsed.horizon), (5, 3))
        np.testing.assert_allclose(parsed.weights, w, atol=5e-7)
        self.assertNotIn("e", text.split("h=3,")[1])

    def test_parse_is_lenient_about_layout(self):
        parsed = it.parse_weights("N=5\n 0.1;-0.2  0.3 ,, junk, 4")
        np.testing.assert_allclose(parsed.weights, [0.1, -0.2, 0.3, 4.0])
        self.assertEqual(parsed.n, 5)


class TrendlineTests(unittest.TestCase):
    def brute_force(self, ys, upper):
        """Best line through two points that bounds all points: minimal total gap."""
        best = None
        n = len(ys)
        for i in range(n):
            for j in range(i + 1, n):
                slope = (ys[j] - ys[i]) / (j - i)
                line = np.array([ys[i] + slope * (k - i) for k in range(n)])
                gap = line - ys if upper else ys - line
                if gap.min() < -1e-9:
                    continue
                total = gap.sum()
                if best is None or total < best - 1e-9:
                    best = total
        return best

    def test_tightest_line_is_optimal(self):
        rng = np.random.default_rng(5)
        for trial in range(300):
            n = int(rng.integers(2, 40))
            ys = np.cumsum(rng.normal(0, 1, n))
            if trial % 3 == 0:
                ys = np.round(ys)  # ties and collinear runs
            for upper in (True, False):
                i1, i2 = it.tightest_line(list(ys), upper)
                self.assertLess(i1, i2)
                slope = (ys[i2] - ys[i1]) / (i2 - i1)
                line = ys[i1] + slope * (np.arange(n) - i1)
                gap = line - ys if upper else ys - line
                self.assertGreaterEqual(gap.min(), -1e-9)
                self.assertAlmostEqual(gap.sum(), self.brute_force(ys, upper), places=6)

    def test_anchors_straddle_the_centre(self):
        i1, i2 = it.tightest_line([5, 4, 3, 2, 1, 0, 9, 1, 2], True)
        self.assertLessEqual(i1, 4)
        self.assertGreater(i2, 4)

    def test_break_needs_a_close_beyond_the_projection(self):
        # Highs fall 1 per bar from 30, so resistance projects to 30 - W at bar W.
        w = 10
        high = [30.0 - k for k in range(w)] + [25.0]
        low = [h - 5 for h in high]
        close = [h - 1 for h in high[:-1]] + [20.5]
        run = it.run_trendlines(high, low, close, w, 0, [math.nan] * len(close), 0.53, 0.47)
        self.assertAlmostEqual(run.resistance[w].projected, 20.0)
        self.assertTrue(run.up_break[w])
        self.assertEqual([(b.bar, b.direction) for b in run.breaks], [(w, 1)])

    def test_cooldown(self):
        b = synthetic_bars(400, seed=11)
        p = np.full(400, math.nan)
        free = it.run_trendlines(b["high"], b["low"], b["close"], 20, 0, p, 0.53, 0.47)
        slow = it.run_trendlines(b["high"], b["low"], b["close"], 20, 8, p, 0.53, 0.47)
        self.assertGreater(len(free.breaks), len(slow.breaks))
        for d in (1, -1):
            bars = [x.bar for x in slow.breaks if x.direction == d]
            raw = np.flatnonzero(slow.up_break if d > 0 else slow.down_break)
            for t in bars:
                self.assertFalse(((raw < t) & (raw >= t - 8)).any())

    def test_grades(self):
        self.assertEqual(it.grade_break(1, 0.60, 0.53, 0.47), "confirmed")
        self.assertEqual(it.grade_break(1, 0.40, 0.53, 0.47), "contrary")
        self.assertEqual(it.grade_break(-1, 0.40, 0.53, 0.47), "confirmed")
        self.assertEqual(it.grade_break(-1, 0.50, 0.53, 0.47), "neutral")
        self.assertEqual(it.grade_break(1, math.nan, 0.53, 0.47), "neutral")


class FitTests(unittest.TestCase):
    def test_recovers_planted_weights(self):
        rng = np.random.default_rng(3)
        x = rng.random((60_000, 8)).astype(np.float32)
        w_true = np.array([-0.4, 1.5, -1.0, 0.0, 0.8, 0.0, -0.6, 0.3, 0.0])
        y = (rng.random(len(x)) < it.sigmoid(w_true[0] + x @ w_true[1:])).astype(np.int8)
        w = fit_weights.fit_logit(x, y, l2=1e-6)
        np.testing.assert_allclose(w, w_true, atol=0.12)

    def test_cli_end_to_end(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            days = pd.bdate_range("2015-01-01", periods=900)
            for s in range(4):
                b = synthetic_bars(900, seed=100 + s)
                df = pd.DataFrame({"Date": days.strftime("%Y-%m-%d"), "Open": b["open"], "High": b["high"],
                                   "Low": b["low"], "Close": b["close"], "Volume": b["volume"]})
                df.to_csv(tmp / f"SYM{s}.csv", index=False)
            out = tmp / "w.json"
            with redirect_stdout(io.StringIO()) as log:
                code = fit_weights.main(["--data", str(tmp), "--lookback", "5", "--horizon", "3",
                                         "--min-names", "2", "--out", str(out)])
            self.assertEqual(code, 0)
            res = json.loads(out.read_text())
            self.assertEqual(len(res["weights"]), 31)
            parsed = it.parse_weights(res["pine_text"])
            self.assertEqual((parsed.n, parsed.horizon, len(parsed.weights)), (5, 3, 31))
            self.assertIn("Paste into 'Fitted weights'", log.getvalue())
            self.assertGreater(res["train_rows"], 0)
            self.assertGreater(res["test_rows"], 0)
        finally:
            shutil.rmtree(tmp)

    def test_training_rows_never_see_test_labels(self):
        b = synthetic_bars(300, seed=9)
        frames = {"A": pd.DataFrame({"time": pd.bdate_range("2020-01-01", periods=300), **b})}
        s = fit_weights.build_samples(frames, 5, 10, 1)
        split = np.sort(s.time)[200]
        train = s.take(s.label_time < split)
        self.assertTrue((train.time < split).all())
        self.assertTrue((train.label_time < split).all())


# ---------------------------------------------------------------------------
# Pine script vs reference
# ---------------------------------------------------------------------------

RESIN_DIR = os.environ.get("RESIN_DIR")
NODE = shutil.which("node")


def _node_ok() -> bool:
    if not NODE:
        return False
    out = subprocess.run([NODE, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    major, minor = (int(x) for x in out.split(".")[:2])
    return (major, minor) >= (22, 18)


@unittest.skipUnless(RESIN_DIR and _node_ok(), "set RESIN_DIR to a Resin checkout and use Node >= 22.18")
class PineParityTests(unittest.TestCase):
    DEFAULT_COLORS = {"confirmed_up": "#00c853", "confirmed_dn": "#d50000", "contrary": "#ff9800", "neutral": "#9e9e9e"}

    def run_pine(self, bars: dict, inputs: dict) -> dict:
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "bars.json").write_text(json.dumps({k: list(map(float, v)) for k, v in bars.items()}))
            (tmp / "inputs.json").write_text(json.dumps(inputs))
            proc = subprocess.run(
                [NODE, "--import", str(Path(RESIN_DIR) / "register.mjs"), str(HERE / "run_pine.mjs"),
                 RESIN_DIR, str(PINE), str(tmp / "bars.json"), str(tmp / "inputs.json")],
                capture_output=True, text=True, timeout=300,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            return json.loads(proc.stdout)
        finally:
            shutil.rmtree(tmp)

    def check(self, bars: dict, n: int, window: int, cooldown: int, p_hi=0.53, p_lo=0.47,
              weights_text: str = "", horizon_input: int = 5):
        inputs = {"Image lookback N": n, "Trendline window W": window, "Bars between same-side signals": cooldown,
                  "P(up) high": p_hi, "P(up) low": p_lo, "Fitted weights": weights_text,
                  "Forecast horizon h": horizon_input}
        pine = self.run_pine(bars, inputs)

        parsed = it.parse_weights(weights_text)
        fitted = len(parsed.weights) == 1 + 6 * n and (parsed.n is None or parsed.n == n)
        w = parsed.weights if fitted else it.prior_weights(n)
        h = parsed.horizon if fitted and parsed.horizon else horizon_input

        feats = it.image_features(bars["open"], bars["high"], bars["low"], bars["close"], bars["volume"], n)
        p = it.predict_proba(feats, w)
        nan = lambda xs: np.array([np.nan if v is None else v for v in xs], dtype=float)

        np.testing.assert_allclose(nan(pine["plots"]["P(up)"]), p, rtol=0, atol=1e-12, equal_nan=True)
        np.testing.assert_allclose(nan(pine["plots"]["Close in image range"]),
                                   feats[:, it.feature_index(n - 1, "close", n)], atol=1e-12, equal_nan=True)

        win = window or n
        run = it.run_trendlines(bars["high"], bars["low"], bars["close"], win, cooldown, p, p_hi, p_lo)
        res = np.array([np.nan if r is None else r.projected for r in run.resistance])
        sup = np.array([np.nan if s is None else s.projected for s in run.support])
        np.testing.assert_allclose(nan(pine["plots"]["Resistance at bar"]), res, atol=1e-9, equal_nan=True)
        np.testing.assert_allclose(nan(pine["plots"]["Support at bar"]), sup, atol=1e-9, equal_nan=True)

        for title, d in (("Resistance break", 1), ("Support break", -1)):
            pine_bars = [i for i, c in enumerate(pine["shapes"][title]["condition"]) if c]
            ref = [b for b in run.breaks if b.direction == d]
            self.assertEqual(pine_bars, [b.bar for b in ref], title)
            colors = pine["shapes"][title]["colors"]
            for b in ref:
                key = "contrary" if b.grade == "contrary" else "neutral" if b.grade == "neutral" else (
                    "confirmed_up" if d > 0 else "confirmed_dn")
                self.assertEqual(colors[b.bar].lower()[:7], self.DEFAULT_COLORS[key], (title, b.bar, b.grade))

        broken = [ln for ln in pine["lines"] if ln.get("extend") != "right"]
        self.assertEqual(len(broken), len(run.breaks))
        for ln, b in zip(sorted(broken, key=lambda x: (x["bar"], x["y1"])),
                         sorted(run.breaks, key=lambda x: (x.bar, x.line.price1))):
            self.assertEqual((ln["x1"], ln["x2"]), (b.line.bar1, b.bar))
            self.assertAlmostEqual(ln["y1"], b.line.price1, places=9)
            self.assertAlmostEqual(ln["y2"], b.line.projected, places=9)

        live = [ln for ln in pine["lines"] if ln.get("extend") == "right"]
        last = len(bars["close"]) - 1
        self.assertEqual(len(live), 2)
        self.assertEqual({(ln["x1"], ln["x2"]) for ln in live},
                         {(run.resistance[last].bar1, run.resistance[last].bar2),
                          (run.support[last].bar1, run.support[last].bar2)})

        sc = it.scorecard(bars["close"], p, h, p_hi, p_lo, run.breaks)
        v = pine["vars"]
        self.assertEqual(
            {k: v[k] for k in ("nAll", "upAll", "nHi", "upHi", "nLo", "upLo", "nBrkUp", "upBrkUp", "nBrkDn", "upBrkDn")},
            {"nAll": sc.n_all, "upAll": sc.up_all, "nHi": sc.n_hi, "upHi": sc.up_hi, "nLo": sc.n_lo,
             "upLo": sc.up_lo, "nBrkUp": sc.n_brk_up, "upBrkUp": sc.up_brk_up, "nBrkDn": sc.n_brk_dn,
             "upBrkDn": sc.up_brk_dn},
        )
        self.assertGreater(len(run.breaks), 3, "test data should produce breaks")
        return run

    def test_prior_i20(self):
        self.check(synthetic_bars(500, seed=21, flat_at=300), n=20, window=0, cooldown=5)

    def test_fitted_i5_with_metadata(self):
        w = np.random.default_rng(4).normal(0, 0.8, 31)
        text = it.format_weights(w, 5, 3).replace(", ", ",\n", 7)
        run = self.check(synthetic_bars(400, seed=22), n=5, window=12, cooldown=0, p_hi=0.52, p_lo=0.48,
                         weights_text=text, horizon_input=9)
        grades = {b.grade for b in run.breaks}
        self.assertTrue({"confirmed", "contrary"} <= grades, grades)

    def test_prior_i60_custom_window(self):
        self.check(synthetic_bars(700, seed=23), n=60, window=30, cooldown=3)

    def test_rejected_weights_fall_back_to_prior(self):
        self.check(synthetic_bars(300, seed=24), n=20, window=0, cooldown=5, weights_text="N=5, 0.1, 0.2, 0.3")

    def test_no_volume(self):
        self.check(synthetic_bars(300, seed=25, volume=False), n=20, window=0, cooldown=2)


if __name__ == "__main__":
    unittest.main()
