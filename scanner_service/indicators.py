import numpy as np
import pandas as pd


def wilder(values, period=14):
    """SMA seed followed by Wilder smoothing; no backfill from future rows."""
    data = np.asarray(values, dtype=float)
    output = np.full(len(data), np.nan)
    seed, previous = [], np.nan
    for i, value in enumerate(data):
        if not np.isfinite(value):
            seed, previous = [], np.nan
            continue
        if not np.isfinite(previous):
            seed.append(value)
            if len(seed) < period:
                continue
            previous = float(np.mean(seed[-period:]))
        else:
            previous = (previous * (period - 1) + value) / period
        output[i] = previous
    return output


def indicators(frame, benchmark=None):
    f = frame.copy()
    c, h, l, v = [f[k].astype(float) for k in ("close", "high", "low", "volume")]
    previous = c.shift(1)
    tr = pd.concat([h - l, (h - previous).abs(), (l - previous).abs()], axis=1).max(
        axis=1
    )
    f["atr"] = wilder(tr)
    f["ema20"] = c.ewm(span=20, adjust=False, min_periods=20).mean()
    f["sma50"] = c.rolling(50, min_periods=50).mean()
    f["sma200"] = c.rolling(200, min_periods=200).mean()
    change = c.diff()
    gain, loss = wilder(change.clip(lower=0)), wilder(-change.clip(upper=0))
    rsi = np.full(len(f), np.nan)
    valid = np.isfinite(gain) & np.isfinite(loss)
    rsi[valid & (loss == 0) & (gain == 0)] = 50
    rsi[valid & (loss == 0) & (gain > 0)] = 100
    mask = valid & (loss > 0)
    rsi[mask] = 100 - 100 / (1 + gain[mask] / loss[mask])
    f["rsi14"] = rsi
    f["macd"] = (
        c.ewm(span=12, adjust=False, min_periods=12).mean()
        - c.ewm(span=26, adjust=False, min_periods=26).mean()
    )
    f["macd_signal"] = f.macd.ewm(span=9, adjust=False, min_periods=9).mean()
    f["macd_hist"] = f.macd - f.macd_signal
    up, down = h.diff(), -l.diff()
    plus = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=f.index)
    minus = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=f.index)
    plus.iloc[0] = minus.iloc[0] = np.nan
    atr = f.atr.to_numpy()
    p, m = wilder(plus), wilder(minus)
    di_plus = np.divide(
        100 * p, atr, out=np.zeros(len(f)), where=np.isfinite(atr) & (atr > 0)
    )
    di_minus = np.divide(
        100 * m, atr, out=np.zeros(len(f)), where=np.isfinite(atr) & (atr > 0)
    )
    dx = np.divide(
        100 * np.abs(di_plus - di_minus),
        di_plus + di_minus,
        out=np.zeros(len(f)),
        where=(di_plus + di_minus) > 0,
    )
    dx[~np.isfinite(p) | ~np.isfinite(m) | ~np.isfinite(atr)] = np.nan
    f["adx14"] = wilder(dx)
    f["volume_ratio"] = v / v.shift(1).rolling(20, min_periods=20).mean().replace(
        0, np.nan
    )
    f["rs63"] = np.nan
    f["relative_line"] = np.nan
    if benchmark is not None:
        b = benchmark.reindex(f.index)
        # Compare like with like: split-adjusted stock price vs price index.
        # Cash dividends belong in holding returns, not excess-price RS.
        rs_close = f.get("relative_close", c)
        f["rs63"] = (rs_close / rs_close.shift(63) - b / b.shift(63)) * 100
        ratio = rs_close / b
        known = ratio.dropna()
        if len(known):
            f["relative_line"] = ratio / known.iloc[0] * 100
    return f
