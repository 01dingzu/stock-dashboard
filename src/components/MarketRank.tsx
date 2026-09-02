import { useEffect, useState } from 'react'
import type { MarketRank } from '../types'
import { fetchMarketRank } from '../api'

interface Props {
  watchlistCodes?: Set<string>
  onSelect: (code: string) => void
}

// localStorage 待同步自选池（跨会话持久化；watchlist.json 生成后自动转为"已加入"）
const PENDING_KEY = 'watchlist_pending_v1'
interface PendingItem { code: string; name: string; industry: string }

function loadPending(): PendingItem[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')
  } catch {
    return []
  }
}

export default function MarketRankView({ watchlistCodes, onSelect }: Props) {
  const [data, setData] = useState<MarketRank | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingItem[]>(loadPending)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchMarketRank()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const toggle = (s: { code: string; name: string; industry: string }) => {
    const next = pending.some((p) => p.code === s.code)
      ? pending.filter((p) => p.code !== s.code)
      : [...pending, { code: s.code, name: s.name, industry: s.industry }]
    localStorage.setItem(PENDING_KEY, JSON.stringify(next))
    setPending(next)
  }

  const copyCodes = async () => {
    const codes = pending.map((p) => p.code).join(',')
    try {
      await navigator.clipboard.writeText(codes)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard 不可用时回退：选中文本提示
      setCopied(false)
    }
  }

  if (error) return <div className="error">⚠ {error}<br />运行 pipeline/market_scan.py 生成后即可查看。</div>
  if (!data) return <div className="loading">加载低估清单…</div>

  return (
    <div className="market">
      <div className="note-banner">
        全市场因子扫描：PE/PB 越低分越高、ROE 越高分越高（权重 0.4/0.3/0.3），覆盖 {data.universe} 只（剔除 ST/退市/次新）。
        仅作观察参考，不构成投资建议。· 数据 {data.updated}
      </div>

      {pending.length > 0 && (
        <div className="sync-banner">
          <span className="sync-text">
            📌 已选 <b>{pending.length}</b> 只待同步：{pending.map((p) => p.name).join('、')}
          </span>
          <button className="sync-copy-btn" onClick={copyCodes}>
            {copied ? '✓ 已复制' : '复制代码清单'}
          </button>
          <span className="sync-hint">复制后发送给助理即可生成数据并入池</span>
        </div>
      )}

      <div className="mk-list">
        {data.stocks.map((s) => {
          const inWatchlist = watchlistCodes?.has(s.code) ?? false
          const isPicked = pending.some((p) => p.code === s.code)
          return (
            <div
              className={`mk-item${inWatchlist ? '' : ' mk-item-out'}`}
              key={s.code}
              onClick={inWatchlist ? () => onSelect(s.code) : undefined}
              title={inWatchlist ? `查看 ${s.name} 详情` : isPicked ? `${s.name} 已选待同步` : `${s.name} 未加入自选池，点 ＋ 加入`}
            >
              <div className="mk-rank">{s.rank}</div>
              <div className="mk-main">
                <div className="mk-name">
                  {s.name}
                  <span className="mk-code">{s.code.replace(/\.\d+$/, '').replace(/(sh|sz)\./, '')}</span>
                  {inWatchlist ? (
                    <span className="mk-in-tag">自选池</span>
                  ) : isPicked ? (
                    <span className="mk-picked-tag">已选待同步</span>
                  ) : (
                    <span className="mk-out-tag">未加入</span>
                  )}
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
              {!inWatchlist && (
                <button
                  className={`mk-add-btn${isPicked ? ' picked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle({ code: s.code, name: s.name, industry: s.industry })
                  }}
                >
                  {isPicked ? '已选 ✓' : '＋ 加入'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
