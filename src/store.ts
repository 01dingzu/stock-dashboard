import { create } from 'zustand'
import { fetchStock, fetchWatchlist } from './api'
import type { StockData, Watchlist } from './types'

interface State {
  watchlist: Watchlist | null
  stock: StockData | null
  loading: boolean
  error: string | null
  loadWatchlist: () => Promise<void>
  loadStock: (code: string) => Promise<void>
}

export const useStore = create<State>((set) => ({
  watchlist: null,
  stock: null,
  loading: false,
  error: null,

  loadWatchlist: async () => {
    set({ loading: true, error: null })
    try {
      const w = await fetchWatchlist()
      set({ watchlist: w, loading: false })
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
}))
