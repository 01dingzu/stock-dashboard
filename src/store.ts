import { create } from 'zustand'
import { fetchMarketAll, fetchStock, fetchWatchlist } from './api'
import type { MarketAllItem, StockData, Watchlist } from './types'

// 自选池本地条目（真相来源：localStorage；后端 watchlist.json 只标记"详情数据可用性"）
export interface LocalItem {
  code: string
  name: string
  industry: string
}

const LOCAL_KEY = 'watchlist_local_v1'
const LEGACY_PENDING_KEY = 'watchlist_pending_v1' // 旧"已选待同步"（迁移后不再写）

function readLocal(): LocalItem[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeLocal(items: LocalItem[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items))
}

// 旧"已选待同步"(v6, watchlist_pending_v1) 残留兜底：把 LOCAL_KEY 里没有的项幂等并入，防止
// "旧页面(SW 缓存)写入 pending key → 新页面刷新只剩默认池" 的 split-brain。并入后删除旧 key。
function absorbLegacy(items: LocalItem[]): LocalItem[] {
  const raw = localStorage.getItem(LEGACY_PENDING_KEY)
  if (raw === null) return items
  let legacy: LocalItem[] = []
  try {
    const p = JSON.parse(raw)
    if (Array.isArray(p)) legacy = p
  } catch {
    legacy = []
  }
  const seen = new Set(items.map((i) => i.code))
  let changed = false
  for (const l of legacy) {
    if (l && typeof l.code === 'string' && l.code && !seen.has(l.code)) {
      items.push({ code: l.code, name: l.name ?? l.code, industry: l.industry ?? '' })
      seen.add(l.code)
      changed = true
    }
  }
  // 无论是否并入，旧 key 使命已完成（空 / 全部重复 / 已并入）→ 删除，杜绝 split-brain 再发生
  if (changed) writeLocal(items)
  localStorage.removeItem(LEGACY_PENDING_KEY)
  return items
}

interface MarketMeta {
  updated: string
  universe: number
  note: string
}

interface State {
  watchlist: Watchlist | null
  stock: StockData | null
  fallback: MarketAllItem | null // 无深度数据时的"市场版"兜底条目（全市场打分+解释）
  marketMeta: MarketMeta | null
  loading: boolean
  error: string | null
  localWatch: LocalItem[]
  loadWatchlist: () => Promise<void>
  loadStock: (code: string) => Promise<void>
  toggleLocal: (item: LocalItem) => void
  removeLocal: (code: string) => void
}

export const useStore = create<State>((set) => ({
  watchlist: null,
  stock: null,
  fallback: null,
  marketMeta: null,
  loading: false,
  error: null,
  localWatch: readLocal(),

  loadWatchlist: async () => {
    set({ loading: true, error: null })
    try {
      const w = await fetchWatchlist()
      // 首次初始化：localStorage 无 key 时，迁移旧"已选待同步" + 导入后端默认池（去重）
      if (localStorage.getItem(LOCAL_KEY) === null) {
        let merged: LocalItem[] = []
        try {
          const legacy = JSON.parse(localStorage.getItem(LEGACY_PENDING_KEY) || '[]')
          if (Array.isArray(legacy)) merged = legacy
        } catch {
          merged = []
        }
        const seen = new Set(merged.map((i) => i.code))
        for (const s of w.stocks ?? []) {
          if (!seen.has(s.code)) {
            merged.push({ code: s.code, name: s.name, industry: s.industry })
            seen.add(s.code)
          }
        }
        writeLocal(merged)
        localStorage.removeItem(LEGACY_PENDING_KEY)
        set({ watchlist: w, localWatch: merged, loading: false })
      } else {
        // 已初始化：读取本地自选，并吸收旧页面(pending key)可能残留的加入项（幂等）
        const items = absorbLegacy(readLocal())
        set({ watchlist: w, localWatch: items, loading: false })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  loadStock: async (code) => {
    set({ loading: true, error: null })
    try {
      const s = await fetchStock(code)
      set({ stock: s, fallback: null, marketMeta: null, loading: false })
    } catch {
      // 深度详情缺失（非自选池/未生成）→ 兜底展示"市场版"全量打分+解释
      try {
        const all = await fetchMarketAll()
        const item = all.stocks.find((i) => i.code === code) ?? null
        if (item) {
          set({
            stock: null,
            fallback: item,
            marketMeta: { updated: all.updated, universe: all.universe, note: all.note },
            loading: false,
            error: null,
          })
        } else {
          set({ stock: null, fallback: null, marketMeta: null, error: `未找到 ${code}：该股可能已退市、新上市或不在全市场扫描范围。`, loading: false })
        }
      } catch (e) {
        set({ stock: null, fallback: null, marketMeta: null, error: e instanceof Error ? e.message : String(e), loading: false })
      }
    }
  },

  toggleLocal: (item) => {
    const cur = readLocal()
    const next = cur.some((i) => i.code === item.code)
      ? cur.filter((i) => i.code !== item.code)
      : [...cur, item]
    writeLocal(next)
    set({ localWatch: next })
  },

  removeLocal: (code) => {
    const cur = readLocal()
    const next = cur.filter((i) => i.code !== code)
    writeLocal(next)
    set({ localWatch: next })
  },
}))
