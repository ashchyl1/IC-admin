# Re-Imaged Trendlines

A TradingView indicator that draws trendlines automatically and grades each
break with the image model from Jiang, Kelly and Xiu, "(Re-)Imag(in)ing Price
Trends" (*Journal of Finance* 78(6), 2023, [doi:10.1111/jofi.13268](https://doi.org/10.1111/jofi.13268)).

The paper does not draw trendlines. Its CNN reads a rescaled chart and learns
which shapes come before up moves, without any named pattern. This indicator
keeps both views on one chart:

- **Trendlines** are the geometry you can see and trade against.
- **P(up)** is the paper's verdict on the same chart image: the probability of
  a higher close *h* bars ahead.

When a line breaks, the marker's colour says whether the image model agrees.

| File | What it is |
|------|------------|
| `re_imaged_trendlines.pine` | The indicator (Pine Script v6). |
| `image_trend.py` | Python reference implementation; the Pine script is tested against it bar by bar. |
| `fit_weights.py` | Fits the model's weights on your own data and prints the text to paste into the indicator. |
| `tests/` | Unit tests, plus parity tests that run the Pine script offline. |

---

## Install

1. In TradingView open the **Pine Editor**, create a new indicator, replace its
   contents with `re_imaged_trendlines.pine`, save, and **Add to chart**.
2. Use regular candles. Heikin Ashi, Renko and similar chart types feed the
   script synthetic OHLC.
3. The paper uses daily bars of split- and dividend-adjusted prices. The script
   runs on any timeframe, but fit weights on the timeframe you trade.

It works out of the box with an **unfitted prior** (see below). For a model
that has actually learned from data, run `fit_weights.py` and paste its output
into **Fitted weights**.

## What is on the chart

- **Red and teal lines**: the current resistance and support, fitted on the
  last *W* bars before the current one and extended to the right.
- **Triangles**: breaks. ▲ below the bar is a close above resistance; ▼ above
  the bar is a close below support. The colour is the model's grade:
  - green: resistance break, and the model leans up (P ≥ high threshold)
  - red: support break, and the model leans down (P ≤ low threshold)
  - orange: the model leans the *other* way
  - grey: the model is undecided, or the chart is too short for an image
- **Thin lines**: trendlines at the moment they broke, from the first anchor to
  the break bar. The last 40 are kept; change this with **Broken trendlines kept**.
- **Dashboard** (top right):
  - the model in use, P(up), and where the close sits in the image
  - close minus MA and the last bar's volume, both in image units
  - slope, touch count and distance to the close for each line, in image units
  - a scorecard: how often past calls on *this chart* were followed by a
    higher close *h* bars later, for P ≥ high, P ≤ low, all bars, and after
    resistance and support breaks
- **The model's image** (bottom right): what the model reads, drawn the way the
  paper draws its inputs. Each day is an open tick, a high-low bar and a close
  tick (one column per day for N = 60). The moving average is yellow and
  volume is in the bottom panel. The paper's images are pure black and white;
  the colours are only for readability.

The Data Window shows P(up), close position, and both lines' values at each bar.
P(up) also appears in the status line and in TradingView's Pine Screener (on
plans that include it), so a watchlist can be sorted by it. That is the paper's portfolio construction:
rank names by P(up), buy the top decile, sell the bottom.

## How it maps to the paper

| Paper | Indicator |
|-------|-----------|
| Chart images of the last 5, 20 or 60 days (I5, I20, I60) | **Image lookback N** = 5, 20 or 60 |
| Daily OHLC bars, an MA whose window equals the image length, volume bars | Same: open/high/low/close, `ta.sma(close, N)`, volume |
| Highest high and lowest low span the image height; largest volume spans the volume panel | Same rescale. Every symbol and timeframe lands on one scale. |
| Label: is the return over the next 5, 20 or 60 days positive? | **P(up)** over the next *h* bars |
| CNN on the image | Logistic model on the 6N image-scaled numbers (below) |
| One panel model trained on all stocks, tested out of sample | `fit_weights.py` pools all your CSVs and splits by date |
| No trendlines | Trendlines are added here as the readable layer and graded by the model |

### Why not the CNN itself

The paper's CNN does not fit in Pine Script. The 20-day model stacks
convolution layers with 64, 128 and 256 filters, which comes to hundreds of
thousands of weights. Pine caps a script at 100,000 compiled tokens and any
single loop at 500 ms per bar.

The paper's own finding gives the substitute: a logistic model on the same
image-rescaled price and volume series approximates the CNN far better than
momentum, reversal, size or liquidity signals do. That is what runs here:

```
x = for each day k = oldest..newest:
      open, high, low, close   as (p - lowest low) / (highest high - lowest low)
      MA                       same, clipped to the image
      volume                   / largest volume in the window (0 if the symbol has none)

P(up) = 1 / (1 + exp(-(w0 + w · x)))       6N + 1 weights
```

It is a stand-in, not a reproduction. Expect it to capture less than the CNN.

### The unfitted prior

With **Fitted weights** blank, the only non-zero weight sits on the newest
close's position in the image. The weight's sign comes from the paper's simple
reading of what the CNN learned: a close at the low end of the recent range is
followed by higher returns.

```
P(up) = 1 / (1 + exp(-0.5 * (0.5 - closePosition)))      ~0.44 .. ~0.56
```

The strength, 0.5, is a scale, not an estimate. It keeps P(up) in the range
implied by the paper's roughly 53% directional accuracy. The prior is
uncalibrated and ignores volume, the moving average, and every day but the
last.

Under the prior **most breaks are graded orange**. A breakout closes near the
top of its image, and the prior reads that as a short-term reversal. That is
the paper's point, not a bug. The scorecard shows whether breaks on your symbol
continued or reversed. Fitted weights let your own market decide.

## Fitting your own weights

Fitting needs numpy and pandas only.

```bash
cd tradingview
python3 fit_weights.py --data path/to/csv_folder --lookback 20 --horizon 5
```

**Data.** Use one CSV per symbol. Column names are matched case-insensitively:

- a time column: `time`, `date`, `datetime` or `timestamp`. Epoch
  seconds/milliseconds and date strings both work.
- `open`, `high`, `low`, `close`
- optionally `volume`

TradingView's *Export chart data* files and Yahoo downloads load as they are.
Kite Connect historical candles load once saved with their `date`, `open`,
`high`, `low`, `close` and `volume` fields. With Yahoo files, pass `--adjust` to
scale OHLC by `Adj Close`.

**What it does.**

1. Builds the 6N features for every bar, exactly as the indicator does.
2. Labels each bar by whether `close[t+h] > close[t]`.
3. Splits by date: the first 70% trains and the rest tests (`--split-date` to
   choose). Training rows whose label reaches into the test period are dropped.
4. Fits an L2-penalised logistic regression and picks the penalty on the last
   20% of the training dates.
5. Reports out-of-sample results for the fitted weights and the prior:
   - accuracy, AUC and log loss
   - a decile table
   - a cross-sectional top-minus-bottom-decile sort, when at least
     `--min-names` symbols share a date
6. Prints suggested thresholds (the test deciles of P(up)) and one line to
   paste:

```
N=20, h=5, 0.012559, -0.059295, -0.170799, ...
```

Paste it into **Fitted weights** and set **Image lookback N** to the same N.
The `N=` and `h=` tokens are checked. Weights fitted for another lookback are
rejected, the dashboard says so, and the prior stays in use. The horizon in the
line overrides **Forecast horizon h**. Set **P(up) high / low** to the
suggested thresholds.

**Getting a useful fit.**

- Pool many symbols. The paper fits one model across thousands of stocks; a
  single symbol's history is far too short for 121 weights.
- Use ten or more years of daily bars.
- The paper's pairings are a good start: I5/h=5, I20/h=5, I20/h=20, I60/h=60.
- `--stride 5` keeps every fifth image per symbol. That cuts memory on large
  universes and makes the samples less overlapping.
- Read the report before pasting. If the fitted model does not beat the
  constant on test log loss, it has learned nothing usable from that data.

## Trendline method

For the last *W* bars before the current bar (W defaults to N), **resistance**
is the line that:

1. no high in the window rises above, and
2. sits as close to the highs as possible, i.e. minimises Σ(line − high).

Because Σ(line − high) = W · (line(centre) − mean high), that line is the edge
of the highs' upper convex hull that spans the window's centre. It always
touches at least two highs. It has no pivot length, tolerance or touch count to
tune. **Support** is the mirror image on the lows.

The lines are projected one bar forward. A close above resistance or below
support is a **break**, counted only while resistance still sits above support,
so lines crossed past their apex don't count. A break is signalled when the same
side has not broken within the previous **Bars between same-side signals**
bars (default 5).

Slopes and distances on the dashboard are in **image units**: fractions of the
window's high-low range per window length. A slope of +0.30 means the line
climbs 30% of the image height across the window, whatever the symbol, price
or timeframe. That scale-free reading is the paper's "context independence"
applied to trendlines. Touches count the bars within **Touch tolerance**
(default 2% of image height) of the line.

## Alerts

| Condition | Fires when |
|-----------|------------|
| Resistance break, model agrees | close breaks resistance and P(up) ≥ high |
| Support break, model agrees | close breaks support and P(up) ≤ low |
| Any trendline break | either signal |
| P(up) crossed above high / below low | the model's lean changes |

Use **Once Per Bar Close**. On the live bar, P(up) and breaks move with every
tick until the bar closes.

## Limits

- **This is not the CNN.** It is the paper's closest simple stand-in. Fitted
  weights are only as good as the data behind them.
- **The paper's evidence comes from a large cross-section of U.S. stocks,
  1993–2019**, ranked against each other at each date. Equal-weighted spreads
  are far stronger than value-weighted ones, so small stocks carry much of the
  effect. The strongest figures, at weekly rebalancing, are before trading
  costs. A single chart's P(up) is a noisier object than a decile portfolio.
- **The prior is a placeholder.** Its sign comes from the paper; its size does not.
- **Offline validation.** Neither TradingView's compiler nor real market data
  was reachable while this was built. The script passes the
  `pinescript-v6-validator` checks. It was also run offline with
  [Resin](https://github.com/nullarch/resin), an independent Pine v5/v6
  compiler and runtime, and matches `image_trend.py` bar for bar. The first
  load in TradingView is still the real compile check, and no performance
  claim is made for any market.

## Tests

```bash
cd tradingview
python3 -m unittest discover -s tests -v
```

The unit tests cover:

- the image features against a plain loop, including scale invariance, flat
  windows and missing volume
- the trendline against a brute-force search over every two-point line
- breaks, cooldown and grades
- weight round-trips through the paste format
- the fitter recovering planted weights, plus an end-to-end CLI run

The parity tests run `re_imaged_trendlines.pine` through Resin. They need
Node ≥ 22.18 and an unpacked copy of Resin:

```bash
npm pack @nullarch/resin && tar xzf nullarch-resin-*.tgz   # unpacks to ./package
RESIN_DIR=$PWD/package python3 -m unittest discover -s tests -v
```

They compare, on every bar and for N = 5, 20 and 60 with prior, fitted and
rejected weights:

- P(up), the close position and both projected lines
- the break bars and their grade colours
- every broken-line drawing and the two live lines
- the scorecard counters

Without `RESIN_DIR` they are skipped.
