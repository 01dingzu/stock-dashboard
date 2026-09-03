import { useMemo, useState } from 'react'
import type { PxTuple, WatchItem } from '../types'
import { fmtNum, fmtPct, upDownClass } from './FundCard'
import type { LocalItem } from '../store'

export interface ListRow {
  local: LocalItem
  data: WatchItem | null // null = 非后端深度跟踪股（有市场快照则行内显示 收盘/当日/周/月）
}

interface Props {
  items: ListRow[]
  pxMap?: Map<string, PxTuple> | null // 全市场价格快照 code → [收盘, 当日%, 周%, 月%]
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

type SortKey = 'default' | 'score' | 'pct' | 'week' | 'month' | 'pe' | 'div'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'score', label: '估值分↓' },
  { key: 'pct', label: '涨幅↓' },
  { key: 'week', label: '周涨↓' },
  { key: 'month', label: '月涨↓' },
  { key: 'pe', label: 'PE↓' },
  { key: 'div', label: '股息率↓' },
]

// 统一行取值：深度数据(data)优先，缺则回退市场快照(px)
interface RowV {
  local: LocalItem
  data: WatchItem | null
  px: PxTuple | undefined
  snap: boolean // 有市场快照、无深度数据
  price: number | null
  pct: number | null
  week: number | null
  month: number | null
  pe: number | null
  divYield: number | null
}

export default function StockList({ items, pxMap, onSelect, onRemove }: Props) {
  const [sort, setSort] = useState<SortKey>('default')
  const withData = useMemo(() => items.filter((r) => r.data), [items])
  const scores = useMemo(() => estimateScore(withData.map((r) => r.data as WatchItem)), [withData])

  const vals = useMemo<RowV[]>(() => {
    return items.map((r) => {
      const deep = !!r.data
      const px = deep ? undefined : pxMap?.get(r.local.code)
      return {
        local: r.local,
        data: r.data,
        px,
        snap: !deep && !!px,
        price: r.data ? r.data.price : (px?.[0] ?? null),
        pct: r.data ? r.data.pct : (px?.[1] ?? null),
        week: r.data ? (r.data.week_pct ?? null) : (px?.[2] ?? null),
        month: r.data ? (r.data.month_pct ?? null) : (px?.[3] ?? null),
        pe: r.data ? r.data.pe : null,
        divYield: r.data ? r.data.div_yield : null,
      }
    })
  }, [items, pxMap])

  // 周/月涨跌汇总：涨跌家数 + 平均涨跌幅（深度行 + 市场快照行都统计）
  const stats = useMemo(() => {
    const arr = vals.filter((v) => v.data || v.snap)
    const group = (key: 'week' | 'month') => {
      const nums = arr.map((v) => v[key]).filter((x): x is number => x != null && Number.isFinite(x))
      if (nums.length === 0) return null
      return {
        n: nums.length,
        up: nums.filter((x) => x > 0).length,
        down: nums.filter((x) => x < 0).length,
        avg: nums.reduce((a, b) => a + b, 0) / nums.length,
      }
    }
    return { week: group('week'), month: group('month') }
  }, [vals])

  // 排序：有行情行（深度+快照）参与，真正无数据行恒沉底
  const rows = useMemo(() => {
    const body = vals.filter((v) => v.data || v.snap)
    const pending = vals.filter((v) => !v.data && !v.snap)
    if (sort === 'score') body.sort((a, b) => ((a.data ? scores.get(a.local.code) ?? 999 : 999)) - ((b.data ? scores.get(b.local.code) ?? 999 : 999)))
    if (sort === 'pct') body.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))
    if (sort === 'week') body.sort((a, b) => (b.week ?? -Infinity) - (a.week ?? -Infinity))
    if (sort === 'month') body.sort((a, b) => (b.month ?? -Infinity) - (a.month ?? -Infinity))
    if (sort === 'pe') body.sort((a, b) => (a.pe ?? Infinity) - (b.pe ?? Infinity))
    if (sort === 'div') body.sort((a, b) => (b.divYield ?? -Infinity) - (a.divYield ?? -Infinity))
    return [...body, ...pending]
  }, [vals, sort, scores])

  return (
    <div className="list">
      {(stats.week || stats.month) && (
        <div className="perf-strip">
          {stats.week && (
            <span className="ps-group" title="近5个交易日（≈1周）">
              周&nbsp;
              <b className="ps-up">↑{stats.week.up}</b>
              <b className="ps-down">↓{stats.week.down}</b>
              <span className={`ps-avg ${upDownClass(stats.week.avg)}`}>均值 {fmtPct(stats.week.avg)}</span>
            </span>
          )}
          {stats.month && (
            <span className="ps-group" title="近20个交易日（≈1月）">
              月&nbsp;
              <b className="ps-up">↑{stats.month.up}</b>
              <b className="ps-down">↓{stats.month.down}</b>
              <span className={`ps-avg ${upDownClass(stats.month.avg)}`}>均值 {fmtPct(stats.month.avg)}</span>
            </span>
          )}
        </div>
      )}
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
        <span className="hint">周≈近5交易日 · 月≈近20交易日 · 估值分=PE/PB百分位 · 点 × 移除自选</span>
      </div>
      {rows.map((v) => {
        // 真正无数据（无深度 K 线也无市场快照）
        if (!v.data && !v.snap) {
          return (
            <div className="stock-row pending" key={v.local.code} title={`${v.local.name} 暂无行情数据（可能新上市/退市/未覆盖）`}>
              <div>
                <div className="name">
                  {v.local.name}
                  <span className="sync-pending-tag">无数据</span>
                </div>
                <div className="code">
                  {v.local.code.replace(/(sh|sz)\./, '')}
                  <span className="industry">{v.local.industry}</span>
                </div>
              </div>
              <div className="spacer" />
              <button className="row-remove" onClick={(e) => { e.stopPropagation(); onRemove(v.local.code) }} title="从自选池移除">×</button>
            </div>
          )
        }
        const isSnap = !v.data && v.snap
        const stale = v.data ? staleDays(v.data.last_date) : 0
        const sc = v.data ? scores.get(v.data.code) : undefined
        const code = v.data?.code ?? v.local.code
        const name = v.data?.name ?? v.local.name
        return (
          <div className="stock-row" key={code} onClick={() => onSelect(code)} title={isSnap ? `${name} 市场快照数据（收盘/周月），无深度K线走势图` : undefined}>
            <div>
              <div className="name">
                {name}
                {isSnap && <span className="snap-tag">快照</span>}
                {v.data && v.data.div_yield != null && v.data.div_yield > 0 && (
                  <span className="div-yield">息 {fmtPct(v.data.div_yield)}</span>
                )}
                {sc != null && <span className={`score-tag ${sc >= 60 ? 'good' : sc >= 40 ? 'mid' : 'low'}`}>估值{sc}</span>}
                {stale > 5 && v.data && <span className="stale-tag">行情滞后{v.data.last_date ? `（${v.data.last_date.slice(5)}）` : ''}</span>}
              </div>
              <div className="code">
                {code.replace(/(sh|sz)\./, '')}
                <span className="industry">{v.local.industry}</span>
                {v.data && v.data.report_period && (
                  <span className="industry">财报 {v.data.report_period}</span>
                )}
              </div>
            </div>
            <div className="spacer" />
            <div className="price">
              <div className={`p ${upDownClass(v.pct)}`}>{v.price != null ? fmtNum(v.price) : '—'}</div>
              {v.pct != null && <div className={`chg ${upDownClass(v.pct)}`}>{fmtPct(v.pct)}</div>}
              {(v.week != null || v.month != null) && (
                <div className="subrange">
                  <span className={`rp ${upDownClass(v.week)}`} title="近5个交易日（≈1周）涨跌幅">周 {v.week != null ? fmtPct(v.week) : '—'}</span>
                  <span className={`rp ${upDownClass(v.month)}`} title="近20个交易日（≈1月）涨跌幅">月 {v.month != null ? fmtPct(v.month) : '—'}</span>
                </div>
              )}
            </div>
            <button className="row-remove" onClick={(e) => { e.stopPropagation(); onRemove(code) }} title="从自选池移除">×</button>
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
