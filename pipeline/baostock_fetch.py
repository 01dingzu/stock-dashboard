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

# 会话管理：BaoStock 免费会话在连续调用后会被服务端断开（报 10001001 用户未登录），
# 定期重登 + 错误触发重连。
_last_login_at: Optional[dt.datetime] = None
_calls_since_login = 0
_LOGIN_CALL_LIMIT = 25        # 每 25 次接口调用重新登录
_LOGIN_TTL_SECONDS = 240      # 或每 4 分钟重登


def _refresh_session_if_needed(force: bool = False):
    global _last_login_at, _calls_since_login
    now = dt.datetime.now()
    need = (
        force
        or _last_login_at is None
        or _calls_since_login >= _LOGIN_CALL_LIMIT
        or (now - _last_login_at).total_seconds() >= _LOGIN_TTL_SECONDS
    )
    if need:
        if _last_login_at is not None:
            try:
                bs.logout()
            except Exception:
                pass
        login()
        _last_login_at = now
        _calls_since_login = 0
    _calls_since_login += 1


def _call(api: str, **kwargs):
    """调用 BaoStock 接口；会话断开（10001001）自动重登并重试一次。"""
    rs = None
    for attempt in (1, 2):
        _refresh_session_if_needed(force=(attempt == 2))
        rs = getattr(bs, api)(**kwargs)
        if rs.error_code == "10001001" and attempt == 1:
            continue
        return rs
    return rs


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
    rs = _call(
        "query_history_k_data_plus", code=code, fields=fields,
        start_date=start.strftime("%Y-%m-%d"), end_date=end.strftime("%Y-%m-%d"),
        frequency="d", adjustflag="2",  # 2=前复权
    )
    df = _rs_to_df(rs)
    if df.empty:
        return df
    for col in ("open", "high", "low", "close", "preclose", "volume", "amount", "turn", "pctChg"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df[df["tradestatus"] == "1"].drop(columns=["tradestatus"]).reset_index(drop=True)
    return df.tail(days)


def _fetch_report(code: str, api: str, year: int, quarter: int) -> Optional[dict]:
    rs = _call(api, code=code, year=year, quarter=quarter)
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
        # 每股净资产（反推）：净资产 ≈ 净利润 / ROE（同披露期口径），BPS = 净资产 / 总股本
        np_ = profit.get("netProfit")
        ts = profit.get("totalShare")
        if np_ is not None and roe is not None and roe > 0 and ts:
            res["bps"] = round(np_ / roe / ts, 4)
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
        res["dupont_roe"] = dupont.get("dupontROE")

    res["div_cash_ttm"] = fetch_dividend_ttm(code)  # 最近一年已实施分红每股现金合计
    return res


def fetch_dividend_ttm(code: str, days: int = 365) -> Optional[float]:
    """最近 days 天内已实施分红的每股税前现金合计（元/股）。
    用于股息率 = 合计 / 最新收盘价。返回 None 表示无分红记录。"""
    today = dt.date.today()
    cutoff = (today - dt.timedelta(days=days)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")
    total = 0.0
    for y in range(today.year, today.year - 3, -1):
        rs = _call("query_dividend_data", code=code, year=y, yearType="report")
        if rs.error_code != "0" or not rs.data:
            continue
        for row in rs.data:
            rec = dict(zip(rs.fields, row))
            op = rec.get("dividOperateDate") or rec.get("dividPayDate") or ""
            if op and cutoff <= op <= today_str:
                try:
                    cash = float(rec.get("dividCashPsBeforeTax") or 0)
                except (TypeError, ValueError):
                    cash = 0.0
                total += cash
    return round(total, 4) if total > 0 else None


def calc_valuation(last_close: float, fund: dict) -> dict:
    """由最新收盘价 + 财报推算估值（BaoStock 无现成 PE/PB 字段）。"""
    pe_ttm = pb = mktcap = div_yield = None
    eps = fund.get("eps_ttm")
    ts = fund.get("total_share")  # 股
    bps = fund.get("bps")
    dc = fund.get("div_cash_ttm")
    if eps and eps > 0:
        pe_ttm = round(last_close / eps, 2)
    if bps and bps > 0:
        pb = round(last_close / bps, 2)  # 真实 PB：收盘价 / 每股净资产
    if ts:
        mktcap = round(last_close * ts / 1e8, 2)  # 亿元
    if dc and dc > 0 and last_close > 0:
        div_yield = round(dc / last_close * 100, 2)  # %（每股分红 / 股价）
    return {"pe_ttm": pe_ttm, "pb": pb, "mktcap": mktcap, "div_yield": div_yield}


def login() -> None:
    global _last_login_at, _calls_since_login
    lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(f"BaoStock login failed: {lg.error_code} {lg.error_msg}")
    _last_login_at = dt.datetime.now()
    _calls_since_login = 0


def logout() -> None:
    bs.logout()
