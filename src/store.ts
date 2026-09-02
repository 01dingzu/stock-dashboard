import { create } from 'zustand'
import { fetchStock, fetchWatchlist } from './api'
import type { StockData, Watchlist } from './types'

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

interface State {
  watchlist: Watchlist | null
  stock: StockData | null
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
        set({ watchlist: w, localWatch: merged, loading: false })
      } else {
        set({ watchlist: w, localWatch: readLocal(), loading: false })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  loadStock: async (code) => {
    set({ loading: true, error: null })
    try {
      const s = await fetchStock(code)
      set({ stock: s, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
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
