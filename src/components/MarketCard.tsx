import type { MarketAllItem, MarketAll } from '../types'
import { fmtPct, upDownClass } from './FundCard'
import { useStore } from '../store'
import type { LocalItem } from '../store'

interface Props {
  item: MarketAllItem
  meta: Pick<MarketAll, 'updated' | 'universe' | 'note'>
  onBack: () => void
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtCap(yi: number | null | undefined): string {
  if (yi == null || Number.isNaN(Number(yi))) return '—'
  if (yi >= 10000) return (yi / 10000).toFixed(1).replace(/\.0$/, '') + '万亿'
  if (yi >= 1000) return (yi / 1000).toFixed(1).replace(/\.0$/, '') + '千亿'
  return yi.toFixed(0) + '亿'
}

// 六因子评分等级：满分 1.0（0.72+ 优秀 / 0.60+ 中等 / 其余偏弱）
function scoreClass(score: number | null): string {
  if (score == null) return 'none'
  if (score >= 0.72) return 'good'
  if (score >= 0.6) return 'mid'
  return 'low'
}

export default function MarketCard({ item, meta, onBack }: Props) {
  const toggleLocal = useStore((s) => s.toggleLocal)
  const isAdded = useStore((s) => s.localWatch.some((i) => i.code === item.code))
  const s = item
  const add = (l: LocalItem) => toggleLocal(l)

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="nm">{s.name}</div>
        <span className="cd">{s.code.replace(/^(sh|sz)\./, '')}</span>
        <span className="ind">{s.industry}</span>
        <div className="spacer" />
        <div className="big-price">
          <div className="p flat">{fmtNum(s.close)}</div>
          <div className="chg dim-txt">收盘</div>
        </div>
      </div>

      <div className="mk-hero">
        <div className="mk-hero-block">
          <div className="k">全市场排名</div>
          <div className="v">
            {s.rank != null ? `#${s.rank}` : '—'}
            <span className="dim"> / {meta.universe} 只</span>
          </div>
        </div>
        <div className="mk-hero-block">
          <div className="k">六因子评分</div>
          <div className={`v hero-score ${scoreClass(s.score)}`}>{s.score != null ? s.score.toFixed(3) : <span>亏损 / 数据不足，未参与六因子评分</span>}</div>
        </div>
        <div className="mk-hero-block">
          <div className="k">财报期</div>
          <div className="v">{s.report ?? '—'}</div>
        </div>
      </div>

      <div className="chart-card">
        <div className="title">六因子指标</div>
        <div className="fund-grid">
          <div className="fund-item"><span className="k">PE</span><span className="v">{fmtNum(s.pe)}</span></div>
          <div className="fund-item"><span className="k">PB</span><span className="v">{fmtNum(s.pb)}</span></div>
          <div className="fund-item"><span className="k">ROE</span><span className="v">{fmtPct(s.roe)}</span></div>
          <div className="fund-item"><span className="k">股息率</span><span className="v">{fmtPct(s.div_yield)}</span></div>
          <div className="fund-item"><span className="k">负债率</span><span className="v">{fmtPct(s.debt_ratio)}</span></div>
          <div className="fund-item">
            <span className="k">净利同比</span>
            <span className={`v ${upDownClass(s.yoy_ni)}`}>{fmtPct(s.yoy_ni)}</span>
          </div>
          <div className="fund-item"><span className="k">毛利率</span><span className="v">{fmtPct(s.gpm)}</span></div>
          <div className="fund-item"><span className="k">市值</span><span className="v">{fmtCap(s.mktcap)}</span></div>
        </div>
      </div>

      <div className="chart-card">
        <div className="title">综合说明（全市场版）</div>
        {s.commentary ? (
          <div className="commentary">{s.commentary}</div>
        ) : (
          <div className="commentary dim-txt">该股因子数据不足，暂无点评。</div>
        )}
      </div>

      <button className={`fallback-add${isAdded ? ' added' : ''}`} onClick={() => add({ code: s.code, name: s.name, industry: s.industry })}>
        {isAdded ? '✓ 已加入自选池' : '＋ 加入自选池'}
      </button>
      {isAdded && (
        <div className="sync-hint" style={{ textAlign: 'center', marginTop: 6 }}>
          详情数据（日K图等）将随后台管道生成，当前展示全市场扫描版。
        </div>
      )}

      <div className="note-banner">
        数据源：BaoStock 全市场扫描 · {meta.updated}。规则模板点评（六因子 + 均线/信号），不构成投资建议。
      </div>
    </div>
  )
}
