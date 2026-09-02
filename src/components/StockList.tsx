import { useMemo, useState } from 'react'
import type { WatchItem } from '../types'
import { fmtNum, fmtPct, upDownClass } from './FundCard'
import type { LocalItem } from '../store'

export interface ListRow {
  local: LocalItem
  data: WatchItem | null // null = 已加入自选池但后端详情数据未生成（待同步）
}

interface Props {
  items: ListRow[]
  onSelect: (code: string) => void
  onRemove: (code: string) => void
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

export default function StockList({ items, onSelect, onRemove }: Props) {
  const [sort, setSort] = useState<SortKey>('default')
  const withData = useMemo(() => items.filter((r) => r.data), [items])
  const scores = useMemo(() => estimateScore(withData.map((r) => r.data as WatchItem)), [withData])

  // 排序仅作用于"有数据"的行；"待同步"行固定排在后面
  const rows = useMemo(() => {
    const arr = [...withData]
    if (sort === 'score') arr.sort((a, b) => (scores.get(a.data!.code) ?? 999) - (scores.get(b.data!.code) ?? 999))
    if (sort === 'pct') arr.sort((a, b) => (b.data!.pct ?? -Infinity) - (a.data!.pct ?? -Infinity))
    if (sort === 'pe') arr.sort((a, b) => (a.data!.pe ?? Infinity) - (b.data!.pe ?? Infinity))
    if (sort === 'div') arr.sort((a, b) => (b.data!.div_yield ?? -Infinity) - (a.data!.div_yield ?? -Infinity))
    const pendings = items.filter((r) => !r.data)
    return [...arr, ...pendings]
  }, [withData, items, sort, scores])

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
        <span className="hint">估值分=PE/PB百分位·实验性 · 点 × 移除自选</span>
      </div>
      {rows.map(({ local, data }) => {
        if (!data) {
          return (
            <div className="stock-row pending" key={local.code} title={`${local.name} 详情数据待同步：在市场页复制代码清单发给助理`}>
              <div>
                <div className="name">
                  {local.name}
                  <span className="sync-pending-tag">待同步</span>
                </div>
                <div className="code">
                  {local.code.replace(/(sh|sz)\./, '')}
                  <span className="industry">{local.industry}</span>
                </div>
              </div>
              <div className="spacer" />
              <button className="row-remove" onClick={(e) => { e.stopPropagation(); onRemove(local.code) }} title="从自选池移除">×</button>
            </div>
          )
        }
        const stale = staleDays(data.last_date)
        const sc = scores.get(data.code)
        return (
          <div className="stock-row" key={data.code} onClick={() => onSelect(data.code)}>
            <div>
              <div className="name">
                {data.name}
                {data.div_yield != null && data.div_yield > 0 && (
                  <span className="div-yield">息 {fmtPct(data.div_yield)}</span>
                )}
                {sc != null && <span className={`score-tag ${sc >= 60 ? 'good' : sc >= 40 ? 'mid' : 'low'}`}>估值{sc}</span>}
                {stale > 5 && <span className="stale-tag">行情滞后{data.last_date ? `（${data.last_date.slice(5)}）` : ''}</span>}
              </div>
              <div className="code">
                {data.code.replace(/(sh|sz)\./, '')}
                <span className="industry">{data.industry}</span>
                <span className="industry">
                  {data.report_period ? `财报 ${data.report_period}` : ''}
                </span>
              </div>
            </div>
            <div className="spacer" />
            <div className="price">
              <div className={`p ${upDownClass(data.pct)}`}>{fmtNum(data.price)}</div>
              <div className={`chg ${upDownClass(data.pct)}`}>{fmtPct(data.pct)}</div>
            </div>
            <button className="row-remove" onClick={(e) => { e.stopPropagation(); onRemove(data.code) }} title="从自选池移除">×</button>
          </div>
        )
      })}
      {items.length === 0 && (
        <div className="loading">
          自选池为空。去「全市场低估」页点 ＋ 加入，或运行 pipeline/main.py 生成默认池。
        </div>
      )}
    </div>
  )
}
