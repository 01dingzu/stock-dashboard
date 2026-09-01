import { useMemo, useState } from 'react'
import type { Watchlist, WatchItem } from '../types'
import { fmtNum, fmtPct, upDownClass } from './FundCard'

interface Props {
  watchlist: Watchlist
  onSelect: (code: string) => void
}

// 行情新鲜度：last_date 距今天超过 N 天视为滞后（周末/节假日自然滞后，容忍 5 天）
function staleDays(lastDate: string | null): number {
  if (!lastDate) return 0
  const d = new Date(lastDate)
  if (Number.isNaN(d.getTime())) return 0
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

// 实验性估值分（基于自选池回测：PE/PB 为有效因子）：
// 在池内对 PE、PB 各取百分位（值越低分越高），各 50% 加权。仅作排序参考。
function estimateScore(stocks: WatchItem[]): Map<string, number> {
  const score = new Map<string, number>()
  const withPe = stocks.filter((s) => s.pe != null)
  const withPb = stocks.filter((s) => s.pb != null)
  const rankAsc = (arr: WatchItem[], key: 'pe' | 'pb') => {
    const sorted = [...arr].sort((a, b) => (a[key] as number) - (b[key] as number))
    const rank = new Map<string, number>()
    sorted.forEach((s, i) => rank.set(s.code, i / Math.max(1, sorted.length - 1))) // 0=最低
    return rank
  }
  const rPe = rankAsc(withPe, 'pe')
  const rPb = rankAsc(withPb, 'pb')
  for (const s of stocks) {
    const hasPe = rPe.has(s.code)
    const hasPb = rPb.has(s.code)
    if (!hasPe && !hasPb) continue
    const v = ((hasPe ? 1 - (rPe.get(s.code) as number) : 0) + (hasPb ? 1 - (rPb.get(s.code) as number) : 0)) /
      ((hasPe ? 1 : 0) + (hasPb ? 1 : 0))
    score.set(s.code, Math.round(v * 100))
  }
  return score
}

type SortKey = 'default' | 'score' | 'pct' | 'pe' | 'div'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'score', label: '估值分↓' },
  { key: 'pct', label: '涨幅↓' },
  { key: 'pe', label: 'PE↓' },
  { key: 'div', label: '股息率↓' },
]

export default function StockList({ watchlist, onSelect }: Props) {
  const [sort, setSort] = useState<SortKey>('default')
  const scores = useMemo(() => estimateScore(watchlist.stocks), [watchlist.stocks])

  const rows = useMemo(() => {
    const arr = [...watchlist.stocks]
    if (sort === 'score') arr.sort((a, b) => (scores.get(a.code) ?? 999) - (scores.get(b.code) ?? 999))
    if (sort === 'pct') arr.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))
    if (sort === 'pe') arr.sort((a, b) => (a.pe ?? Infinity) - (b.pe ?? Infinity))
    if (sort === 'div') arr.sort((a, b) => (b.div_yield ?? -Infinity) - (a.div_yield ?? -Infinity))
    return arr
  }, [watchlist.stocks, sort, scores])

  return (
    <div className="list">
      <div className="sort-chips">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`chip ${sort === s.key ? 'active' : ''}`}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
        <span className="hint">估值分=PE/PB百分位·实验性</span>
      </div>
      {rows.map((s) => {
        const stale = staleDays(s.last_date)
        const sc = scores.get(s.code)
        return (
          <div className="stock-row" key={s.code} onClick={() => onSelect(s.code)}>
            <div>
              <div className="name">
                {s.name}
                {s.div_yield != null && s.div_yield > 0 && (
                  <span className="div-yield">息 {fmtPct(s.div_yield)}</span>
                )}
                {sc != null && <span className={`score-tag ${sc >= 60 ? 'good' : sc >= 40 ? 'mid' : 'low'}`}>估值{sc}</span>}
                {stale > 5 && <span className="stale-tag">行情滞后{s.last_date ? `（${s.last_date.slice(5)}）` : ''}</span>}
              </div>
              <div className="code">
                {s.code.replace(/(sh|sz)\./, '')}
                <span className="industry">{s.industry}</span>
                <span className="industry">
                  {s.report_period ? `财报 ${s.report_period}` : ''}
                </span>
              </div>
            </div>
            <div className="spacer" />
            <div className="price">
              <div className={`p ${upDownClass(s.pct)}`}>{fmtNum(s.price)}</div>
              <div className={`chg ${upDownClass(s.pct)}`}>{fmtPct(s.pct)}</div>
            </div>
          </div>
        )
      })}
      {watchlist.stocks.length === 0 && <div className="loading">暂无数据（管道可能未运行）</div>}
    </div>
  )
}
