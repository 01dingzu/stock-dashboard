import { useEffect, useState } from 'react'
import type { MarketRank } from '../types'
import { fetchMarketRank } from '../api'

interface Props {
  watchlistCodes?: Set<string>
  onSelect: (code: string) => void
}

export default function MarketRankView({ watchlistCodes, onSelect }: Props) {
  const [data, setData] = useState<MarketRank | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMarketRank()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <div className="error">⚠ {error}<br />运行 pipeline/market_scan.py 生成后即可查看。</div>
  if (!data) return <div className="loading">加载低估清单…</div>

  return (
    <div className="market">
      <div className="note-banner">
        全市场因子扫描：PE/PB 越低分越高、ROE 越高分越高（权重 0.4/0.3/0.3），覆盖 {data.universe} 只（剔除 ST/退市/次新）。
        仅作观察参考，不构成投资建议。· 数据 {data.updated}
      </div>
      <div className="mk-list">
        {data.stocks.map((s) => {
          const inWatchlist = watchlistCodes?.has(s.code) ?? false
          return (
            <div
              className={`mk-item${inWatchlist ? '' : ' mk-item-out'}`}
              key={s.code}
              onClick={inWatchlist ? () => onSelect(s.code) : undefined}
              title={inWatchlist ? `查看 ${s.name} 详情` : `${s.name} 未加入自选池，无法查看详情`}
            >
              <div className="mk-rank">{s.rank}</div>
              <div className="mk-main">
                <div className="mk-name">
                  {s.name}
                  <span className="mk-code">{s.code.replace(/\.\d+$/, '').replace(/(sh|sz)\./, '')}</span>
                  {!inWatchlist && <span className="mk-out-tag">未加入</span>}
                </div>
                <div className="mk-ind">{s.industry}</div>
              </div>
              <div className="mk-nums">
                <div className="mk-price">{s.close ?? '—'}</div>
                <div className="mk-meta">
                  PE {s.pe ?? '—'} · PB {s.pb ?? '—'} · ROE {s.roe ?? '—'}%
                </div>
              </div>
              <div className="mk-score">{s.score.toFixed(3)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
