import type { MarketAll, MarketPx, MarketRank, StockData, Watchlist } from './types'

const DATA = './data/'

// market_all.json 约 2~3MB，懒加载后常驻内存，避免详情兜底反复拉取
let marketAllCache: Promise<MarketAll> | null = null

// market_px.json ~200KB 紧凑快照（自选池任意股列表行的收盘/当日/周/月查询表）
let marketPxCache: Promise<MarketPx> | null = null

export function fetchMarketAll(): Promise<MarketAll> {
  if (!marketAllCache) {
    marketAllCache = fetch(`${DATA}market_all.json`, { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`全市场数据加载失败 HTTP ${res.status}`)
      return res.json()
    })
  }
  return marketAllCache
}

export function fetchMarketPx(): Promise<MarketPx> {
  if (!marketPxCache) {
    marketPxCache = fetch(`${DATA}market_px.json`, { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`全市场价格快照加载失败 HTTP ${res.status}`)
      return res.json()
    })
  }
  return marketPxCache
}

export async function fetchWatchlist(): Promise<Watchlist> {
  const res = await fetch(`${DATA}watchlist.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`watchlist 加载失败 HTTP ${res.status}`)
  return res.json()
}

export async function fetchStock(code: string): Promise<StockData> {
  const fname = code.replace('.', '')
  const res = await fetch(`${DATA}stocks/${fname}.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`个股数据加载失败 HTTP ${res.status}`)
  return res.json()
}

export async function fetchMarketRank(): Promise<MarketRank> {
  const res = await fetch(`${DATA}market_rank.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`低估清单加载失败 HTTP ${res.status}`)
  return res.json()
}
