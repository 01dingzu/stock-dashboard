// 数据契约：与 pipeline/main.py 产出的 JSON 一一对应

export interface WatchItem {
  code: string
  name: string
  industry: string
  price: number | null
  pct: number | null
  week_pct?: number | null // 近5交易日（≈1周）涨跌幅 %
  month_pct?: number | null // 近20交易日（≈1月）涨跌幅 %
  pe: number | null
  pb: number | null
  roe: number | null
  mktcap: number | null
  div_yield: number | null
  report_period: string | null
  report_pub: string | null
  last_date: string | null
}

export interface Watchlist {
  updated: string
  count: number
  stocks: WatchItem[]
}

export interface MarketItem {
  rank: number
  code: string
  name: string
  industry: string
  close: number | null
  pe: number | null
  pb: number | null
  roe: number | null
  gpm?: number | null        // 毛利率 %
  mktcap?: number | null     // 市值（亿元）
  yoy_ni?: number | null     // 净利同比 %
  debt_ratio?: number | null // 资产负债率 %
  div_yield?: number | null  // 股息率 %
  report: string
  score: number
}

export interface MarketRank {
  updated: string
  source: string
  note: string
  count: number
  universe: number
  stocks: MarketItem[]
}

// market_all.json：全市场排名 + 每只的综合点评（详情页兜底，无深度数据时展示）
export interface MarketAllItem extends MarketItem {
  commentary?: string | null
  tech?: TechSnap | null // 技术面快照（全市场筛选"技术形态"条件；tech_scan 收尾后全量）
}

// 技术面紧凑快照（tech_scan.py 产出，与详情页指标同口径）
export interface TechSnap {
  d: string | null // 快照日期
  close: number | null
  pct: number | null // 当日涨跌幅 %
  week_pct: number | null // 近5交易日（≈1周）涨跌幅 %
  month_pct: number | null // 近20交易日（≈1月）涨跌幅 %
  ma5: number | null
  ma20: number | null
  ma60: number | null
  rsi6: number | null
  kdj_j: number | null
  dif: number | null
  dea: number | null
  macd: number | null
  macd_gold: boolean | null // 近期 MACD 金叉（dif>dea）
  vol_break: boolean | null // 放量（量 > 5日均量×1.2）
  break_20d_high: boolean | null // 突破近20日高点
}

// 紧凑全市场价格快照（commentary.build_market_px 产出）：code → [收盘, 当日%, 周%, 月%]
export type PxTuple = [close: number | null, pct: number | null, week_pct: number | null, month_pct: number | null]
export interface MarketPx {
  updated: string
  universe: number
  px: Record<string, PxTuple>
}

export interface MarketAll {
  updated: string
  source: string
  note: string
  universe: number
  count: number
  stocks: MarketAllItem[]
}

export interface KBar {
  d: string
  o: number
  h: number
  l: number
  c: number
  v: number | null
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  ma120: number | null
  ma250: number | null
  vol_ma5: number | null
  boll_up: number | null
  boll_mid: number | null
  boll_low: number | null
}

export interface MacdPoint { d: string; dif: number | null; dea: number | null; macd: number | null }
export interface RsiPoint { d: string; rsi6: number | null; rsi12: number | null; rsi24: number | null }
export interface KdjPoint { d: string; kdj_k: number | null; kdj_d: number | null; kdj_j: number | null }

export interface Factor {
  key: string
  name: string
  value: boolean | null
}

export interface StockData {
  meta: {
    code: string
    name: string
    industry: string
    updated: string
    last_date?: string
    price?: number | null
    pct?: number | null
    week_pct?: number | null // 近5交易日（≈1周）涨跌幅 %
    month_pct?: number | null // 近20交易日（≈1月）涨跌幅 %
  }
  kline: KBar[]
  macd: MacdPoint[]
  rsi: RsiPoint[]
  kdj: KdjPoint[]
  factors: Factor[]
  fundamentals: Record<string, number | string | null>
  commentary?: string | null
}
