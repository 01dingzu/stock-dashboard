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
  const { watchlist, stock, loading, error, loadWatchlist, loadStock } = useStore()
  const [route, setRoute] = useState(parseRoute())
  const selected = route.code

  useEffect(() => {
    loadWatchlist()
    const onHash = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
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
  const watchlistCodes = new Set(watchlist?.stocks.map((s) => s.code) ?? [])

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
          {error.includes('加载失败') ? '该股可能不在自选池中。先在自选池页面加入，或等待 pipeline/main.py 生成数据。' : '数据可能尚未生成，先运行 pipeline/main.py 或等待 GitHub Actions。'}
        </div>
      )}
      {loading && !stock && route.view === 'list' && <div className="loading">加载中…</div>}

      {!selected && route.view === 'market' && (
        <MarketRankView
          watchlistCodes={watchlistCodes}
          onSelect={(code) => (location.hash = `#/stock/${code}`)}
        />
      )}
      {!selected && route.view === 'list' && watchlist && <StockList watchlist={watchlist} onSelect={(code) => (location.hash = `#/stock/${code}`)} />}
      {selected && stock && <StockDetail data={stock} onBack={() => (location.hash = '#/')} />}
    </div>
  )
}
