import { useEffect, useState } from 'react'
import { useStore } from './store'
import StockList from './components/StockList'
import StockDetail from './components/StockDetail'
import MarketRankView from './components/MarketRank'

// hash 路由：#/ 列表 ｜ #/stock/sh.600519 详情 ｜ #/market 全市场低估清单
function parseRoute(): { view: 'list' | 'market'; code: string | null } {
  const m = location.hash.match(/^#\/stock\/(.+)$/)
  if (m) return { view: 'list', code: m[1] }
  if (location.hash === '#/market') return { view: 'market', code: null }
  return { view: 'list', code: null }
}

export default function App() {
  const { watchlist, stock, loading, error, localWatch, loadWatchlist, loadStock, removeLocal } = useStore()
  const [route, setRoute] = useState(parseRoute())
  const selected = route.code

  useEffect(() => {
    loadWatchlist()
    const refresh = () => setRoute(parseRoute())
    refresh()
    window.addEventListener('hashchange', refresh)
    return () => window.removeEventListener('hashchange', refresh)
  }, [loadWatchlist])

  useEffect(() => {
    if (route.view === 'list' && selected) loadStock(selected)
    else useStore.setState({ stock: null })
  }, [route.view, selected, loadStock])

  // Service Worker（PWA 离线缓存）
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {})
    }
  }, [])

  const updated = watchlist?.updated
  // 后端 watchlist.json = "详情数据可用" 标记集合
  const dataCodes = new Set(watchlist?.stocks.map((s) => s.code) ?? [])
  // 自选池真相 = localWatch（localStorage），合并后端行情数据
  const watchMap = new Map((watchlist?.stocks ?? []).map((s) => [s.code, s]))
  const listItems = localWatch.map((l) => ({ local: l, data: watchMap.get(l.code) ?? null }))
  const pendingItems = localWatch.filter((l) => !dataCodes.has(l.code))

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          股票看板
          {updated && <span className="sub"> · 数据 {updated}</span>}
        </h1>
        {!selected && route.view === 'list' && (
          <button className="back-btn mk-nav" onClick={() => (location.hash = '#/market')}>全市场低估</button>
        )}
        {!selected && route.view === 'market' && (
          <button className="back-btn mk-nav" onClick={() => (location.hash = '#/')}>‹ 自选池</button>
        )}
        {selected && <button className="back-btn" onClick={() => (location.hash = '#/')}>‹ 返回</button>}
      </header>

      {error && (
        <div className="error">
          ⚠ {error}
          <br />
          {error.includes('加载失败') ? '该股详情数据尚未生成。若已在自选池，请在「全市场低估」页复制代码清单发给助理生成数据。' : '数据可能尚未生成，先运行 pipeline/main.py 或等待 GitHub Actions。'}
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
      {!selected && route.view === 'list' && pendingItems.length > 0 && (
        <div className="pending-banner" onClick={() => (location.hash = '#/market')}>
          📌 <b>{pendingItems.length}</b> 只待同步：{pendingItems.map((i) => i.name).join('、')}
          <br />
          去「全市场低估」页复制代码清单发给助理，即可生成详情数据并入池 ›
        </div>
      )}
      {!selected && route.view === 'list' && (
        <StockList
          items={listItems}
          onSelect={(code) => (location.hash = `#/stock/${code}`)}
          onRemove={removeLocal}
        />
      )}
      {selected && stock && <StockDetail data={stock} onBack={() => (location.hash = '#/')} />}
    </div>
  )
}
