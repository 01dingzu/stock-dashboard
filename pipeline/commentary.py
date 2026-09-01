# -*- coding: utf-8 -*-
"""
基本面 + 技术面 综合文字说明生成器（规则模板版）
输入：data/stocks/*.json（详情数据，由 baostock_fetch.py 生成）
输出：data/commentary.json（每只股票一段中文点评）

规则依据（来自 backtest_report.md 的因子回测结论）：
- 有效因子：PE_TTM / PB 越低越好（IR≈-0.4，分层单调）
- 股息率 TTM 越高，安全边际越厚
- 技术面：MA 多头/空头排列、MACD 金叉死叉、RSI/KDJ 超买超卖、量能
"""

import glob
import json
import os

from config import DATA_DIR

FIN = {"银行", "保险", "证券", "券商", "多元金融", "信托"}  # 金融行业：高负债率是行业特性，不做风险提示


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
    if debt is not None and industry not in FIN:
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


def main() -> None:
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
