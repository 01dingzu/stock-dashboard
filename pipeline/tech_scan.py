# -*- coding: utf-8 -*-
"""
全市场技术面快照扫描 v1
数据源：BaoStock 前复权日线（每只 ~250 根，一次接口调用）
输入：data/market_cache/*.json 中 schema=2 的因子缓存（= 全市场名单，已剔 ST/退市/次新）
输出：data/tech_cache/{code}.json —— 紧凑技术快照（~300B/只）：
      {code, date, close, ma5, ma20, ma60, boll_up, rsi6, rsi12, kdj_j,
       dif, dea, macd, macd_gold, vol_break, break_20d_high, schema: 1}
供 commentary.build_market_all 生成全市场"技术面解释"（与详情页同规则，指标口径一致）。

与 market_cache 分开存放：v2 因子扫描仍在写 market_cache，本脚本并发写独立目录互不冲突。
特性：断点续传（文件已存在且 schema=1 则跳过）；--limit 供小样本测试；网络错误重登重试。
运行：python pipeline/tech_scan.py [--limit N] [--force]
"""

import argparse
import datetime as dt
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import baostock_fetch as bf  # noqa: E402
from config import DATA_DIR  # noqa: E402
from indicators import compute_all  # noqa: E402

TECH_DIR = os.path.join(DATA_DIR, "tech_cache")
KLINE_DAYS = 250  # MA60/MACD/KDJ 收敛所需；指标只在最后一行取值


def _r(x, nd=4):
    """数值清洗：None/NaN/Inf → None，避免 JSON 非法 NaN。"""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return round(x, nd)


def snapshot(code: str) -> dict | None:
    """单只：拉日线 → 全指标 → 提取最后一根的快照字段（与 main.py 的 factors 规则一致）。"""
    daily = bf.fetch_daily(code, days=KLINE_DAYS)  # 内部已做会话重登管理
    if daily.empty:
        return None
    ind = compute_all(daily.copy())  # 250 根前导足够 MA60/MACD/KDJ/RSI 收敛
    last = ind.iloc[-1]
    # 与 main.py factors 同口径：金叉(近期 dif>dea) / 放量(量>5日均量×1.2) / 突破近20日高点
    macd_gold = bool(_r(last["dif"], 6) > _r(last["dea"], 6)) if not _isna(last["dea"]) else None
    vol_break = bool(last["volume"] > 1.2 * last["vol_ma5"]) if not _isna(last["vol_ma5"]) else None
    break20 = bool(last["close"] >= ind["high"].tail(20).max()) if len(ind) >= 20 else None
    return {
        "code": code,
        "date": str(last["date"]),
        "close": _r(last["close"], 2),
        "ma5": _r(last["ma5"], 2),
        "ma20": _r(last["ma20"], 2),
        "ma60": _r(last["ma60"], 2),
        "boll_up": _r(last["boll_up"], 2),
        "rsi6": _r(last["rsi6"], 2),
        "rsi12": _r(last["rsi12"], 2),
        "kdj_j": _r(last["kdj_j"], 2),
        "dif": _r(last["dif"], 4),
        "dea": _r(last["dea"], 4),
        "macd": _r(last["macd"], 4),
        "macd_gold": macd_gold,
        "vol_break": vol_break,
        "break_20d_high": break20,
        "schema": 1,
    }


def _isna(v) -> bool:
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except Exception:  # noqa: BLE001
        return v is None


def list_universe() -> list:
    """全市场名单 = market_cache 中 schema=2 的缓存（v2 因子扫描产物，已剔 ST/退市/次新）。"""
    out = []
    for f in sorted(glob.glob(os.path.join(DATA_DIR, "market_cache", "*.json"))):
        base = os.path.basename(f)
        if base in ("universe.json", "industry_map.json"):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:  # noqa: BLE001
            continue
        if d.get("schema") == 2 and d.get("code"):
            out.append((d["code"], d.get("name", "")))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只扫前 N 只（测试用，0=全部）")
    ap.add_argument("--force", action="store_true", help="忽略缓存强制重扫")
    args = ap.parse_args()

    os.makedirs(TECH_DIR, exist_ok=True)
    codes = list_universe()
    print(f"技术面扫描名单：{len(codes)} 只（market_cache schema=2）", flush=True)
    if args.limit:
        codes = codes[: args.limit]
        print(f"测试模式：仅扫描前 {args.limit} 只", flush=True)

    bf.login()
    try:
        done = skipped = 0
        failed = []
        for i, (code, name) in enumerate(codes, 1):
            f = os.path.join(TECH_DIR, f"{code.replace('.', '')}.json")
            if os.path.exists(f) and not args.force:
                try:
                    with open(f, encoding="utf-8") as fh:
                        cached = json.load(fh)
                    if cached.get("schema") == 1:
                        skipped += 1
                        continue
                except Exception:  # noqa: BLE001 —— 缓存损坏则重拉
                    pass
            try:
                snap = snapshot(code)
            except Exception as e:  # noqa: BLE001 —— 单只失败跳过，绝不中断
                failed.append((code, name, str(e)[:120]))
                if len(failed) <= 10 or len(failed) % 50 == 0:
                    print(f"  ✗ 跳过 {code} {name}: {str(e)[:100]}", flush=True)
                continue
            if snap:
                with open(f, "w", encoding="utf-8") as fh:
                    json.dump(snap, fh, ensure_ascii=False)
                done += 1
            if i % 200 == 0:
                print(f"  进度 {i}/{len(codes)}（新增 {done}，缓存跳过 {skipped}，失败 {len(failed)}）", flush=True)
        print(f"扫描完成：新增 {done}，缓存跳过 {skipped}，失败 {len(failed)}", flush=True)
        if failed:
            print("失败清单（重跑本脚本将自动补齐）：", flush=True)
            for c, n, e in failed[:20]:
                print(f"  - {c} {n}: {e}", flush=True)
    finally:
        bf.logout()


if __name__ == "__main__":
    main()
