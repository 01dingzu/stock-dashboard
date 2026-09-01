"""BaoStock 数据拉取封装（行情 + 财报）。

BaoStock 特性：
- 免费、免注册、自有服务端，非爬虫，稳定性最好（2026 现状核实）
- 日线每日 17:30 入库，财报次日 1:30 入库 → 与"收盘后分析"场景契合
- 无实时行情、无 PE/PB 字段 → 估值由财报 EPS/BPS + 收盘价推算
- 财报接口按 (year, quarter) 逐个拉取
"""

import datetime as dt
from typing import Optional, Tuple

import baostock as bs
import pandas as pd

# 财报披露截止日（未披露视为不可用）：
# Q1 → 4/30，Q2 → 8/31，Q3 → 10/31，Q4 → 次年 4/30
_QUARTER_DEADLINE = {1: (4, 30), 2: (8, 31), 3: (10, 31), 4: (4, 30)}


def _latest_report_period(today: Optional[dt.date] = None) -> Tuple[int, int]:
    """返回最新「已过披露截止日」的报告期 (year, quarter)。"""
    today = today or dt.date.today()
    candidates = []
    for y in range(today.year - 1, today.year + 1):
        for q in (1, 2, 3, 4):
            m, d = _QUARTER_DEADLINE[q]
            deadline = dt.date(y + (1 if q == 4 else 0), m, d)
            if today >= deadline:
                candidates.append((deadline, (y, q)))
    return max(candidates, key=lambda x: x[0])[1]


def _rs_to_df(rs) -> pd.DataFrame:
    if rs.error_code != "0":
        raise RuntimeError(f"BaoStock error: {rs.error_code} {rs.error_msg}")
    return pd.DataFrame(rs.data, columns=rs.fields)


def fetch_daily(code: str, days: int = 500) -> pd.DataFrame:
    """前复权日线：date,open,high,low,close,preclose,volume,amount,turn,pctChg。
    剔除停牌日（tradestatus=0）。"""
    end = dt.date.today()
    start = end - dt.timedelta(days=int(days * 1.6) + 60)  # 宽松起点，覆盖停牌/节假日
    fields = "date,open,high,low,close,preclose,volume,amount,turn,tradestatus,pctChg"
    rs = bs.query_history_k_data_plus(
        code, fields, start_date=start.strftime("%Y-%m-%d"),
        end_date=end.strftime("%Y-%m-%d"), frequency="d",
        adjustflag="2",  # 2=前复权
    )
    df = _rs_to_df(rs)
    if df.empty:
        return df
    for col in ("open", "high", "low", "close", "preclose", "volume", "amount", "turn", "pctChg"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df[df["tradestatus"] == "1"].drop(columns=["tradestatus"]).reset_index(drop=True)
    return df.tail(days)


def _fetch_report(code: str, api: str, year: int, quarter: int) -> Optional[dict]:
    rs = getattr(bs, api)(code=code, year=year, quarter=quarter)
    if rs.error_code != "0" or not rs.data:
        return None
    fields = rs.fields
    row = rs.data[0]
    out = {}
    for f, v in zip(fields, row):
        try:
            out[f] = float(v) if v not in ("", None) else None
        except ValueError:
            out[f] = None
    out["pubDate"] = dict(zip(fields, row)).get("pubDate")
    out["statDate"] = dict(zip(fields, row)).get("statDate")
    return out


def fetch_fundamentals(code: str) -> dict:
    """最新披露期基本面指标。返回值含各字段，缺省为 None（不伪造数据）。"""
    y, q = _latest_report_period()
    res = {"report_year": y, "report_quarter": q}

    profit = _fetch_report(code, "query_profit_data", y, q)
    if profit:
        roe = profit.get("roeAvg")
        npm = profit.get("npMargin")
        gpm = profit.get("gpMargin")
        res.update({
            "roe": round(roe * 100, 2) if roe is not None else None,        # 百分数值
            "np_margin": round(npm * 100, 2) if npm is not None else None,   # 百分数值
            "gp_margin": round(gpm * 100, 2) if gpm is not None else None,   # 百分数值
            "eps_ttm": profit.get("epsTTM"),       # 每股收益 TTM
            "total_share": profit.get("totalShare"),  # 总股本(股)
            "net_profit": profit.get("netProfit"),   # 净利润(元)
            "mb_revenue": profit.get("MBRevenue"),   # 主营业务收入(元)
            "pub_date": profit.get("pubDate"),
        })
        # 营收同比：当期 MBRevenue / 去年同期 MBRevenue - 1（×100 输出为百分比）
        prev = _fetch_report(code, "query_profit_data", y - 1, q)
        if prev and profit.get("MBRevenue") and prev.get("MBRevenue"):
            res["yoy_rev"] = round((profit["MBRevenue"] / prev["MBRevenue"] - 1) * 100, 2)

    growth = _fetch_report(code, "query_growth_data", y, q)
    if growth:
        yni = growth.get("YOYNI")
        res["yoy_ni"] = round(yni * 100, 2) if yni is not None else None  # 净利同比 %

    balance = _fetch_report(code, "query_balance_data", y, q)
    if balance:
        la = balance.get("liabilityToAsset")  # 资产负债率（小数）
        res["debt_ratio"] = round(la * 100, 2) if la is not None else None

    dupont = _fetch_report(code, "query_dupont_data", y, q)
    if dupont:
        res["dupont_roe"] = dupont.get("dupontROE")  # 用于 PB 估算
    return res


def calc_valuation(last_close: float, fund: dict) -> dict:
    """由最新收盘价 + 财报推算估值（BaoStock 无现成 PE/PB 字段）。"""
    pe_ttm = pb_est = mktcap = None
    eps = fund.get("eps_ttm")
    ts = fund.get("total_share")  # 股
    roe = fund.get("dupont_roe") or fund.get("roe")
    if eps:
        pe_ttm = round(last_close / eps, 2) if eps > 0 else None
    if pe_ttm and roe:
        pb_est = round(pe_ttm * roe, 2)  # P/B = P/E × E/B，估算值
    if ts:
        mktcap = round(last_close * ts / 1e8, 2)  # 亿元
    return {"pe_ttm": pe_ttm, "pb_est": pb_est, "mktcap": mktcap}


def login() -> None:
    lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(f"BaoStock login failed: {lg.error_code} {lg.error_msg}")


def logout() -> None:
    bs.logout()
