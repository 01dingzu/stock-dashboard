"""股票看板数据管道入口。

流程：登录 BaoStock → 逐只拉取前复权日线 + 最新财报 → 计算指标 → 产出 JSON：
  data/watchlist.json        自选池汇总（列表页）
  data/stocks/{code}.json    个股全量（深度页）
运行方式：python pipeline/main.py（需已 pip install -r pipeline/requirements.txt）
"""

import datetime as dt
import json
import math
import os

from config import DATA_DIR, KLINE_DAYS, WATCHLIST
from indicators import compute_all
import baostock_fetch as bf
import commentary


def _r(x, nd=4):
    """数值格式化：None/NaN/Inf 一律转 None，避免 JSON 出现非法 NaN。"""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return round(x, nd)


def build_stock_json(code: str, name: str, industry: str) -> dict:
    daily = bf.fetch_daily(code, KLINE_DAYS)
    fund = bf.fetch_fundamentals(code)

    meta = {"code": code, "name": name, "industry": industry, "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M")}

    if daily.empty:
        return {"meta": meta, "error": "no kline data", "kline": [], "macd": [], "rsi": [], "kdj": [], "fundamentals": fund}

    last_close = float(daily.iloc[-1]["close"])
    valuation = bf.calc_valuation(last_close, fund)
    fund.update(valuation)

    ind = compute_all(daily.copy())
    tail = ind.tail(KLINE_DAYS)

    def row_to_k(r):
        return {
            "d": r["date"],
            "o": _r(r["open"], 2), "h": _r(r["high"], 2), "l": _r(r["low"], 2), "c": _r(r["close"], 2),
            "v": int(r["volume"]) if not pd_isna(r["volume"]) else None,
            "ma5": _r(r["ma5"], 2), "ma10": _r(r["ma10"], 2), "ma20": _r(r["ma20"], 2),
            "ma60": _r(r["ma60"], 2), "ma120": _r(r["ma120"], 2), "ma250": _r(r["ma250"], 2),
            "vol_ma5": _r(r["vol_ma5"], 0),
            "boll_up": _r(r["boll_up"], 2), "boll_mid": _r(r["boll_mid"], 2), "boll_low": _r(r["boll_low"], 2),
        }

    def row_to_series(r, keys):
        return {"d": r["date"], **{k: _r(r[k], 4) for k in keys}}

    kline = [row_to_k(r) for _, r in tail.iterrows()]
    macd = [row_to_series(r, ["dif", "dea", "macd"]) for _, r in tail.iterrows()]
    rsi = [row_to_series(r, ["rsi6", "rsi12", "rsi24"]) for _, r in tail.iterrows()]
    kdj = [row_to_series(r, ["kdj_k", "kdj_d", "kdj_j"]) for _, r in tail.iterrows()]

    # 待验证因子（回测通过前仅作展示，不参与任何结论）
    last = tail.iloc[-1]
    factors = [
        {"key": "trend_ma20_60", "name": "趋势：收盘>MA20>MA60", "value": bool(last["close"] > last["ma20"] > last["ma60"]) if not pd_isna(last["ma60"]) else None},
        {"key": "macd_gold", "name": "MACD 金叉(近期)", "value": bool(_r(last["dif"], 6) > _r(last["dea"], 6)) if not pd_isna(last["dea"]) else None},
        {"key": "rsi_range", "name": f"RSI(14)∈[40,70]", "value": bool(40 <= last["rsi12"] <= 70) if not pd_isna(last["rsi12"]) else None},
        {"key": "vol_break", "name": "放量：量>5日均量×1.2", "value": bool(last["volume"] > 1.2 * last["vol_ma5"]) if not pd_isna(last["vol_ma5"]) else None},
        {"key": "break_20d_high", "name": "突破近20日高点", "value": bool(last["close"] >= tail["high"].tail(20).max())},
    ]

    meta["last_date"] = last["date"]
    meta["price"] = _r(last_close, 2)
    meta["pct"] = _r(last["pctChg"], 2) if not pd_isna(last["pctChg"]) else None

    return {
        "meta": meta,
        "kline": kline, "macd": macd, "rsi": rsi, "kdj": kdj,
        "factors": factors,
        "fundamentals": {k: _r(v, 2) if isinstance(v, (int, float)) else v for k, v in fund.items()},
    }


def pd_isna(v):
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except Exception:
        return v is None


def json_default(o):
    """兜底：numpy 标量转原生类型"""
    import numpy as np
    if isinstance(o, (np.integer, np.floating, np.bool_)):
        return o.item()
    return str(o)


def main():
    os.makedirs(f"{DATA_DIR}/stocks", exist_ok=True)
    bf.login()
    watch = []
    errors = []
    for i, (code, name, industry) in enumerate(WATCHLIST, 1):
        try:
            print(f"[{i}/{len(WATCHLIST)}] {name} ({code}) ...", flush=True)
            stock = build_stock_json(code, name, industry)
            stock["commentary"] = commentary.safe_commentary(stock)
            fname = code.replace(".", "")
            with open(f"{DATA_DIR}/stocks/{fname}.json", "w", encoding="utf-8") as f:
                json.dump(stock, f, ensure_ascii=False, default=json_default)
            if "error" not in stock:
                m = stock["meta"]
                fnd = stock["fundamentals"]
                watch.append({
                    "code": code, "name": name, "industry": industry,
                    "price": m.get("price"), "pct": m.get("pct"),
                    "pe": fnd.get("pe_ttm"), "pb": fnd.get("pb"),
                    "roe": fnd.get("roe"), "mktcap": fnd.get("mktcap"),
                    "div_yield": fnd.get("div_yield"),
                    "report_period": f"{int(fnd.get('report_year'))}Q{int(fnd.get('report_quarter'))}" if fnd.get("report_year") and fnd.get("report_quarter") else None,
                    "report_pub": fnd.get("pub_date"),
                    "last_date": m.get("last_date"),
                })
            else:
                errors.append(code)
        except Exception as e:  # noqa: BLE001
            print(f"  !! {name} failed: {e}", flush=True)
            errors.append(code)
    bf.logout()

    watch.sort(key=lambda x: (x.get("pct") is None, -(x.get("pct") or 0)))
    payload = {
        "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "count": len(watch),
        "stocks": watch,
    }
    with open(f"{DATA_DIR}/watchlist.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, default=json_default)

    commentary.main()

    print(f"\n完成：{len(watch)}/{len(WATCHLIST)} 只入库，失败 {len(errors)}: {errors}")
    print("产出：data/watchlist.json + data/stocks/*.json + data/commentary.json")


if __name__ == "__main__":
    main()
