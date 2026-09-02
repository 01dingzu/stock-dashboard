import { useEffect, useState } from 'react'
import type { MarketRank } from '../types'
import { fetchMarketRank } from '../api'
import { useStore } from '../store'
import type { LocalItem } from '../store'

interface Props {
  dataCodes?: Set<string> // 后端 watchlist.json 的 code 集合 = "详情数据可用"
  localWatch?: LocalItem[] // 用户自选池（localStorage 真相来源）
  onSelect: (code: string) => void
}

// 市值格式化（单位：亿元）：12000 → "1.2万亿"，3100 → "3100亿"
function fmtCap(yi: number): string {
  if (yi >= 10000) return (yi / 10000).toFixed(1).replace(/\.0$/, '') + '万亿'
  if (yi >= 1000) return (yi / 1000).toFixed(1).replace(/\.0$/, '') + '千亿'
  return yi.toFixed(0) + '亿'
}

export default function MarketRankView({ dataCodes, localWatch, onSelect }: Props) {
  const [data, setData] = useState<MarketRank | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const toggleLocal = useStore((s) => s.toggleLocal)

  useEffect(() => {
    fetchMarketRank()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // 待同步 = 已加入自选池但后端无详情数据
  const pending = (localWatch ?? []).filter((i) => !(dataCodes?.has(i.code) ?? false))

  const copyCodes = async () => {
    const codes = pending.map((p) => p.code).join(',')
    try {
      await navigator.clipboard.writeText(codes)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (error) return <div className="error">⚠ {error}<br />运行 pipeline/market_scan.py 生成后即可查看。</div>
  if (!data) return <div className="loading">加载低估清单…</div>

  return (
    <div className="market">
      <div className="note-banner">
        全市场六因子扫描：PE 25% + PB 20%（越低越好）· ROE 20%（越高越好）· 股息率 15% · 负债率 10%（越低越好）· 净利同比 10%（越高越好），覆盖 {data.universe} 只（剔除 ST/退市/次新）。
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
          const hasData = dataCodes?.has(s.code) ?? false
          const isAdded = localWatch?.some((p) => p.code === s.code) ?? false
          const clickable = isAdded && hasData
          return (
            <div
              className={`mk-item${isAdded ? (hasData ? ' added clickable' : ' added') : ' not-added'}`}
              key={s.code}
              onClick={clickable ? () => onSelect(s.code) : undefined}
              title={clickable ? `查看 ${s.name} 详情` : isAdded ? `${s.name} 已加入自选池，详情数据待同步` : `${s.name} 未加入自选池，点 ＋ 加入`}
            >
              <div className="mk-rank">{s.rank}</div>
              <div className="mk-main">
                <div className="mk-name">
                  {s.name}
                  <span className="mk-code">{s.code.replace(/^(sh|sz)\./, '')}</span>
                  {isAdded ? (
                    <span className="mk-in-tag">已加入</span>
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
                <div className="mk-meta2">
                  {s.div_yield != null ? <>息 {s.div_yield}%</> : <span className="dim">息 —</span>}
                  {' · '}
                  {s.mktcap != null ? <>市值 {fmtCap(s.mktcap)}</> : <span className="dim">市值 —</span>}
                  {' · 负债 '}{s.debt_ratio ?? '—'}%
                  {' · 净利 '}
                  {s.yoy_ni != null ? <span className={s.yoy_ni >= 0 ? 'up' : 'down'}>{s.yoy_ni > 0 ? '+' : ''}{s.yoy_ni}%</span> : '—'}
                </div>
              </div>
              <div className="mk-score">{s.score.toFixed(3)}</div>
              <button
                className={`mk-add-btn${isAdded ? ' added' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleLocal({ code: s.code, name: s.name, industry: s.industry })
                }}
              >
                {isAdded ? '已加入 ✓' : '＋ 加入'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
