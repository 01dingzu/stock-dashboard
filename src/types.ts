// 数据契约：与 pipeline/main.py 产出的 JSON 一一对应

export interface WatchItem {
  code: string
  name: string
  industry: string
  price: number | null
  pct: number | null
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
  }
  kline: KBar[]
  macd: MacdPoint[]
  rsi: RsiPoint[]
  kdj: KdjPoint[]
  factors: Factor[]
  fundamentals: Record<string, number | string | null>
  commentary?: string | null
}
