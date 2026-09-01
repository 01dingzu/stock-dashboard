# -*- coding: utf-8 -*-
"""
全市场因子扫描 MVP（P1）
数据源：BaoStock
流程：query_stock_basic 拿全市场名单(type=1 股票) → query_stock_industry 补行业 →
      逐只拉最新报告期利润数据(ROE/净利/股本→BPS 反推) + 最近行情(收盘价) →
      计算 PE/PB/ROE → 套用回测有效因子(PE/PB 低分位高分、ROE 高分位高分)打分 →
      输出低估清单 Top N → data/market_rank.json

特性：断点续传（data/market_cache/{code}.json 已存在则跳过）；--limit 供小样本测试。
运行：python pipeline/market_scan.py [--limit N] [--force]
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import baostock_fetch as bf  # noqa: E402
from config import DATA_DIR  # noqa: E402

CACHE_DIR = os.path.join(DATA_DIR, "market_cache")
MIN_LIST_DAYS = 365        # 剔除上市不足 1 年（财报参考价值低）
ST_KEYS = ("ST", "退", "N ")  # 剔除 ST / 退市整理 / 上市首日
_PFX = re.compile(r"^[A-Za-z0-9]+")  # 行业名去前缀（如 "J66货币金融服务" → "货币金融服务"）
_NET_ERR = ("10002007", "10001001", "WinError 10054")  # 网络接收错误 / 会话断开 / 连接被重置
_RETRY = 3                    # 网络类错误重试次数（强制重登 + 递增等待）


def clean_industry(s: str) -> str:
    return _PFX.sub("", s or "").strip()


def _fetch_daily_retry(code: str) -> "pd.DataFrame":
    """拉行情；网络类错误（BaoStock 10002007 / WinError 10054）强制重登并重试。"""
    last = None
    for attempt in range(_RETRY):
        try:
            return bf.fetch_daily(code, days=10)
        except RuntimeError as e:
            msg = str(e)
            if not any(k in msg for k in _NET_ERR):
                raise
            last = e
            if attempt < _RETRY - 1:
                bf._refresh_session_if_needed(force=True)  # 会话可能已坏，强制重登
                time.sleep(3 * (attempt + 1))
    raise last


# ---------------- 数据拉取 ----------------

def _drain(rs) -> list:
    """BaoStock ResultData 为游标式，需循环 rs.next() 拉全量。"""
    rows = []
    if rs.error_code != "0":
        raise RuntimeError(f"BaoStock error: {rs.error_code} {rs.error_msg}")
    while rs.next():
        rows.append(dict(zip(rs.fields, rs.get_row_data())))
    return rows


def fetch_universe() -> list:
    """全市场 A 股股票名单（type=1 且上市状态正常），剔除 ST/退市/次新。带本地缓存。"""
    cache_f = os.path.join(CACHE_DIR, "universe.json")
    if os.path.exists(cache_f):
        with open(cache_f, encoding="utf-8") as f:
            return json.load(f)
    rs = bf._call("query_stock_basic")
    rows = _drain(rs)
    today = dt.date.today()
    out = []
    for r in rows:
        if r.get("type") != "1" or r.get("status") != "1":
            continue
        name = r.get("code_name", "")
        if any(k in name for k in ST_KEYS):
            continue
        try:
            ipo = dt.datetime.strptime(r.get("ipoDate", ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        if (today - ipo).days < MIN_LIST_DAYS:
            continue
        out.append({"code": r["code"], "name": name})
    with open(cache_f, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return out


def fetch_industry_map() -> dict:
    """全市场行业映射 {code: industry}，游标拉全。带本地缓存。"""
    cache_f = os.path.join(CACHE_DIR, "industry_map.json")
    if os.path.exists(cache_f):
        with open(cache_f, encoding="utf-8") as f:
            return json.load(f)
    rs = bf._call("query_stock_industry")
    m = {}
    try:
        rows = _drain(rs)
    except RuntimeError:
        return m
    for d in rows:
        m[d.get("code")] = d.get("industry", "")
    with open(cache_f, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False)
    return m


def fetch_one(code: str) -> dict | None:
    """单只扫描：当期利润(ROE/净利/股本/BPS 反推) + 最近收盘价 → PE/PB/ROE。"""
    y, q = bf._latest_report_period()
    profit = bf._fetch_report(code, "query_profit_data", y, q)
    if not profit:
        return None
    roe = profit.get("roeAvg")          # 0~1 小数
    eps = profit.get("epsTTM")
    np_ = profit.get("netProfit")
    ts = profit.get("totalShare")

    daily = _fetch_daily_retry(code)
    if daily.empty:
        return None
    close = float(daily.iloc[-1]["close"])

    bps = None
    if np_ is not None and roe and roe > 0 and ts:
        bps = np_ / roe / ts

    pe = close / eps if eps and eps > 0 else None
    pb = close / bps if bps and bps > 0 else None
    return {
        "code": code, "close": round(close, 2),
        "pe": round(pe, 2) if pe else None,
        "pb": round(pb, 2) if pb else None,
        "roe": round(roe * 100, 2) if roe is not None else None,
        "report": f"{y}Q{q}",
    }


# ---------------- 打分 ----------------

def rank_market(rows: list, top_n: int = 50) -> list:
    """套用回测有效因子打分：PE/PB 越低越好(分位反向)，ROE 越高越好(分位正向)。"""
    df = pd.DataFrame(rows)
    if df.empty:
        return []
    df = df[(df["pe"] > 0) & (df["pb"] > 0) & df["roe"].notna()].copy()
    if df.empty:
        return []
    df["pct_pe"] = df["pe"].rank(pct=True)
    df["pct_pb"] = df["pb"].rank(pct=True)
    df["pct_roe"] = df["roe"].rank(pct=True)
    df["score"] = 0.4 * (1 - df["pct_pe"]) + 0.3 * (1 - df["pct_pb"]) + 0.3 * df["pct_roe"]
    df = df.sort_values("score", ascending=False)
    df["rank"] = range(1, len(df) + 1)
    df["industry"] = df["industry"].map(clean_industry)
    cols = ["rank", "code", "name", "industry", "close", "pe", "pb", "roe", "report", "score"]
    return df[cols].head(top_n).to_dict("records")


# ---------------- 主流程 ----------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只扫前 N 只（测试用，0=全部）")
    ap.add_argument("--force", action="store_true", help="忽略缓存强制重扫")
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    bf.login()
    try:
        universe = fetch_universe()
        ind_map = fetch_industry_map()
        print(f"全市场股票名单：{len(universe)} 只（已剔除 ST/退市/次新）", flush=True)
        if args.limit:
            universe = universe[: args.limit]
            print(f"测试模式：仅扫描前 {args.limit} 只", flush=True)

        rows = []
        skipped = 0
        failed = []
        for i, item in enumerate(universe, 1):
            code = item["code"]
            cache_f = os.path.join(CACHE_DIR, f"{code.replace('.', '')}.json")
            if os.path.exists(cache_f) and not args.force:
                with open(cache_f, encoding="utf-8") as f:
                    rows.append(json.load(f))
                skipped += 1
                continue
            try:
                rec = fetch_one(code)
            except Exception as e:  # noqa: BLE001 —— 单只失败跳过，绝不中断全扫描
                failed.append({"code": code, "name": item["name"], "err": str(e)[:120]})
                if len(failed) <= 10 or len(failed) % 50 == 0:
                    print(f"  ✗ 跳过 {code} {item['name']}: {str(e)[:100]}", flush=True)
                continue
            if rec:
                rec["name"] = item["name"]
                rec["industry"] = clean_industry(ind_map.get(code, ""))
                with open(cache_f, "w", encoding="utf-8") as f:
                    json.dump(rec, f, ensure_ascii=False)
                rows.append(rec)
            if i % 100 == 0:
                print(f"  进度 {i}/{len(universe)}（缓存跳过 {skipped}，失败 {len(failed)}）", flush=True)

        print(f"扫描完成：有效 {len(rows)} 只（跳过缓存 {skipped}，失败 {len(failed)}）", flush=True)
        if failed:
            print("失败清单（重跑本脚本将自动补齐）：", flush=True)
            for f_ in failed[:20]:
                print(f"  - {f_['code']} {f_['name']}: {f_['err']}", flush=True)
            if len(failed) > 20:
                print(f"  ... 共 {len(failed)} 只失败", flush=True)
        top = rank_market(rows, top_n=50)
        payload = {
            "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "source": "BaoStock 全市场因子扫描 MVP",
            "note": "PE/PB 越低分越高、ROE 越高分越高（权重 0.4/0.3/0.3）；仅作观察，不构成投资建议",
            "count": len(top),
            "universe": len(rows),
            "stocks": top,
        }
        out_f = os.path.join(DATA_DIR, "market_rank.json")
        with open(out_f, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        print(f"低估清单 Top{len(top)} → {out_f}")
        for r in top[:8]:
            print(f"  #{r['rank']} {r['name']}({r['industry']}) PE={r['pe']} PB={r['pb']} ROE={r['roe']}% score={r['score']:.3f}")
    finally:
        bf.logout()


if __name__ == "__main__":
    main()
