import { useEffect, useState } from 'react'
import { useStore } from './store'
import StockList from './components/StockList'
import StockDetail from './components/StockDetail'
import MarketRankView from './components/MarketRank'
import ScreenerView from './components/ScreenerView'
import MarketCard from './components/MarketCard'
import { fetchMarketPx } from './api'
import type { PxTuple } from './types'

// hash 路由：#/ 列表 ｜ #/stock/sh.600519 详情 ｜ #/market Top50 低估榜 ｜ #/screener 全市场筛选
function parseRoute(): { view: 'list' | 'market' | 'screener'; code: string | null } {
  const m = location.hash.match(/^#\/stock\/(.+)$/)
  if (m) return { view: 'list', code: m[1] }
  if (location.hash === '#/screener') return { view: 'screener', code: null }
  if (location.hash === '#/market') return { view: 'market', code: null }
  return { view: 'list', code: null }
}

export default function App() {
  const { watchlist, stock, fallback, marketMeta, loading, error, localWatch, loadWatchlist, loadStock, removeLocal } = useStore()
  const [route, setRoute] = useState(parseRoute())
  const [pxMap, setPxMap] = useState<Map<string, PxTuple> | null>(null)
  const selected = route.code

  useEffect(() => {
    loadWatchlist()
    const refresh = () => setRoute(parseRoute())
    refresh()
    window.addEventListener('hashchange', refresh)
    return () => window.removeEventListener('hashchange', refresh)
  }, [loadWatchlist])

  // 紧凑全市场价格快照（自选池任意股的收盘/当日/周/月查询表，~200KB 单次拉取）
  useEffect(() => {
    let on = true
    fetchMarketPx()
      .then((m) => {
        if (on) setPxMap(new Map(Object.entries(m.px)))
      })
      .catch(() => {
        if (on) setPxMap(new Map())
      })
    return () => {
      on = false
    }
  }, [])

  useEffect(() => {
    if (route.view === 'list' && selected) loadStock(selected)
    else useStore.setState({ stock: null, fallback: null, marketMeta: null })
  }, [route.view, selected, loadStock])

  // Service Worker（PWA 离线缓存 + 升级接管时自动刷新，避免用户卡在旧版）
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }, [])

  const updated = watchlist?.updated
  // 后端 watchlist.json = "详情数据可用" 标记集合（深度 K 线：默认池 20 只）
  const dataCodes = new Set(watchlist?.stocks.map((s) => s.code) ?? [])
  // 自选池真相 = localWatch（localStorage），合并后端行情数据
  const watchMap = new Map((watchlist?.stocks ?? []).map((s) => [s.code, s]))
  const listItems = localWatch.map((l) => ({ local: l, data: watchMap.get(l.code) ?? null }))
  // 真正"无任何数据"的待同步股 = 无深度 K 线 && 无市场快照（px 未就绪时不误报）
  const pendingItems = pxMap ? localWatch.filter((l) => !dataCodes.has(l.code) && !pxMap.has(l.code)) : []

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          股票看板
          {updated && <span className="sub"> · 数据 {updated}</span>}
        </h1>
        {!selected && route.view === 'list' && (
          <button className="back-btn mk-nav" onClick={() => (location.hash = '#/market')}>全市场</button>
        )}
        {!selected && (route.view === 'market' || route.view === 'screener') && (
          <button className="back-btn" onClick={() => (location.hash = '#/')}>‹ 自选池</button>
        )}
        {selected && <button className="back-btn" onClick={() => (location.hash = '#/')}>‹ 返回</button>}
      </header>

      {(route.view === 'market' || route.view === 'screener') && (
        <div className="mk-tabs">
          <button className={`mk-tab${route.view === 'market' ? ' on' : ''}`} onClick={() => (location.hash = '#/market')}>
            🏆 Top50 低估榜
          </button>
          <button className={`mk-tab${route.view === 'screener' ? ' on' : ''}`} onClick={() => (location.hash = '#/screener')}>
            🔍 全市场筛选
          </button>
        </div>
      )}

      {!selected && route.view === 'list' && (
        <div className="market-entry">
          <span className="me-label">📊 想浏览全市场？</span>
          <button className="me-btn" onClick={() => (location.hash = '#/market')}>🏆 Top50 低估榜</button>
          <button className="me-btn me-primary" onClick={() => (location.hash = '#/screener')}>🔍 全市场筛选</button>
          <span className="me-hint">4928 只 · 自选可加</span>
        </div>
      )}

      {error && (
        <div className="error">
          ⚠ {error}
          {error.includes('未找到') ? (
            <><br />该股可能已退市、新上市或不在全市场扫描范围。可回「全市场筛选」页浏览其他标的。</>
          ) : (
            <><br />数据可能尚未生成，稍后重试或运行 pipeline 管道。</>
          )}
        </div>
      )}
      {loading && !stock && route.view === 'list' && <div className="loading">加载中…</div>}

      {!selected && route.view === 'market' && (
        <MarketRankView
          dataCodes={dataCodes}
          localWatch={localWatch}
          onSelect={(code) => (location.hash = `#/stock/${code}`)}
        />
      )}
      {!selected && route.view === 'screener' && (
        <ScreenerView
          dataCodes={dataCodes}
          localWatch={localWatch}
          onSelect={(code) => (location.hash = `#/stock/${code}`)}
        />
      )}
      {!selected && route.view === 'list' && pendingItems.length > 0 && (
        <div className="pending-banner" onClick={() => (location.hash = '#/market')}>
          📌 <b>{pendingItems.length}</b> 只暂无行情数据：{pendingItems.map((i) => i.name).join('、')}
          <br />
          可能为新上市/退市/未被扫描覆盖，去「全市场筛选」看看 ›
        </div>
      )}
      {!selected && route.view === 'list' && (
        <StockList
          items={listItems}
          pxMap={pxMap}
          onSelect={(code) => (location.hash = `#/stock/${code}`)}
          onRemove={removeLocal}
        />
      )}
      {selected && stock && <StockDetail data={stock} onBack={() => (location.hash = '#/')} />}
      {selected && !stock && fallback && marketMeta && (
        <MarketCard item={fallback} meta={marketMeta} onBack={() => (location.hash = '#/')} />
      )}
    </div>
  )
}
