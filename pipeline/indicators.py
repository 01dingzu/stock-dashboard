"""技术指标计算（纯 pandas 实现）。

未来函数防护：所有指标仅依赖当日及之前的数据（rolling / ewm 均为因果计算），
按日期顺序滚动，绝不使用整段数据回看。
复权口径：输入必须是前复权日线（BaoStock adjustflag=2），指标在复权序列上计算。
"""

import pandas as pd


def add_ma(df: pd.DataFrame, wins=(5, 10, 20, 60, 120, 250)) -> pd.DataFrame:
    for w in wins:
        df[f"ma{w}"] = df["close"].rolling(w).mean()
    return df


def add_volume_ma(df: pd.DataFrame, win: int = 5) -> pd.DataFrame:
    df["vol_ma5"] = df["volume"].rolling(win).mean()
    return df


def add_boll(df: pd.DataFrame, win: int = 20, k: float = 2.0) -> pd.DataFrame:
    """布林带：MA20 ± 2×STD（总体标准差 ddof=0，对齐国内行情软件）"""
    mid = df["close"].rolling(win).mean()
    std = df["close"].rolling(win).std(ddof=0)
    df["boll_mid"] = mid
    df["boll_up"] = mid + k * std
    df["boll_low"] = mid - k * std
    return df


def add_macd(df: pd.DataFrame, fast=12, slow=26, signal=9) -> pd.DataFrame:
    ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
    df["dif"] = ema_fast - ema_slow
    df["dea"] = df["dif"].ewm(span=signal, adjust=False).mean()
    df["macd"] = 2 * (df["dif"] - df["dea"])
    return df


def add_rsi(df: pd.DataFrame, wins=(6, 12, 24)) -> pd.DataFrame:
    """RSI：Wilder 平滑（ewm alpha=1/n），与主流行情软件近似一致"""
    delta = df["close"].diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    for n in wins:
        au = up.ewm(alpha=1 / n, adjust=False).mean()
        ad = down.ewm(alpha=1 / n, adjust=False).mean()
        rs = au / ad.replace(0, 1e-9)
        df[f"rsi{n}"] = 100 - 100 / (1 + rs)
    return df


def add_kdj(df: pd.DataFrame, n: int = 9) -> pd.DataFrame:
    """KDJ：RSV9 → K/D 平滑（初值 50），J=3K-2D"""
    low_n = df["low"].rolling(n).min()
    high_n = df["high"].rolling(n).max()
    rsv = ((df["close"] - low_n) / (high_n - low_n).replace(0, 1e-9) * 100).fillna(50.0)
    k, d = 50.0, 50.0
    ks, ds = [], []
    for r in rsv.tolist():
        k = 2 / 3 * k + 1 / 3 * r
        d = 2 / 3 * d + 1 / 3 * k
        ks.append(round(k, 4))
        ds.append(round(d, 4))
    df["kdj_k"] = ks
    df["kdj_d"] = ds
    df["kdj_j"] = (3 * df["kdj_k"] - 2 * df["kdj_d"]).round(4)
    return df


def compute_all(df: pd.DataFrame) -> pd.DataFrame:
    """对前复权日线计算全套技术指标"""
    df = df.sort_values("date").reset_index(drop=True)
    df = add_ma(df)
    df = add_volume_ma(df)
    df = add_boll(df)
    df = add_macd(df)
    df = add_rsi(df)
    df = add_kdj(df)
    return df
