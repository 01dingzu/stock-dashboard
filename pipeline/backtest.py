"""因子回测：验证打分规则各因子是否有效（IC / IR / 分层收益）。

方法论：
- 调仓频率：月度（每月最后一个交易日）
- 样本：自选池股票（截面小，结论为方向性参考，诚实标注局限）
- 财务因子：按「实际披露日 pubDate ≤ 调仓日」对齐，杜绝未来函数
- 技术因子：调仓日收盘截面计算（动量、RSI）
- 未来收益：调仓日后 20 个交易日
- IC：每期因子值与未来收益的 Spearman 秩相关；IR = IC均值 / IC标准差

产出：backtest_report.md（人读）+ data/backtest_cache/（财报缓存，重跑免拉取）

用法：python backtest.py
"""
import datetime as dt
import json
import os
import sys

import baostock as bs
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import baostock_fetch as bf  # noqa: E402

# 回测参数
REPORT_YEARS = 5        # 拉取近 5 年财报
MIN_YEAR = 2022         # 回测区间起点（含热身期）
FWD_DAYS = 20           # 未来收益窗口（约 1 个月）
LAYERS = 5              # 分层数
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "backtest_cache")

# 因子定义：(key, 名称, 预期方向 +1/-1, 类型)
FACTORS = [
    ("pe_ttm",   "PE_TTM",   -1, "value"),
    ("pb",       "PB",       -1, "value"),
    ("roe",      "ROE",      +1, "quality"),
    ("yoy_rev",  "营收同比",  +1, "growth"),
    ("yoy_ni",   "净利同比",  +1, "growth"),
    ("gp_margin","毛利率",   +1, "quality"),
    ("np_margin","净利率",   +1, "quality"),
    ("debt_ratio","负债率",  -1, "quality"),
    ("mom_20",   "动量20日",  +1, "momentum"),
    ("rsi14",    "RSI(14)",  None, "momentum"),  # 区间型，不设方向
]


def fetch_fundamental_period(code: str, year: int, quarter: int) -> dict:
    """拉取指定披露期财务字段（profit + growth + balance），带本地缓存。"""
    cache_key = f"{code.replace('.', '')}_{year}Q{quarter}.json"
    cache_path = os.path.join(CACHE_DIR, cache_key)
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)
    out = {"period": f"{year}Q{quarter}"}
    profit = bf._fetch_report(code, "query_profit_data", year, quarter)
    if profit:
        roe, npm, gpm = profit.get("roeAvg"), profit.get("npMargin"), profit.get("gpMargin")
        out.update({
            "pub_date": profit.get("pubDate"),
            "roe": round(roe * 100, 2) if roe is not None else None,
            "np_margin": round(npm * 100, 2) if npm is not None else None,
            "gp_margin": round(gpm * 100, 2) if gpm is not None else None,
            "eps_ttm": profit.get("epsTTM"),
            "net_profit": profit.get("netProfit"),
            "mb_revenue": profit.get("MBRevenue"),
            "total_share": profit.get("totalShare"),
        })
        np_, roe_, ts = profit.get("netProfit"), profit.get("roeAvg"), profit.get("totalShare")
        if np_ is not None and roe_ and roe_ > 0 and ts:
            out["bps"] = round(np_ / roe_ / ts, 4)
        prev = bf._fetch_report(code, "query_profit_data", year - 1, quarter)
        if prev and profit.get("MBRevenue") and prev.get("MBRevenue"):
            out["yoy_rev"] = round((profit["MBRevenue"] / prev["MBRevenue"] - 1) * 100, 2)
    growth = bf._fetch_report(code, "query_growth_data", year, quarter)
    if growth and growth.get("YOYNI") is not None:
        out["yoy_ni"] = round(growth["YOYNI"] * 100, 2)
    balance = bf._fetch_report(code, "query_balance_data", year, quarter)
    if balance and balance.get("liabilityToAsset") is not None:
        out["debt_ratio"] = round(balance["liabilityToAsset"] * 100, 2)
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return out


def load_fundamental_history(code: str) -> pd.DataFrame:
    """全部披露期的财务数据，按 pub_date 排序。"""
    rows = []
    for y in range(dt.date.today().year, dt.date.today().year - REPORT_YEARS, -1):
        for q in (4, 3, 2, 1):
            rec = fetch_fundamental_period(code, y, q)
            if rec.get("pub_date"):
                rows.append(rec)
    df = pd.DataFrame(rows).drop_duplicates(subset=["period"], keep="last")
    df["pub_date"] = pd.to_datetime(df["pub_date"])
    return df.sort_values("pub_date").reset_index(drop=True)


def load_kline_full(code: str) -> pd.DataFrame:
    """5 年前复权日线。"""
    end = dt.date.today()
    start = end - dt.timedelta(days=int(REPORT_YEARS * 366 * 1.4))
    fields = "date,close"
    rs = bf._call(
        "query_history_k_data_plus", code=code, fields=fields,
        start_date=start.strftime("%Y-%m-%d"), end_date=end.strftime("%Y-%m-%d"),
        frequency="d", adjustflag="2",
    )
    if rs.error_code != "0" or not rs.data:
        return pd.DataFrame(columns=["date", "close"])
    df = pd.DataFrame(rs.data, columns=rs.fields)
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    return df.dropna(subset=["close"]).reset_index(drop=True)


def rsi14(closes: pd.Series) -> float:
    """标准 RSI(14)：用 15 日收盘序列计算。"""
    c = closes.values.astype(float)
    if len(c) < 15:
        return np.nan
    delta = np.diff(c[-15:])
    up = delta[delta > 0].sum()
    dn = -delta[delta < 0].sum()
    if dn == 0:
        return 100.0
    rs = up / dn
    return 100 - 100 / (1 + rs)


def build_panel(kline_map: dict, fund_map: dict) -> pd.DataFrame:
    """月度调仓日截面面板。每行: date, code, 因子..., fwd_ret。"""
    all_dates = sorted(set().union(*[set(df["date"]) for df in kline_map.values()]))
    kline_map = {c: df.set_index("date")["close"] for c, df in kline_map.items()}
    # 月度调仓日：每月最后一个有行情的交易日
    monthly = pd.Series(all_dates).dt.to_period("M")
    rebalance = pd.Series(all_dates).groupby(monthly.values).max().tolist()

    rows = []
    for d in rebalance:
        d = pd.Timestamp(d)
        future_date = d + pd.Timedelta(days=40)
        for code, closes in kline_map.items():
            if d not in closes.index:
                continue
            pos = closes.index.get_loc(d)
            fwd_idx = closes.index[pos:][closes.index[pos:] <= future_date]
            if len(fwd_idx) < FWD_DAYS:
                continue
            close_now = closes.loc[d]
            close_fwd = closes.loc[fwd_idx[FWD_DAYS - 1]]
            fwd_ret = close_fwd / close_now - 1
            # 技术因子
            mom_20 = closes.loc[d] / closes.loc[closes.index[pos - 20]] - 1 if pos >= 20 else np.nan
            window = closes.iloc[max(0, pos - 60):pos + 1]
            rsi = rsi14(window) if len(window) >= 15 else np.nan
            row = {"date": d, "code": code, "fwd_ret": fwd_ret,
                   "mom_20": round(mom_20, 4) if pd.notna(mom_20) else np.nan,
                   "rsi14": round(rsi, 2) if pd.notna(rsi) else np.nan}
            # 财务因子：pub_date <= 调仓日的最近一期
            fh = fund_map[code]
            latest = fh[fh["pub_date"] <= d]
            if not latest.empty:
                lr = latest.iloc[-1]
                for key, _, _, _ in FACTORS:
                    if key in ("mom_20", "rsi14"):
                        continue
                    val = lr.get(key)
                    row[key] = val if pd.notna(val) else np.nan
                # 估值因子需结合当日价格：PE_TTM = 价/eps_ttm，PB = 价/bps
                eps = lr.get("eps_ttm")
                if pd.notna(eps) and eps and eps > 0:
                    row["pe_ttm"] = round(close_now / eps, 2)
                bps = lr.get("bps")
                if pd.notna(bps) and bps and bps > 0:
                    row["pb"] = round(close_now / bps, 2)
            rows.append(row)
    panel = pd.DataFrame(rows)
    if not panel.empty:
        panel["date"] = pd.to_datetime(panel["date"])
    return panel


def compute_stats(panel: pd.DataFrame) -> dict:
    """IC / IR / 方向命中率 / 分层收益。"""
    result = {}
    for key, name, direction, _ in FACTORS:
        if key not in panel.columns or panel[key].isna().all():
            continue
        sub = panel.dropna(subset=[key, "fwd_ret"])
        if len(sub) < 30:
            continue
        # 逐期 IC
        ics = []
        for d, grp in sub.groupby("date"):
            if len(grp) >= 5:
                ic = grp[key].corr(grp["fwd_ret"], method="spearman")
                if pd.notna(ic):
                    ics.append(ic)
        if len(ics) < 6:
            continue
        ics = np.array(ics)
        ic_mean = ics.mean()
        ic_std = ics.std(ddof=1) if len(ics) > 1 else np.nan
        ir = ic_mean / ic_std if ic_std and ic_std > 0 else np.nan
        hit = (np.sign(ics) == np.sign(direction)).mean() if direction else np.nan
        # 分层收益（按因子分 5 层，层 1→5 因子值升序）
        sub["layer"] = pd.qcut(sub[key], LAYERS, labels=False, duplicates="drop")
        layers = sub.groupby("layer")["fwd_ret"].mean().reindex(range(LAYERS))
        layer_vals = [round(v, 4) if pd.notna(v) else None for v in layers]
        # 单调性：若方向为负，则期望层越高收益越低
        mono_ok = None
        valid = [v for v in layer_vals if v is not None]
        if len(valid) == LAYERS and direction:
            seq = valid if direction > 0 else valid[::-1]
            mono_ok = sum(1 for i in range(1, len(seq)) if seq[i] > seq[i - 1]) >= len(seq) - 2
        result[key] = {
            "name": name, "direction": direction,
            "ic_mean": round(float(ic_mean), 4), "ic_std": round(float(ic_std), 4),
            "ir": round(float(ir), 3) if pd.notna(ir) else None,
            "ic_positive_ratio": round(float(hit), 2) if pd.notna(hit) else None,
            "layers": layer_vals, "monotonic": mono_ok,
            "periods": len(ics), "samples": len(sub),
        }
    return result


def verdict(stats: dict) -> str:
    """总体结论。"""
    strong, weak, useless = [], [], []
    for key, s in stats.items():
        if s.get("ir") is None or s.get("periods", 0) < 8:
            useless.append(f"{s['name']}(样本不足)")
        elif abs(s.get("ic_mean", 0)) >= 0.08 and abs(s.get("ir", 0)) >= 0.3:
            strong.append(s["name"])
        elif abs(s.get("ic_mean", 0)) >= 0.03:
            weak.append(s["name"])
        else:
            useless.append(s["name"])
    lines = []
    if strong:
        lines.append("**有效因子**：" + "、".join(strong) + " —— IC 方向稳定，可用于打分")
    if weak:
        lines.append("**弱有效因子**：" + "、".join(weak) + " —— 有方向性但噪声大，建议低权重")
    if useless:
        lines.append("**无效/样本不足**：" + "、".join(useless) + " —— 不建议纳入打分")
    return "\n".join(lines) if lines else "全部因子样本不足，无法给出结论"


def render_md(stats: dict) -> str:
    lines = ["# 因子回测报告（自选池）",
             "",
             f"- 生成时间：{dt.datetime.now().strftime('%Y-%m-%d %H:%M')}",
             "- 样本：自选池 20 只 · 月度调仓 · 未来 20 交易日收益",
             "- 口径：财务因子按披露日对齐（无未来函数）；PB 为披露期净资产反推；动量/RSI 为调仓日截面",
             "- 局限：自选池截面小，IC 统计功效有限，结论为方向性参考，非正式量化研究",
             "",
             "| 因子 | IC均值 | IC标准差 | IR | 方向命中 | 分层收益(低→高) | 单调 | 期数 |",
             "|---|---|---|---|---|---|---|---|"]
    for key, s in stats.items():
        layers = " / ".join(f"{v:.1%}" if v is not None else "-" for v in s["layers"])
        mono = "✓" if s["monotonic"] else ("✗" if s["monotonic"] is False else "-")
        lines.append(f"| {s['name']} | {s['ic_mean']} | {s['ic_std']} | "
                     f"{s['ir'] or '-'} | {s['ic_positive_ratio'] or '-'} | {layers} | {mono} | {s['periods']} |")
    lines += ["", "## 结论", "", verdict(stats), ""]
    return "\n".join(lines)


def main():
    from config import WATCHLIST
    bf.login()
    try:
        kline_map, fund_map = {}, {}
        for i, (code, name, _) in enumerate(WATCHLIST, 1):
            print(f"[{i}/{len(WATCHLIST)}] {name} 拉取历史数据 ...", flush=True)
            kline_map[code] = load_kline_full(code)
            fund_map[code] = load_fundamental_history(code)
            print(f"    kline {len(kline_map[code])} 行, 财报 {len(fund_map[code])} 期", flush=True)
        panel = build_panel(kline_map, fund_map)
        print(f"面板: {len(panel)} 行, 调仓日 {panel['date'].nunique() if not panel.empty else 0} 个", flush=True)
        panel.to_csv(os.path.join(CACHE_DIR, "panel.csv"), index=False, encoding="utf-8")
        stats = compute_stats(panel)
        md = render_md(stats)
        out_md = os.path.join(CACHE_DIR, "..", "backtest_report.md")
        with open(os.path.join(os.path.dirname(__file__), "..", "backtest_report.md"), "w", encoding="utf-8") as f:
            f.write(md)
        print(md)
        print(f"\n报告已存: backtest_report.md")
    finally:
        bf.logout()


if __name__ == "__main__":
    main()
