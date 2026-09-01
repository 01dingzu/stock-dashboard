import type { Watchlist } from '../types'
import { fmtNum, fmtPct, upDownClass } from './FundCard'

interface Props {
  watchlist: Watchlist
  onSelect: (code: string) => void
}

export default function StockList({ watchlist, onSelect }: Props) {
  return (
    <div className="list">
      {watchlist.stocks.map((s) => (
        <div className="stock-row" key={s.code} onClick={() => onSelect(s.code)}>
          <div>
            <div className="name">{s.name}</div>
            <div className="code">
              {s.code.replace(/(sh|sz)\./, '')}
              <span className="industry">{s.industry}</span>
            </div>
          </div>
          <div className="spacer" />
          <div className="price">
            <div className={`p ${upDownClass(s.pct)}`}>{fmtNum(s.price)}</div>
            <div className={`chg ${upDownClass(s.pct)}`}>{fmtPct(s.pct)}</div>
          </div>
        </div>
      ))}
      {watchlist.stocks.length === 0 && <div className="loading">暂无数据（管道可能未运行）</div>}
    </div>
  )
}
