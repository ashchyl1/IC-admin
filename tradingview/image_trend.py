"""Reference implementation of the Re-Imaged Trendlines indicator.

This module mirrors ``re_imaged_trendlines.pine`` bar for bar. It exists for two
reasons: ``fit_weights.py`` must train on exactly the numbers the indicator reads,
and the Pine script needs an independent implementation to be checked against
(``tests/test_image_trend.py`` runs both on the same bars).

The chart "image"
-----------------
Jiang, Kelly and Xiu, "(Re-)Imag(in)ing Price Trends", Journal of Finance 78(6),
2023, feed a CNN black-and-white charts of the last N = 5, 20 or 60 days: daily
open/high/low/close bars, an N-day moving average, and volume bars. Every chart is
rescaled so the window's highest high and lowest low span the image height, and
the window's largest volume spans the volume panel. The indicator does the same
rescale, then reads the image as 6N numbers:

    for each day k = 0 (oldest) .. N-1 (newest):
        open, high, low, close   (p - lowest_low) / (highest_high - lowest_low)
        ma                       same, clipped to [0, 1]: off-image MA is not drawn
        volume                   volume / largest_volume_in_window (0 if no volume)

Feature j = 6*k + channel, channel order (open, high, low, close, ma, volume).

The score
---------
The CNN cannot run inside Pine Script, which caps a script at 100,000 compiled
tokens and each loop at 500 ms per bar. The paper's own closest simple stand-in is
a logistic model on these image-scaled numbers, so the indicator computes

    P(up) = 1 / (1 + exp(-(w0 + sum_j w[1+j] * x_j)))

with weights fitted by ``fit_weights.py``. Until weights are fitted it uses a
one-feature prior built only on the pattern the paper itself names: a close at
the low end of the image range is followed by higher returns.

Trendlines
----------
The resistance line over a window is the line that no high in the window rises
above and that sits as close to the highs as possible, i.e. it minimises the total
gap sum(line(x) - high(x)). That line is the edge of the upper convex hull of the
highs that spans the window's centre. It always touches at least two highs and
has no tuning parameter. Support is the mirror image on the lows. Lines are fitted
on the W bars before the current bar and projected one bar forward, so the
current close can break them.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

LOOKBACKS = (5, 20, 60)
CHANNELS = ("open", "high", "low", "close", "ma", "volume")
N_CHANNELS = len(CHANNELS)

# Logit change from a close at the image low to one at the image high under the
# prior. 0.5 keeps P(up) within roughly 0.44-0.56, the range implied by the
# ~53% directional accuracy the paper reports; it is a scale, not a fitted value.
PRIOR_STRENGTH = 0.5


# ---------------------------------------------------------------------------
# Image features
# ---------------------------------------------------------------------------


def sma(x: Sequence[float], n: int) -> np.ndarray:
    """Trailing simple moving average; NaN until n values exist (as ta.sma)."""
    x = np.asarray(x, dtype=float)
    out = np.full(x.shape, np.nan)
    if n <= 0 or len(x) < n:
        return out
    out[n - 1 :] = sliding_window_view(x, n).mean(axis=1)
    return out


def feature_index(day: int, channel: str, n: int) -> int:
    """Position of (day, channel) in the 6N feature vector. day 0 is the oldest."""
    if not 0 <= day < n:
        raise ValueError(f"day must be in [0, {n}), got {day}")
    return N_CHANNELS * day + CHANNELS.index(channel)


def image_features(
    open_: Sequence[float],
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    volume: Sequence[float] | None,
    n: int,
) -> np.ndarray:
    """Image-scaled features for every bar, shape (T, 6n).

    Row t describes the image whose newest day is bar t. Rows are NaN until the
    moving average exists for the image's oldest day (t >= 2n - 2) and when the
    window has no range (highest high == lowest low).
    """
    o, h, l, c = (np.asarray(a, dtype=float) for a in (open_, high, low, close))
    t_len = len(c)
    vol = (
        np.zeros(t_len)
        if volume is None
        else np.nan_to_num(np.asarray(volume, dtype=float), nan=0.0)
    )
    out = np.full((t_len, n, N_CHANNELS), np.nan)
    if t_len < 2 * n - 1:
        return out.reshape(t_len, N_CHANNELS * n)

    ma = sma(c, n)
    win = lambda a: sliding_window_view(a, n)  # row r covers bars r .. r+n-1
    wo, wh, wl, wc, wm, wv = (win(a) for a in (o, h, l, c, ma, vol))

    hmax = wh.max(axis=1)[:, None]
    lmin = wl.min(axis=1)[:, None]
    rng = hmax - lmin
    vmax = wv.max(axis=1)[:, None]
    ends = np.arange(n - 1, t_len)
    valid = (ends >= 2 * n - 2) & (rng[:, 0] > 0)

    with np.errstate(divide="ignore", invalid="ignore"):
        scale = lambda a: (a - lmin) / rng
        feats = np.stack(
            [
                scale(wo),
                scale(wh),
                scale(wl),
                scale(wc),
                np.clip(scale(wm), 0.0, 1.0),
                np.where(vmax > 0, wv / np.where(vmax > 0, vmax, 1.0), 0.0),
            ],
            axis=2,
        )
    feats[~valid] = np.nan
    out[n - 1 :] = feats
    return out.reshape(t_len, N_CHANNELS * n)


# ---------------------------------------------------------------------------
# Logistic score
# ---------------------------------------------------------------------------


def prior_weights(n: int, strength: float = PRIOR_STRENGTH) -> np.ndarray:
    """Unfitted weights: only the last close's position in the image range.

    P(up) = sigmoid(strength * (0.5 - close_position)), so a close at the image
    low gives P > 0.5 and a close at the image high gives P < 0.5.
    """
    w = np.zeros(1 + N_CHANNELS * n)
    w[0] = strength / 2.0
    w[1 + feature_index(n - 1, "close", n)] = -strength
    return w


def sigmoid(z: np.ndarray | float) -> np.ndarray:
    z = np.asarray(z, dtype=float)
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    ez = np.exp(z[~pos])
    out[~pos] = ez / (1.0 + ez)
    return out


def predict_proba(features: np.ndarray, weights: Sequence[float]) -> np.ndarray:
    """P(up) for each row of `features` (NaN rows stay NaN)."""
    w = np.asarray(weights, dtype=float)
    if features.shape[1] + 1 != len(w):
        raise ValueError(
            f"{len(w)} weights do not fit {features.shape[1]} features "
            f"(need {features.shape[1] + 1})"
        )
    return sigmoid(w[0] + features @ w[1:])


def format_weights(weights: Sequence[float], n: int, horizon: int) -> str:
    """The text pasted into the indicator's "Fitted weights" box.

    Fixed-point numbers only: Pine's str.tonumber is not documented to accept
    exponent notation.
    """
    w = np.asarray(weights, dtype=float)
    if len(w) != 1 + N_CHANNELS * n:
        raise ValueError(f"expected {1 + N_CHANNELS * n} weights for N={n}, got {len(w)}")
    body = ", ".join(f"{x:.6f}" for x in w)
    return f"N={n}, h={horizon}, {body}"


@dataclass
class ParsedWeights:
    weights: np.ndarray
    n: int | None = None
    horizon: int | None = None


def parse_weights(text: str) -> ParsedWeights:
    """Parse the weights box the way the Pine script does.

    Tokens are separated by commas, spaces, newlines or semicolons. "N=.." and
    "h=.." are metadata; every other token that parses as a number is a weight,
    in order. Tabs are not separators: the Pine script uses no string escape
    other than the newline.
    """
    cleaned = text
    for sep in ("\n", " ", ";"):
        cleaned = cleaned.replace(sep, ",")
    weights: list[float] = []
    n_meta = h_meta = None
    for tok in cleaned.split(","):
        if not tok:
            continue
        if tok.startswith("N="):
            n_meta = _to_int(tok[2:])
        elif tok.startswith("h="):
            h_meta = _to_int(tok[2:])
        elif _PLAIN_NUMBER.match(tok):
            weights.append(float(tok))
    return ParsedWeights(np.asarray(weights, dtype=float), n_meta, h_meta)


# What format_weights writes. Anything else (exponents, "nan", "inf") is skipped
# rather than guessed at, since str.tonumber's grammar is not documented.
_PLAIN_NUMBER = re.compile(r"^-?(\d+(\.\d*)?|\.\d+)$")


def _to_int(s: str) -> int | None:
    try:
        return int(round(float(s)))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Trendlines
# ---------------------------------------------------------------------------


def hull_vertices(ys: Sequence[float], upper: bool) -> list[int]:
    """Indices of the upper (or lower) convex hull of points (i, ys[i]).

    Andrew's monotone chain; points are already sorted by x. Collinear points are
    dropped, so consecutive edges turn strictly. The cross product is written in
    the same operation order as the Pine script so both make identical decisions.
    """
    hull: list[int] = []
    for i, yi in enumerate(ys):
        while len(hull) >= 2:
            o, a = hull[-2], hull[-1]
            cr = (a - o) * (yi - ys[o]) - (ys[a] - ys[o]) * (i - o)
            if (upper and cr >= 0) or (not upper and cr <= 0):
                hull.pop()
            else:
                break
        hull.append(i)
    return hull


def tightest_line(ys: Sequence[float], upper: bool) -> tuple[int, int]:
    """Anchor indices (i1 < i2) of the tightest bounding line over ys.

    For upper=True: among lines with ys[i] <= line(i) for all i, the one that
    minimises sum(line(i) - ys[i]). That sum equals len(ys) * (line(xc) - mean),
    so the answer is the hull edge spanning xc = (len - 1) / 2. When xc falls on a
    vertex the edge to its right (the more recent one) is used.
    """
    if len(ys) < 2:
        raise ValueError("need at least two points")
    hull = hull_vertices(ys, upper)
    xc = (len(ys) - 1) / 2.0
    for j in range(len(hull) - 1):
        if hull[j] <= xc < hull[j + 1]:
            return hull[j], hull[j + 1]
    raise AssertionError("hull always spans its own centre")  # pragma: no cover


@dataclass
class LineFit:
    """A trendline fitted on bars [t - W, t - 1] and projected to bar t."""

    bar1: int  # bar index of the older anchor
    price1: float
    bar2: int  # bar index of the newer anchor
    price2: float
    projected: float  # line value at the current bar t

    def value_at(self, bar: int) -> float:
        slope = (self.price2 - self.price1) / (self.bar2 - self.bar1)
        return self.price1 + slope * (bar - self.bar1)


def fit_line(ys: Sequence[float], window_start: int, upper: bool) -> LineFit:
    """Fit on ys (one value per bar starting at window_start); project one bar past the end."""
    w = len(ys)
    i1, i2 = tightest_line(ys, upper)
    y1, y2 = ys[i1], ys[i2]
    slope = (y2 - y1) / (i2 - i1)
    projected = y1 + slope * (w - i1)
    return LineFit(window_start + i1, y1, window_start + i2, y2, projected)


@dataclass
class Break:
    bar: int
    direction: int  # +1 close above resistance, -1 close below support
    line: LineFit
    p_up: float  # NaN when the image is not defined yet
    grade: str  # "confirmed", "contrary" or "neutral"


@dataclass
class TrendlineRun:
    resistance: list[LineFit | None]
    support: list[LineFit | None]
    up_break: np.ndarray
    down_break: np.ndarray
    breaks: list[Break] = field(default_factory=list)


def grade_break(direction: int, p_up: float, p_hi: float, p_lo: float) -> str:
    """Does the image model agree with the break's direction?"""
    if math.isnan(p_up):
        return "neutral"
    if direction > 0:
        return "confirmed" if p_up >= p_hi else "contrary" if p_up <= p_lo else "neutral"
    return "confirmed" if p_up <= p_lo else "contrary" if p_up >= p_hi else "neutral"


def run_trendlines(
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    window: int,
    cooldown: int,
    p_up: Sequence[float],
    p_hi: float,
    p_lo: float,
) -> TrendlineRun:
    """Per-bar lines, raw breaks and cooldown-filtered break signals.

    A raw break is a close beyond the projected line while the projected
    resistance is still above the projected support. A raw break becomes a signal
    when no raw break in the same direction happened in the previous `cooldown`
    bars.
    """
    h, l, c = (np.asarray(a, dtype=float) for a in (high, low, close))
    t_len = len(c)
    res: list[LineFit | None] = [None] * t_len
    sup: list[LineFit | None] = [None] * t_len
    up_raw = np.zeros(t_len, dtype=bool)
    dn_raw = np.zeros(t_len, dtype=bool)
    breaks: list[Break] = []
    last_up: int | None = None
    last_dn: int | None = None
    for t in range(window, t_len):
        hs = list(h[t - window : t])
        ls = list(l[t - window : t])
        r = fit_line(hs, t - window, upper=True)
        s = fit_line(ls, t - window, upper=False)
        res[t], sup[t] = r, s
        open_channel = r.projected > s.projected
        up_raw[t] = open_channel and c[t] > r.projected
        dn_raw[t] = open_channel and c[t] < s.projected
        if up_raw[t]:
            if last_up is None or t - last_up > cooldown:
                p = float(p_up[t])
                breaks.append(Break(t, +1, r, p, grade_break(+1, p, p_hi, p_lo)))
            last_up = t
        if dn_raw[t]:
            if last_dn is None or t - last_dn > cooldown:
                p = float(p_up[t])
                breaks.append(Break(t, -1, s, p, grade_break(-1, p, p_hi, p_lo)))
            last_dn = t
    return TrendlineRun(res, sup, up_raw, dn_raw, breaks)


# ---------------------------------------------------------------------------
# On-chart scorecard
# ---------------------------------------------------------------------------


@dataclass
class Scorecard:
    """Hit rates of past predictions on one chart, as the indicator counts them.

    Each bar t settles the prediction made at bar t - h: it counts as "up" when
    close[t] > close[t - h].
    """

    n_all: int = 0
    up_all: int = 0
    n_hi: int = 0
    up_hi: int = 0
    n_lo: int = 0
    up_lo: int = 0
    n_brk_up: int = 0
    up_brk_up: int = 0
    n_brk_dn: int = 0
    up_brk_dn: int = 0


def scorecard(
    close: Sequence[float],
    p_up: Sequence[float],
    horizon: int,
    p_hi: float,
    p_lo: float,
    breaks: Iterable[Break] = (),
) -> Scorecard:
    c = np.asarray(close, dtype=float)
    p = np.asarray(p_up, dtype=float)
    up_sig = {b.bar for b in breaks if b.direction > 0}
    dn_sig = {b.bar for b in breaks if b.direction < 0}
    sc = Scorecard()
    for t in range(horizon, len(c)):
        s = t - horizon
        went_up = int(c[t] > c[s])
        if not math.isnan(p[s]):
            sc.n_all += 1
            sc.up_all += went_up
            if p[s] >= p_hi:
                sc.n_hi += 1
                sc.up_hi += went_up
            if p[s] <= p_lo:
                sc.n_lo += 1
                sc.up_lo += went_up
        if s in up_sig:
            sc.n_brk_up += 1
            sc.up_brk_up += went_up
        if s in dn_sig:
            sc.n_brk_dn += 1
            sc.up_brk_dn += went_up
    return sc
