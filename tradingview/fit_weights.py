#!/usr/bin/env python3
"""Fit the image-scaled logistic model and print weights for the Pine indicator.

    python fit_weights.py --data path/to/csvs --lookback 20 --horizon 5

Each CSV is one symbol's bars, oldest first or not (rows are sorted). Column names
are matched case-insensitively: a time column (time/date/datetime/timestamp),
open, high, low, close and optionally volume. TradingView's "Export chart data",
Kite historical candles and Yahoo downloads all work as they come.

What it does
  1. Builds the indicator's 6N image features for every bar (image_trend.py).
  2. Labels each bar 1 if close[t + h] > close[t], else 0.
  3. Splits by date: train on the earlier part, test on the later part. Training
     rows whose label reaches into the test period are dropped.
  4. Fits an L2-penalised logistic regression, picking the penalty on the last
     20% of the training dates.
  5. Reports out-of-sample accuracy, AUC, log loss, a decile table and, when
     there are enough symbols per date, a cross-sectional high-minus-low sort,
     with the same numbers for the unfitted prior as a baseline.
  6. Prints the text to paste into the indicator's "Fitted weights" box and
     writes everything to a JSON file.

Only numpy and pandas are needed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from image_trend import (
    LOOKBACKS,
    N_CHANNELS,
    format_weights,
    image_features,
    prior_weights,
    sigmoid,
)

TIME_COLUMNS = ("time", "date", "datetime", "timestamp")
L2_GRID = (1e-6, 1e-5, 1e-4, 1e-3, 1e-2)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def _parse_time(col: pd.Series) -> pd.Series:
    """UNIX epoch numbers (s, ms, us or ns, by magnitude) or date strings -> naive UTC."""
    if pd.api.types.is_numeric_dtype(col):
        biggest = col.abs().max()
        unit = "ns" if biggest > 1e17 else "us" if biggest > 1e14 else "ms" if biggest > 1e11 else "s"
        parsed = pd.to_datetime(col, unit=unit, utc=True)
    else:
        parsed = pd.to_datetime(col, utc=True, format="mixed")
    return parsed.dt.tz_convert(None)


def load_bars(path: Path, adjust: bool = False) -> pd.DataFrame:
    """One symbol's bars with columns time, open, high, low, close, volume."""
    raw = pd.read_csv(path)
    cols = {c.strip().lower(): c for c in raw.columns}
    time_col = next((cols[c] for c in TIME_COLUMNS if c in cols), None)
    missing = [c for c in ("open", "high", "low", "close") if c not in cols]
    if time_col is None or missing:
        raise ValueError(
            f"{path.name}: need a time column and open/high/low/close "
            f"(missing: {', '.join(missing) or 'time'})"
        )
    df = pd.DataFrame(
        {
            "time": _parse_time(raw[time_col]),
            "open": pd.to_numeric(raw[cols["open"]], errors="coerce"),
            "high": pd.to_numeric(raw[cols["high"]], errors="coerce"),
            "low": pd.to_numeric(raw[cols["low"]], errors="coerce"),
            "close": pd.to_numeric(raw[cols["close"]], errors="coerce"),
        }
    )
    vol_col = cols.get("volume") or cols.get("vol")
    df["volume"] = pd.to_numeric(raw[vol_col], errors="coerce") if vol_col else np.nan
    adj_col = cols.get("adj close") or cols.get("adj_close") or cols.get("adjclose")
    if adjust and adj_col:
        factor = pd.to_numeric(raw[adj_col], errors="coerce") / df["close"]
        for c in ("open", "high", "low", "close"):
            df[c] = df[c] * factor
    df = df.dropna(subset=["time", "open", "high", "low", "close"])
    df = df[(df[["open", "high", "low", "close"]] > 0).all(axis=1)]
    df = df.sort_values("time").drop_duplicates("time", keep="last")
    return df.reset_index(drop=True)


def find_csvs(paths: Sequence[str]) -> list[Path]:
    files: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            files.extend(sorted(p.glob("*.csv")))
        elif p.suffix.lower() == ".csv":
            files.append(p)
    return files


# ---------------------------------------------------------------------------
# Samples
# ---------------------------------------------------------------------------


@dataclass
class Samples:
    x: np.ndarray  # (rows, 6n) float32
    y: np.ndarray  # (rows,) 0/1
    fwd: np.ndarray  # h-bar forward return
    time: np.ndarray  # datetime64 of the image's last bar
    label_time: np.ndarray  # datetime64 of bar t + h
    symbol: np.ndarray  # int code

    def take(self, mask: np.ndarray) -> "Samples":
        return Samples(*(a[mask] for a in self.__dict__.values()))

    def __len__(self) -> int:
        return len(self.y)


def build_samples(frames: dict[str, pd.DataFrame], n: int, horizon: int, stride: int) -> Samples:
    parts = []
    for code, (name, df) in enumerate(frames.items()):
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("open", "high", "low", "close", "volume"))
        feats = image_features(o, h, l, c, v, n)
        t_len = len(c)
        fwd = np.full(t_len, np.nan)
        if t_len > horizon:
            fwd[: t_len - horizon] = c[horizon:] / c[: t_len - horizon] - 1.0
        times = df["time"].to_numpy()
        label_time = np.full(t_len, np.datetime64("NaT", "ns")).astype(times.dtype)
        if t_len > horizon:
            label_time[: t_len - horizon] = times[horizon:]
        ok = ~np.isnan(feats).any(axis=1) & ~np.isnan(fwd)
        idx = np.flatnonzero(ok)[::stride]
        if len(idx) == 0:
            print(f"  {name}: not enough bars for N={n}, h={horizon}; skipped", file=sys.stderr)
            continue
        parts.append(
            Samples(
                feats[idx].astype(np.float32),
                (fwd[idx] > 0).astype(np.int8),
                fwd[idx],
                times[idx],
                label_time[idx],
                np.full(len(idx), code, dtype=np.int32),
            )
        )
    if not parts:
        raise SystemExit("no usable samples; check the data and the lookback/horizon")
    return Samples(*(np.concatenate([getattr(p, k) for p in parts]) for k in Samples.__dataclass_fields__))


# ---------------------------------------------------------------------------
# Logistic regression (Newton's method, L2 on everything but the intercept)
# ---------------------------------------------------------------------------


def _grad_hess(x: np.ndarray, y: np.ndarray, w: np.ndarray, chunk: int):
    """Gradient and Hessian of the mean log loss, accumulated in chunks."""
    n_rows, d = x.shape
    grad = np.zeros(d + 1)
    hess = np.zeros((d + 1, d + 1))
    for s in range(0, n_rows, chunk):
        xc = x[s : s + chunk].astype(np.float64)
        yc = y[s : s + chunk].astype(np.float64)
        p = sigmoid(w[0] + xc @ w[1:])
        r = p - yc
        grad[0] += r.sum()
        grad[1:] += xc.T @ r
        s_ = p * (1.0 - p)
        hess[0, 0] += s_.sum()
        cross = xc.T @ s_
        hess[0, 1:] += cross
        hess[1:, 0] += cross
        hess[1:, 1:] += (xc * s_[:, None]).T @ xc
    return grad / n_rows, hess / n_rows


def _loss(x: np.ndarray, y: np.ndarray, w: np.ndarray, l2: float, chunk: int) -> float:
    total = 0.0
    for s in range(0, len(y), chunk):
        z = w[0] + x[s : s + chunk].astype(np.float64) @ w[1:]
        total += float(np.sum(np.logaddexp(0.0, z) - y[s : s + chunk] * z))
    return total / len(y) + 0.5 * l2 * float(w[1:] @ w[1:])


def fit_logit(
    x: np.ndarray,
    y: np.ndarray,
    l2: float,
    max_iter: int = 50,
    tol: float = 1e-9,
    chunk: int = 100_000,
) -> np.ndarray:
    """Minimise mean log loss + l2/2 * ||w[1:]||^2. Returns [intercept, w...]."""
    d = x.shape[1]
    w = np.zeros(d + 1)
    base = float(np.clip(y.mean(), 1e-6, 1 - 1e-6))
    w[0] = math.log(base / (1.0 - base))
    obj = _loss(x, y, w, l2, chunk)
    ridge = np.eye(d + 1) * l2
    ridge[0, 0] = 0.0
    for _ in range(max_iter):
        g, hmat = _grad_hess(x, y, w, chunk)
        g = g + ridge @ w
        hmat = hmat + ridge + np.eye(d + 1) * 1e-12
        step = np.linalg.solve(hmat, g)
        t = 1.0
        while True:
            cand = w - t * step
            cand_obj = _loss(x, y, cand, l2, chunk)
            if cand_obj <= obj or t < 1e-4:
                break
            t *= 0.5
        improvement = obj - cand_obj
        w, obj = cand, cand_obj
        if abs(improvement) < tol:
            break
    return w


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def auc(p: np.ndarray, y: np.ndarray) -> float:
    pos = y == 1
    n_pos, n_neg = int(pos.sum()), int((~pos).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    ranks = pd.Series(p).rank(method="average").to_numpy()
    return float((ranks[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def log_loss(p: np.ndarray, y: np.ndarray) -> float:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def decile_table(p: np.ndarray, y: np.ndarray, fwd: np.ndarray) -> pd.DataFrame:
    bucket = pd.qcut(pd.Series(p).rank(method="first"), 10, labels=False) + 1
    df = pd.DataFrame({"decile": bucket, "p": p, "up": y, "fwd": fwd})
    return df.groupby("decile").agg(n=("p", "size"), mean_p=("p", "mean"), hit_rate=("up", "mean"), mean_fwd=("fwd", "mean"))


def cross_sectional_hl(
    p: np.ndarray, fwd: np.ndarray, times: np.ndarray, horizon: int, min_names: int
) -> dict | None:
    """Top-decile minus bottom-decile mean forward return, formed on every h-th date.

    The paper's portfolios: rank names on P(up) within each date. Formation dates
    are spaced h bars apart so the h-bar holding periods do not overlap.
    """
    df = pd.DataFrame({"t": times, "p": p, "fwd": fwd})
    counts = df.groupby("t").size()
    dates = counts[counts >= min_names].index.sort_values()[::horizon]
    if len(dates) < 5:
        return None
    spreads = []
    for _, g in df[df["t"].isin(dates)].groupby("t"):
        k = max(1, len(g) // 10)
        ranked = g.sort_values("p")
        spreads.append(ranked["fwd"].tail(k).mean() - ranked["fwd"].head(k).mean())
    s = np.asarray(spreads)
    sd = s.std(ddof=1)
    return {
        "formation_dates": int(len(s)),
        "mean_hl_return": float(s.mean()),
        "hl_positive_share": float((s > 0).mean()),
        "t_stat": float(s.mean() / (sd / math.sqrt(len(s)))) if sd > 0 else float("nan"),
        "annualised_sharpe_if_daily_bars": float(s.mean() / sd * math.sqrt(252 / horizon)) if sd > 0 else float("nan"),
    }


def evaluate(p: np.ndarray, s: Samples, horizon: int, min_names: int) -> dict:
    y = s.y.astype(float)
    base = float(y.mean())
    return {
        "rows": int(len(y)),
        "base_rate_up": base,
        "accuracy_at_0.5": float(((p > 0.5) == (y == 1)).mean()),
        "auc": auc(p, y),
        "log_loss": log_loss(p, y),
        "log_loss_constant": log_loss(np.full_like(p, base), y),
        "p_quantiles": {q: float(np.quantile(p, q)) for q in (0.1, 0.5, 0.9)},
        "cross_sectional": cross_sectional_hl(p, s.fwd, s.time, horizon, min_names),
    }


def _fmt_eval(name: str, m: dict) -> str:
    lines = [
        f"  {name:<8} accuracy {m['accuracy_at_0.5']:.4f}  AUC {m['auc']:.4f}  "
        f"log loss {m['log_loss']:.5f} (constant {m['log_loss_constant']:.5f})"
    ]
    cs = m.get("cross_sectional")
    if cs:
        lines.append(
            f"           H-L {cs['mean_hl_return'] * 100:+.3f}% per {cs['formation_dates']} dates, "
            f"t {cs['t_stat']:.2f}, Sharpe {cs['annualised_sharpe_if_daily_bars']:.2f} (daily bars)"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", nargs="+", required=True, help="CSV files or folders of CSVs, one symbol each")
    ap.add_argument("--lookback", type=int, choices=LOOKBACKS, default=20, help="image length N (default 20)")
    ap.add_argument("--horizon", type=int, default=5, help="forecast horizon h in bars (default 5)")
    ap.add_argument("--split-date", help="first test date (YYYY-MM-DD); default: the 70th percentile date")
    ap.add_argument("--stride", type=int, default=1, help="keep every k-th image per symbol (default 1)")
    ap.add_argument("--l2", type=float, help="fix the L2 penalty instead of choosing it on validation data")
    ap.add_argument("--min-names", type=int, default=10, help="symbols per date needed for the H-L sort")
    ap.add_argument("--adjust", action="store_true", help="scale OHLC by Adj Close / Close when present")
    ap.add_argument("--out", help="JSON output path (default weights_N{N}_h{h}.json)")
    args = ap.parse_args(argv)

    n, h = args.lookback, args.horizon
    if h < 1:
        ap.error("--horizon must be at least 1")
    files = find_csvs(args.data)
    if not files:
        ap.error("no CSV files found")
    frames = {}
    for f in files:
        try:
            frames[f.stem] = load_bars(f, adjust=args.adjust)
        except ValueError as e:
            print(f"  skipped {e}", file=sys.stderr)
    print(f"Loaded {len(frames)} symbols, {sum(len(d) for d in frames.values()):,} bars")

    samples = build_samples(frames, n, h, max(1, args.stride))
    split = (
        np.datetime64(pd.Timestamp(args.split_date, tz="UTC").to_datetime64())
        if args.split_date
        else np.sort(samples.time)[int(0.7 * (len(samples) - 1))]
    )
    train = samples.take(samples.label_time < split)
    test = samples.take(samples.time >= split)
    if len(train) == 0 or len(test) == 0:
        raise SystemExit("the split leaves no training or no test rows; pass --split-date")
    print(f"Images: {len(samples):,} ({N_CHANNELS * n} features each); train {len(train):,}, test {len(test):,}")
    print(f"Test period starts {pd.Timestamp(split).date()}")

    if args.l2 is not None:
        l2 = args.l2
    else:
        val_split = np.sort(train.time)[int(0.8 * (len(train) - 1))]
        fit_part = train.take(train.label_time < val_split)
        val_part = train.take(train.time >= val_split)
        if len(fit_part) == 0 or len(val_part) == 0:
            l2 = 1e-4
            print("Too little training data to choose the L2 penalty; using 1e-4")
        else:
            scores = {}
            for cand in L2_GRID:
                w = fit_logit(fit_part.x, fit_part.y, cand)
                scores[cand] = log_loss(sigmoid(w[0] + val_part.x.astype(float) @ w[1:]), val_part.y)
            l2 = min(scores, key=scores.get)
            print("Validation log loss by L2: " + ", ".join(f"{k:g}: {v:.5f}" for k, v in scores.items()))
    print(f"L2 penalty: {l2:g}")

    w = fit_logit(train.x, train.y, l2)
    p_fit = sigmoid(w[0] + test.x.astype(float) @ w[1:])
    w_prior = prior_weights(n)
    p_prior = sigmoid(w_prior[0] + test.x.astype(float) @ w_prior[1:])

    m_fit = evaluate(p_fit, test, h, args.min_names)
    m_prior = evaluate(p_prior, test, h, args.min_names)
    print(f"\nOut of sample ({len(test):,} images, {m_fit['base_rate_up']:.1%} went up):")
    print(_fmt_eval("fitted", m_fit))
    print(_fmt_eval("prior", m_prior))
    print("\nFitted model by decile of P(up), test period:")
    print(decile_table(p_fit, test.y, test.fwd).to_string(float_format=lambda v: f"{v:.4f}"))

    p_hi = m_fit["p_quantiles"][0.9]
    p_lo = m_fit["p_quantiles"][0.1]
    text = format_weights(w, n, h)
    print(f"\nSuggested thresholds (test deciles): high {p_hi:.4f}, low {p_lo:.4f}")
    print(f"\nPaste into 'Fitted weights' (and set the image lookback to {n}):\n")
    print(text)

    out = Path(args.out or f"weights_N{n}_h{h}.json")
    out.write_text(
        json.dumps(
            {
                "lookback": n,
                "horizon": h,
                "l2": l2,
                "weights": [float(v) for v in w],
                "pine_text": text,
                "suggested_thresholds": {"high": p_hi, "low": p_lo},
                "symbols": list(frames),
                "train_rows": int(len(train)),
                "test_rows": int(len(test)),
                "test_start": str(pd.Timestamp(split).date()),
                "test_fitted": m_fit,
                "test_prior": m_prior,
            },
            indent=2,
            default=str,
        )
    )
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
