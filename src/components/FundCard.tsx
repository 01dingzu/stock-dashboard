import type { StockData } from '../types'

export function fmtNum(v: number | string | null | undefined, digits = 2): string {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(digits)}%`
}

export function upDownClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v)) || Number(v) === 0) return 'flat'
  return Number(v) > 0 ? 'up' : 'down'
}

interface Props {
  data: StockData
}

const ROWS: { key: string; label: string; note?: string; digits?: number; percent?: boolean }[] = [
  { key: 'pe_ttm', label: 'PE(TTM)', note: '市盈率' },
  { key: 'pb_est', label: 'PB', note: '≈估算' },
  { key: 'roe', label: 'ROE', note: '净资产收益率', percent: true },
  { key: 'yoy_rev', label: '营收同比', percent: true },
  { key: 'yoy_ni', label: '净利同比', percent: true },
  { key: 'gp_margin', label: '毛利率', percent: true },
  { key: 'np_margin', label: '净利率', percent: true },
  { key: 'debt_ratio', label: '资产负债率', percent: true },
  { key: 'mktcap', label: '总市值', note: '亿元', digits: 0 },
]

export default function FundCard({ data }: Props) {
  const f = data.fundamentals
  const ry = f.report_year
  const rq = f.report_quarter
  const reportPeriod = ry && rq ? `${Math.trunc(Number(ry))}Q${Math.trunc(Number(rq))}` : null
  const pubDate = f.pub_date ? String(f.pub_date) : null

  return (
    <div className="chart-card">
      <div className="title">
        基本面
        <span className="tag" style={{ borderColor: 'transparent', background: 'transparent' }}>
          {reportPeriod ? `财报期 ${reportPeriod}` : ''}
          {pubDate ? ` · ${pubDate}披露` : ''}
        </span>
      </div>
      <div className="fund-grid">
        {ROWS.map((r) => {
          const v = f[r.key]
          return (
            <div className="fund-item" key={r.key}>
              <span className="k">{r.label} {r.note ? <span className="note">{r.note}</span> : null}</span>
              <span className="v">
                {r.percent ? fmtPct(v as number) : fmtNum(v as number, r.digits ?? 2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
