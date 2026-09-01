import { useEffect, useState } from 'react'
import type { StockData } from '../types'
import StockChart, { type Indicator } from './StockChart'
import FundCard, { fmtNum, fmtPct, upDownClass } from './FundCard'

interface Props {
  data: StockData
  onBack: () => void
}

export default function StockDetail({ data, onBack }: Props) {
  const [indicator, setIndicator] = useState<Indicator>('macd')
  const [showBoll, setShowBoll] = useState(false)
  const { meta, factors } = data
  const pct = meta.pct ?? null

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [data.meta.code])

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="nm">{meta.name}</div>
        <span className="cd">{meta.code.replace(/(sh|sz)\./, '')}</span>
        <span className="ind">{meta.industry}</span>
        <div className="spacer" />
        <div className="big-price">
          <div className={`p ${upDownClass(pct)}`}>{fmtNum(meta.price)}</div>
          <div className={`chg ${upDownClass(pct)}`}>{fmtPct(pct)}</div>
        </div>
      </div>

      <div className="facts">
        <Fact label="PE(TTM)" value={fmtNum(data.fundamentals.pe_ttm)} />
        <Fact label="PB" value={fmtNum(data.fundamentals.pb)} />
        <Fact label="ROE" value={fmtPct(data.fundamentals.roe as number)} />
        <Fact label="市值(亿)" value={fmtNum(data.fundamentals.mktcap, 0)} />
      </div>

      <div className="chart-card">
        <div className="title">
          日K · 均线 · 成交量
          <span className="tag" onClick={() => setShowBoll((b) => !b)}>BOLL {showBoll ? '开' : '关'}</span>
        </div>
        <StockChart data={data} indicator={indicator} showBoll={showBoll} />
        <div className="title" style={{ marginTop: 6 }}>
          副图指标
          {(['macd', 'rsi', 'kdj'] as Indicator[]).map((t) => (
            <span key={t} className={`tag ${indicator === t ? 'on' : ''}`} onClick={() => setIndicator(t)}>
              {t.toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      <FundCard data={data} />

      {factors && factors.length > 0 && (
        <div className="chart-card">
          <div className="title">技术面信号（观察用，未经回测验证）</div>
          <div className="fund-grid">
            {factors.map((f) => (
              <div className="fund-item" key={f.key}>
                <span className="k">{f.name}</span>
                <span className={`v ${f.value == null ? 'flat' : f.value ? 'up' : 'down'}`}>
                  {f.value == null ? '—' : f.value ? '✓ 满足' : '✗ 不满足'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="note-banner">
        数据源：BaoStock（收盘后日线 + 季报），每日自动更新。PB 为披露期净资产反推口径。
        技术信号与打分规则在回测验证通过前仅作观察，不构成买卖结论。
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  )
}
