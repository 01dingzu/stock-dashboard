import { useEffect } from 'react'
import { useStore } from './store'
import StockList from './components/StockList'
import StockDetail from './components/StockDetail'

// hash 路由：#/ 列表 ｜ #/stock/sh.600519 详情
function parseHash(): string | null {
  const m = location.hash.match(/^#\/stock\/(.+)$/)
  return m ? m[1] : null
}

export default function App() {
  const { watchlist, stock, loading, error, loadWatchlist, loadStock } = useStore()
  const selected = parseHash()

  useEffect(() => {
    loadWatchlist()
    const onHash = () => {
      const code = parseHash()
      if (code) loadStock(code)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [loadWatchlist, loadStock])

  useEffect(() => {
    if (selected) loadStock(selected)
  }, [selected, loadStock])

  // Service Worker（PWA 离线缓存）
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {})
    }
  }, [])

  const updated = watchlist?.updated

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          股票看板
          {updated && <span className="sub"> · 数据 {updated}</span>}
        </h1>
        {selected && <button className="back-btn" onClick={() => (location.hash = '#/')}>‹ 返回</button>}
      </header>

      {error && <div className="error">⚠ {error}<br />数据可能尚未生成，先运行 pipeline/main.py 或等待 GitHub Actions。</div>}
      {loading && !stock && <div className="loading">加载中…</div>}

      {!selected && watchlist && <StockList watchlist={watchlist} onSelect={(code) => (location.hash = `#/stock/${code}`)} />}
      {selected && stock && <StockDetail data={stock} onBack={() => (location.hash = '#/')} />}
    </div>
  )
}
