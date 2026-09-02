# -*- coding: utf-8 -*-
"""
基本面 + 技术面 综合文字说明生成器（规则模板版）
输入：data/stocks/*.json（详情数据，由 baostock_fetch.py 生成）
输出：data/commentary.json（每只股票一段中文点评）

市场全量版（--market）：
输入：data/market_cache/*.json（schema=2 六因子）+ data/tech_cache/*.json（技术快照）
输出：data/market_all.json —— 全市场每只的 排名/六因子/综合点评（详情页兜底用）

规则依据（来自 backtest_report.md 的因子回测结论）：
- 有效因子：PE_TTM / PB 越低越好（IR≈-0.4，分层单调）
- 股息率 TTM 越高，安全边际越厚
- 技术面：MA 多头/空头排列、MACD 金叉死叉、RSI/KDJ 超买超卖、量能
"""

import glob
import json
import os

from config import DATA_DIR

# 金融行业关键词（负债率高是行业特性，不做风险提示；BaoStock 行业名如"货币金融服务/保险业/资本市场服务"）
FIN_KEYS = ("银行", "货币金融", "保险", "证券", "券商", "多元金融", "信托")


def _is_fin(industry: str) -> bool:
    return bool(industry) and any(k in str(industry) for k in FIN_KEYS)


def load_stock(path: str) -> dict:
    return json.load(open(path, encoding="utf-8"))


def fundamental_part(fd: dict, industry: str) -> list:
    """基本面段落：估值 + 质量 + 成长，返回句子列表"""
    lines = []
    pe = fd.get("pe_ttm")
    pb = fd.get("pb")
    dy = fd.get("div_yield")
    roe = fd.get("roe")
    debt = fd.get("debt_ratio")
    yoy_ni = fd.get("yoy_ni")
    yoy_rev = fd.get("yoy_rev")
    np_margin = fd.get("np_margin")

    # ---- 估值（回测有效因子）----
    val = []
    if pe is not None:
        if pe <= 0:
            val.append("PE为负（亏损）")
        elif pe < 15:
            val.append(f"PE {pe:.1f} 属低估区")
        elif pe < 30:
            val.append(f"PE {pe:.1f} 处合理区间")
        else:
            val.append(f"PE {pe:.1f} 偏高")
    if pb is not None:
        if pb <= 0:
            val.append("PB为负")
        elif pb < 1:
            val.append(f"PB {pb:.2f} 破净")
        elif pb < 3:
            val.append(f"PB {pb:.2f} 不高")
        elif pb < 6:
            val.append(f"PB {pb:.2f} 中性")
        else:
            val.append(f"PB {pb:.2f} 偏贵")
    if dy is not None and dy >= 3:
        val.append(f"股息率 {dy:.1f}% 可观")
    if val:
        lines.append("估值： " + "，".join(val) + "。")

    # ---- 质量 ----
    qual = []
    if roe is not None:
        if roe >= 15:
            qual.append(f"ROE {roe:.1f}% 优秀")
        elif roe >= 10:
            qual.append(f"ROE {roe:.1f}% 良好")
        elif roe >= 0:
            qual.append(f"ROE {roe:.1f}% 一般")
        else:
            qual.append(f"ROE {roe:.1f}% 为负")
    if np_margin is not None and np_margin > 20:
        qual.append(f"净利率 {np_margin:.1f}% 较高")
    if qual:
        lines.append("质量： " + "，".join(qual) + "。")

    # ---- 成长 ----
    grow = []
    if yoy_ni is not None:
        if yoy_ni >= 30:
            grow.append(f"净利同比 +{yoy_ni:.0f}% 强劲")
        elif yoy_ni >= 10:
            grow.append(f"净利同比 +{yoy_ni:.0f}% 稳健")
        elif yoy_ni < 0:
            grow.append(f"净利同比 {yoy_ni:.0f}% 负增长")
        else:
            grow.append(f"净利同比 +{yoy_ni:.0f}% 温和")
    if yoy_rev is not None:
        if yoy_rev >= 20:
            grow.append(f"营收 +{yoy_rev:.0f}%")
        elif yoy_rev < 0:
            grow.append(f"营收 {yoy_rev:.0f}% 下滑")
    if grow:
        lines.append("成长： " + "，".join(grow) + "。")

    # ---- 风险（负债率，金融行业豁免）----
    if debt is not None and not _is_fin(industry):
        if debt > 80:
            lines.append(f"注意负债率 {debt:.0f}% 偏高。")
    return lines


def technical_part(d: dict) -> list:
    """技术面段落：趋势 + 信号 + 超买超卖"""
    lines = []
    k = d["kline"][-1]
    close = k["c"]
    ma5, ma20, ma60 = k["ma5"], k["ma20"], k["ma60"]
    rsi6 = d["rsi"][-1]["rsi6"]
    rsi12 = d["rsi"][-1]["rsi12"]
    kdj_j = d["kdj"][-1]["kdj_j"]
    macd = d["macd"][-1]
    hist = macd["macd"]
    dif, dea = macd["dif"], macd["dea"]
    fac = {f["key"]: f["value"] for f in d["factors"]}
    boll_up = k["boll_up"]

    # 趋势
    if close > ma20 > ma60:
        lines.append("技术面：多头排列（价>MA20>MA60），中期趋势向上。")
    elif close < ma20 < ma60:
        lines.append("技术面：空头排列（价<MA20<MA60），中期趋势偏弱。")
    elif close > ma20:
        lines.append("技术面：站上 MA20、MA60 走平，趋势偏多但未完全多头排列。")
    else:
        lines.append("技术面：位于 MA20 下方，短期承压。")

    # 信号
    sig = []
    if hist > 0 and dif > dea:
        sig.append("MACD 红柱多头")
    if fac.get("macd_gold"):
        sig.append("近期金叉")
    if fac.get("vol_break"):
        sig.append("放量")
    if fac.get("break_20d_high"):
        sig.append("突破20日高点")
    if sig:
        lines.append("信号： " + "，".join(sig) + "。")

    # 超买超卖 / 压力
    warn = []
    if rsi6 >= 80:
        warn.append(f"RSI6 {rsi6:.0f} 超买")
    if kdj_j >= 100:
        warn.append(f"KDJ-J {kdj_j:.0f} 高位")
    if close >= boll_up:
        warn.append("触布林上轨")
    if rsi6 <= 30:
        warn.append(f"RSI6 {rsi6:.0f} 超卖")
    if warn:
        lines.append("注意：" + "，".join(warn) + "，短线或有波动。")
    return lines


def build_commentary(stock: dict) -> str:
    meta = stock["meta"]
    fd = stock["fundamentals"]
    name = meta["name"]
    industry = meta.get("industry", "")
    parts = fundamental_part(fd, industry) + technical_part(stock)
    return f"{name}（{industry}）：" + "".join(parts)


def safe_commentary(stock: dict):
    """供 main.py 管道直接调用：生成点评，失败返回 None（不阻断主流程）。"""
    try:
        return build_commentary(stock)
    except Exception:  # noqa: BLE001
        return None


# ---------------- 市场全量版（data/market_cache + data/tech_cache） ----------------

# market_cache(schema=2) 字段 → fundamentals 字段名映射（缺失/不适用的字段置 None 自动省略句子）
def market_fd(cache: dict) -> dict:
    return {
        "pe_ttm": cache.get("pe"),
        "pb": cache.get("pb"),
        "div_yield": cache.get("div_yield"),
        "roe": cache.get("roe"),
        "np_margin": None,          # 市场版未拉净利率 → 该句省略
        "yoy_ni": cache.get("yoy_ni"),
        "yoy_rev": None,            # 市场版未拉营收同比 → 该句省略
        "debt_ratio": cache.get("debt_ratio"),
    }


def market_technical_text(tech: dict | None) -> list:
    """市场版技术面：把紧凑快照构造成与 detail 同构的伪 stock dict，复用 technical_part（口径一致）。
    快照字段缺失/损坏时返回空列表（只输出基本面段，不阻断）。"""
    if not tech:
        return []
    try:
        fake = {
            "kline": [{"c": tech["close"], "ma5": tech.get("ma5"), "ma20": tech.get("ma20"),
                       "ma60": tech.get("ma60"), "boll_up": tech.get("boll_up")}],
            "rsi": [{"rsi6": tech.get("rsi6"), "rsi12": tech.get("rsi12")}],
            "kdj": [{"kdj_j": tech.get("kdj_j")}],
            "macd": [{"macd": tech.get("macd"), "dif": tech.get("dif"), "dea": tech.get("dea")}],
            "factors": [
                {"key": "macd_gold", "value": tech.get("macd_gold")},
                {"key": "vol_break", "value": tech.get("vol_break")},
                {"key": "break_20d_high", "value": tech.get("break_20d_high")},
            ],
        }
        return technical_part(fake)
    except Exception:  # noqa: BLE001 —— 指标不全时不输出技术面，不阻断
        return []


def build_market_commentary(cache: dict, tech: dict | None) -> str | None:
    """market_cache 记录 + 技术快照 → 市场版点评文字。字段缺失自动跳过；失败返回 None。"""
    try:
        name = cache.get("name") or cache.get("code")
        industry = cache.get("industry", "")
        parts = fundamental_part(market_fd(cache), industry)
        parts += market_technical_text(tech)
        if not parts:
            return None
        return f"{name}（{industry}）：" + "".join(parts)
    except Exception:  # noqa: BLE001
        return None


def build_market_all(limit: int = 0) -> list:
    """全市场综合输出：六因子全量排名（复用 market_scan.rank_market top_n=None）+ 技术快照
    → 每只附 commentary → 写 data/market_all.json（详情页兜底数据）。
    market_rank.json（Top50）仍由 market_scan.py 产出，两者互补。"""
    import datetime as dt
    from market_scan import rank_market  # 延迟导入：仅本函数需要，避免 import 顺序耦合

    cache_dir = os.path.join(DATA_DIR, "market_cache")
    tech_dir = os.path.join(DATA_DIR, "tech_cache")
    rows = []
    for f in sorted(glob.glob(os.path.join(cache_dir, "*.json"))):
        base = os.path.basename(f)
        if base in ("universe.json", "industry_map.json"):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:  # noqa: BLE001
            continue
        if d.get("schema") == 2 and d.get("code"):
            rows.append(d)
    recs = rank_market(rows, top_n=None)  # 全市场完整排名（含 rank/score 及全部因子）
    if limit:
        recs = recs[:limit]

    out = []
    for r in recs:
        tech = None
        tf = os.path.join(tech_dir, f"{r['code'].replace('.', '')}.json")
        if os.path.exists(tf):
            try:
                with open(tf, encoding="utf-8") as fh:
                    tech = json.load(fh)
            except Exception:  # noqa: BLE001
                tech = None
        r["commentary"] = build_market_commentary(r, tech)
        out.append(r)

    payload = {
        "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": "BaoStock 全市场扫描 v2 + 技术面快照",
        "note": "六因子评分：PE 25% + PB 20%（越低越好）· ROE 20%（越高越好）· 股息率 15% · 负债率 10%（越低越好）· 净利同比 10%；综合说明为规则模板。仅作观察，不构成投资建议",
        "universe": len(rows),
        "count": len(out),
        "stocks": out,
    }
    out_f = os.path.join(DATA_DIR, "market_all.json")
    with open(out_f, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"全市场综合表 → {out_f}（{len(out)} 只 / 全量排名 {len(rows)} 入样）")
    for r in out[:5]:
        print(f"  #{r['rank']} {r['name']} score={r['score']:.3f} {r['commentary'][:60]}…")
    return out


# ---------------- CLI ----------------

def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", action="store_true", help="全市场模式：生成 data/market_all.json")
    ap.add_argument("--limit", type=int, default=0, help="市场模式只处理前 N 名（测试用）")
    args = ap.parse_args()

    if args.market:
        build_market_all(limit=args.limit)
        return

    out = []
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "stocks", "*.json"))):
        stock = load_stock(path)
        meta = stock["meta"]
        try:
            text = build_commentary(stock)
            out.append({
                "code": meta["code"],
                "name": meta["name"],
                "price": meta.get("price"),
                "pct": meta.get("pct"),
                "commentary": text,
            })
        except Exception as e:  # noqa: BLE001
            out.append({
                "code": meta["code"],
                "name": meta["name"],
                "commentary": f"数据不足，生成失败：{e}",
            })

    with open(os.path.join(DATA_DIR, "commentary.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"已生成 {len(out)} 条说明 → {DATA_DIR}/commentary.json")
    for item in out[:6]:
        print("\n" + item["commentary"])


if __name__ == "__main__":
    main()
