import type { MarketRank, StockData, Watchlist } from './types'

const DATA = './data/'

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
