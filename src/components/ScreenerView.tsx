import { useEffect, useMemo, useState } from 'react'
import type { MarketAll, MarketAllItem } from '../types'
import { fetchMarketAll } from '../api'
import { useStore } from '../store'
import type { LocalItem } from '../store'

interface Props {
  dataCodes?: Set<string> // 后端 watchlist.json = "详情数据可用"
  localWatch?: LocalItem[]
  onSelect: (code: string) => void
}

// ---------------- 可筛数值字段 ----------------
type NumKey = 'pe' | 'pb' | 'roe' | 'div_yield' | 'yoy_ni' | 'gpm' | 'debt_ratio' | 'mktcap'
const NUM_FIELDS: { key: NumKey; label: string; unit?: string; hint?: string }[] = [
  { key: 'pe', label: 'PE-TTM' },
  { key: 'pb', label: 'PB' },
  { key: 'roe', label: 'ROE', unit: '%' },
  { key: 'div_yield', label: '股息率', unit: '%' },
  { key: 'yoy_ni', label: '净利同比', unit: '%' },
  { key: 'gpm', label: '毛利率', unit: '%' },
  { key: 'debt_ratio', label: '资产负债率', unit: '%' },
  { key: 'mktcap', label: '总市值', unit: '亿' },
]
const NUM_KEYS = NUM_FIELDS.map((f) => f.key)

// 字段值读取（MarketAllItem 键类型收窄）
function numOf(s: MarketAllItem, k: NumKey): number | null | undefined {
  return s[k]
}

interface NumRange { min?: number; max?: number }
type NumCond = Partial<Record<NumKey, NumRange>>
interface TechCond { macd_gold: boolean; break20: boolean; vol_break: boolean; oversold: boolean }
interface Cond {
  num: NumCond
  inds: string[] // 行业（OR）；空 = 全部
  tech: TechCond
}
const EMPTY_TECH: TechCond = { macd_gold: false, break20: false, vol_break: false, oversold: false }
const EMPTY_COND: Cond = { num: {}, inds: [], tech: { ...EMPTY_TECH } }

// 宽松语义：数值字段无数据（null）视为通过，不因缺数据排除
function numOk(v: number | null | undefined, r?: NumRange): boolean {
  if (!r) return true
  if (v == null) return true
  if (r.min != null && v < r.min) return false
  if (r.max != null && v > r.max) return false
  return true
}

function matchCond(s: MarketAllItem, c: Cond): boolean {
  for (const k of NUM_KEYS) if (!numOk(numOf(s, k), c.num[k])) return false
  if (c.inds.length > 0 && !c.inds.includes(s.industry)) return false
  const t = s.tech
  if (c.tech.macd_gold && !t?.macd_gold) return false
  if (c.tech.break20 && !t?.break_20d_high) return false
  if (c.tech.vol_break && !t?.vol_break) return false
  if (c.tech.oversold && !(t && t.rsi6 != null && t.rsi6 < 30)) return false
  return true
}

// ---------------- 推荐指标预设套餐 ----------------
type SortKey = 'score' | 'pe' | 'pb' | 'roe' | 'div_yield' | 'yoy_ni' | 'debt_ratio' | 'mktcap' | 'close'
const SORT_LABEL: Record<SortKey, string> = {
  score: '六因子评分', pe: 'PE', pb: 'PB', roe: 'ROE',
  div_yield: '股息率', yoy_ni: '净利同比', debt_ratio: '负债率', mktcap: '市值', close: '现价',
}
function rng(min?: number, max?: number): NumRange { return { min, max } }

interface Preset {
  key: string
  icon: string
  name: string
  desc: string
  cond: Cond
  sort?: SortKey
  asc?: boolean
}
const PRESETS: Preset[] = [
  {
    key: 'value_div', icon: '💎', name: '低估值高股息', desc: 'PE<15 · PB<2 · 股息>3% · 负债<75%',
    cond: { num: { pe: rng(0, 15), pb: rng(undefined, 2), div_yield: rng(3), debt_ratio: rng(undefined, 75) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'div_yield', asc: false,
  },
  {
    key: 'growth', icon: '🚀', name: '成长白马', desc: 'ROE>15 · 净利同比>20% · PE<40 · 市值>100亿',
    cond: { num: { roe: rng(15), yoy_ni: rng(20), pe: rng(0, 40), mktcap: rng(100) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'score', asc: false,
  },
  {
    key: 'pb_below', icon: '🪙', name: '破净修复', desc: 'PB<1 · ROE>8 · 净利同比>0',
    cond: { num: { pb: rng(0, 1), roe: rng(8), yoy_ni: rng(0) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'pb', asc: true,
  },
  {
    key: 'defensive', icon: '🏦', name: '防御收息', desc: '股息>4% · PE<20 · 负债<60% · 市值>200亿',
    cond: { num: { div_yield: rng(4), pe: rng(0, 20), debt_ratio: rng(undefined, 60), mktcap: rng(200) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'div_yield', asc: false,
  },
  {
    key: 'quality', icon: '🧱', name: '质量龙头', desc: 'ROE>20 · 毛利率>40% · 负债<50%',
    cond: { num: { roe: rng(20), gpm: rng(40), debt_ratio: rng(undefined, 50) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'roe', asc: false,
  },
  {
    key: 'turn', icon: '⚡', name: '业绩反转', desc: '净利同比>100% · PE<20 · 市值<300亿',
    cond: { num: { yoy_ni: rng(100), pe: rng(0, 20), mktcap: rng(undefined, 300) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'yoy_ni', asc: false,
  },
  {
    key: 'small', icon: '🎯', name: '小市值弹性', desc: '市值<80亿 · PE>0 · 净利同比>20%',
    cond: { num: { mktcap: rng(undefined, 80), pe: rng(0), yoy_ni: rng(20) }, inds: [], tech: { ...EMPTY_TECH } },
    sort: 'score', asc: false,
  },
]

// ---------------- 条件持久化（localStorage） ----------------
const KEY_COND = 'screener_cond_v1'
interface Persist { cond: Cond; sortBy: SortKey; asc: boolean }
function readPersist(): Persist {
  try {
    const p = JSON.parse(localStorage.getItem(KEY_COND) || 'null')
    if (p && p.cond && typeof p.cond === 'object') return { cond: p.cond, sortBy: p.sortBy || 'score', asc: !!p.asc }
  } catch { /* ignore */ }
  return { cond: EMPTY_COND, sortBy: 'score', asc: false }
}
function writePersist(p: Persist) {
  try { localStorage.setItem(KEY_COND, JSON.stringify(p)) } catch { /* ignore */ }
}

function condActive(c: Cond): number {
  let n = 0
  for (const k of NUM_KEYS) if (c.num[k] && (c.num[k]!.min != null || c.num[k]!.max != null)) n++
  n += c.inds.length
  for (const v of Object.values(c.tech)) if (v) n++
  return n
}

function fmtCap(yi: number): string {
  if (yi >= 10000) return (yi / 10000).toFixed(1).replace(/\.0$/, '') + '万亿'
  if (yi >= 1000) return (yi / 1000).toFixed(1).replace(/\.0$/, '') + '千亿'
  return yi.toFixed(0) + '亿'
}

// ---------------- 主组件 ----------------
export default function ScreenerView({ dataCodes, localWatch, onSelect }: Props) {
  const toggleLocal = useStore((s) => s.toggleLocal)
  const [all, setAll] = useState<MarketAll | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const persisted = useMemo(readPersist, [])
  const [cond, setCond] = useState<Cond>(persisted.cond)
  const [sortBy, setSortBy] = useState<SortKey>(persisted.sortBy)
  const [asc, setAsc] = useState(persisted.asc)
  const [presetKey, setPresetKey] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [visible, setVisible] = useState(60)

  useEffect(() => {
    fetchMarketAll().then(setAll).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  // 条件变更 → 持久化（预设激活状态随手动改动清除）
  const persist = (c: Cond, s: SortKey, a: boolean) => writePersist({ cond: c, sortBy: s, asc: a })

  const result = useMemo(() => {
    if (!all) return []
    const arr = all.stocks.filter((s) => matchCond(s, cond))
    arr.sort((x, y) => {
      const a = numOf(x, sortBy as NumKey)
      const b = numOf(y, sortBy as NumKey)
      // 无数据（null）永远沉底，与升降序无关
      if (a == null && b == null) return (x.score ?? 0) - (y.score ?? 0)
      if (a == null) return 1
      if (b == null) return -1
      const d = a - b
      if (d !== 0) return asc ? d : -d
      return (x.score ?? 0) - (y.score ?? 0) // 同值回退按评分
    })
    return arr
  }, [all, cond, sortBy, asc])

  const industryTop = useMemo(() => {
    if (!all) return [] as { name: string; count: number }[]
    const m = new Map<string, number>()
    for (const s of all.stocks) m.set(s.industry, (m.get(s.industry) ?? 0) + 1)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 30)
  }, [all])

  const techReady = useMemo(() => (all ? all.stocks.filter((s) => s.tech).length : 0), [all])

  // ---- 条件操作 ----
  const setNum = (k: NumKey, side: 'min' | 'max', raw: string) => {
    const v = raw === '' ? undefined : Number(raw)
    if (raw !== '' && !Number.isFinite(v)) return
    const next: Cond = { ...cond, num: { ...cond.num, [k]: { ...cond.num[k], [side]: v } } }
    setCond(next); setPresetKey(null); persist(next, sortBy, asc)
  }
  const toggleInd = (name: string) => {
    const next: Cond = { ...cond, inds: cond.inds.includes(name) ? cond.inds.filter((x) => x !== name) : [...cond.inds, name] }
    setCond(next); setPresetKey(null); persist(next, sortBy, asc)
  }
  const toggleTech = (k: keyof TechCond) => {
    const next: Cond = { ...cond, tech: { ...cond.tech, [k]: !cond.tech[k] } }
    setCond(next); setPresetKey(null); persist(next, sortBy, asc)
  }
  const applyPreset = (p: Preset) => {
    setCond(p.cond); setPresetKey(p.key)
    const s = p.sort ?? 'score'; const a = p.asc ?? false
    setSortBy(s); setAsc(a); persist(p.cond, s, a); setVisible(60)
  }
  const clearAll = () => {
    const next = JSON.parse(JSON.stringify(EMPTY_COND)) as Cond
    setCond(next); setPresetKey(null); persist(next, 'score', false)
    setSortBy('score'); setAsc(false); setVisible(60)
  }

  if (err) return <div className="error">⚠ {err}<br />全市场数据尚未生成，等扫描管道完成后即可使用筛选。</div>
  if (!all) return <div className="loading">加载全市场数据…</div>

  const nActive = condActive(cond)
  const showed = result.slice(0, visible)
  const sortSel = (k: SortKey) => {
    setSortBy(k); setVisible(60); persist(cond, k, asc)
  }

  return (
    <div className="market">
      <div className="note-banner">
        全市场筛选：共 <b>{all.universe}</b> 只（六因子扫描 v2，剔除 ST/退市/次新）· 六因子=PE 25% + PB 20%（越低越好）+ ROE 20% + 股息率 15% + 负债率 10% + 净利同比 10%（越高越好）。仅作观察参考，不构成投资建议。· 数据 {all.updated}
      </div>

      <div className="sc-head">
        <button className="sc-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} 筛选条件{nActive > 0 ? `（${nActive}）` : ''}
        </button>
        {(nActive > 0 || presetKey) && (
          <button className="sc-clear" onClick={clearAll}>✕ 清空条件</button>
        )}
      </div>

      {open && (
        <div className="sc-panel">
          {/* 推荐指标套餐 */}
          <div className="sc-sec">
            <div className="sc-sec-label">推荐指标套餐（一键套用）</div>
            <div className="sc-presets">
              {PRESETS.map((p) => (
                <button key={p.key} className={`sc-preset${presetKey === p.key ? ' on' : ''}`} onClick={() => applyPreset(p)}>
                  <span className="sp-name">{p.icon} {p.name}</span>
                  <span className="sp-desc">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 数值范围 */}
          <div className="sc-sec">
            <div className="sc-sec-label">估值 / 质量 / 成长 / 规模（留空=不限；不设条件时不会因数据缺失排除）</div>
            <div className="sc-nums">
              {NUM_FIELDS.map((f) => {
                const r = cond.num[f.key] ?? {}
                return (
                  <div className="sc-num" key={f.key}>
                    <div className="sn-label">{f.label}{f.unit ? `（${f.unit}）` : ''}</div>
                    <div className="sn-inputs">
                      <input type="number" inputMode="decimal" placeholder="min" value={r.min ?? ''}
                        onChange={(e) => setNum(f.key, 'min', e.target.value)} />
                      <span className="sn-tilde">~</span>
                      <input type="number" inputMode="decimal" placeholder="max" value={r.max ?? ''}
                        onChange={(e) => setNum(f.key, 'max', e.target.value)} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 行业 */}
          <div className="sc-sec">
            <div className="sc-sec-label">行业（可多选，OR；选中的行业置顶）</div>
            <div className="sc-chips">
              {[...cond.inds.filter((x) => !industryTop.some((i) => i.name === x)).map((x) => ({ name: x, count: 0 })),
                ...industryTop].map((i) => (
                <button key={i.name} className={`sc-chip${cond.inds.includes(i.name) ? ' on' : ''}`}
                  onClick={() => toggleInd(i.name)}>
                  {i.name}{i.count ? ` ${i.count}` : ''}
                </button>
              ))}
            </div>
          </div>

          {/* 技术形态 */}
          <div className="sc-sec">
            <div className="sc-sec-label">
              技术形态
              {techReady === 0 ? <span className="sc-coming">（技术面数据生成中，全量扫描后可用）</span> : <span className="sc-coming">（{techReady} 只已有技术快照）</span>}
            </div>
            <div className="sc-chips">
              {([
                ['macd_gold', 'MACD 金叉'], ['break20', '突破 20 日高'],
                ['vol_break', '放量'], ['oversold', 'RSI6 超卖(<30)'],
              ] as [keyof TechCond, string][]).map(([k, label]) => (
                <button key={k} className={`sc-chip${cond.tech[k] ? ' on' : ''}`}
                  disabled={techReady === 0} onClick={() => toggleTech(k)}>
                  {cond.tech[k] ? '✓ ' : ''}{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 结果区 */}
      <div className="sc-result-head">
        <div className="sc-count">命中 <b>{result.length}</b> / {all.universe} 只</div>
        <div className="sc-sort">
          <select value={sortBy} onChange={(e) => sortSel(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>按 {SORT_LABEL[k]}</option>
            ))}
          </select>
          <button className={`sc-dir${asc ? '' : ' desc'}`} onClick={() => { setAsc(!asc); persist(cond, sortBy, !asc) }}>
            {asc ? '↑ 升序' : '↓ 降序'}
          </button>
        </div>
      </div>

      <div className="mk-list">
        {showed.map((s) => {
          const hasData = dataCodes?.has(s.code) ?? false
          const isAdded = localWatch?.some((p) => p.code === s.code) ?? false
          const t = s.tech
          return (
            <div className="mk-item clickable" key={s.code} onClick={() => onSelect(s.code)}
              title={hasData ? `查看 ${s.name} 详情（深度版）` : `查看 ${s.name} 的全市场评分与解释`}>
              <div className="mk-rank">{s.rank ?? '—'}</div>
              <div className="mk-main">
                <div className="mk-name">
                  {s.name}
                  <span className="mk-code">{s.code.replace(/^(sh|sz)\./, '')}</span>
                  {isAdded ? <span className="mk-in-tag">已加入</span> : null}
                </div>
                <div className="mk-ind">{s.industry}</div>
                {t && (
                  <div className="mk-tech">
                    {t.macd_gold && <span className="tk tk-bull">MACD金叉</span>}
                    {t.break_20d_high && <span className="tk tk-bull">突破20日高</span>}
                    {t.vol_break && <span className="tk tk-vol">放量</span>}
                    {t.rsi6 != null && t.rsi6 < 30 && <span className="tk tk-over">RSI超卖</span>}
                    {!t.macd_gold && !t.break_20d_high && !t.vol_break &&
                      t.ma5 != null && t.ma20 != null && t.ma60 != null && t.ma5 > t.ma20 && t.ma20 > t.ma60 &&
                      <span className="tk tk-bull">多头排列</span>}
                    {!t.macd_gold && !t.break_20d_high && !t.vol_break &&
                      t.ma5 != null && t.ma20 != null && t.ma5 < t.ma20 &&
                      <span className="tk tk-bear">空头排列</span>}
                  </div>
                )}
              </div>
              <div className="mk-nums">
                <div className="mk-price">{s.close ?? '—'}</div>
                <div className="mk-meta">PE {s.pe ?? '—'} · PB {s.pb ?? '—'} · ROE {s.roe ?? '—'}%</div>
                <div className="mk-meta2">
                  {s.div_yield != null ? <>息 {s.div_yield}%</> : <span className="dim">息 —</span>}
                  {' · '}
                  {s.mktcap != null ? <>市值 {fmtCap(s.mktcap)}</> : <span className="dim">市值 —</span>}
                  {' · 负债 '}{s.debt_ratio ?? '—'}%
                  {' · 净利 '}
                  {s.yoy_ni != null ? <span className={s.yoy_ni >= 0 ? 'up' : 'down'}>{s.yoy_ni > 0 ? '+' : ''}{s.yoy_ni}%</span> : '—'}
                </div>
              </div>
              <div className="mk-score">{s.score != null ? s.score.toFixed(3) : <span className="mk-noscore">亏损</span>}</div>
              <button className={`mk-add-btn${isAdded ? ' added' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleLocal({ code: s.code, name: s.name, industry: s.industry }) }}>
                {isAdded ? '已加入 ✓' : '＋ 加入'}
              </button>
            </div>
          )
        })}
        {showed.length === 0 && (
          <div className="sc-empty">没有符合当前条件的股票。<br />试试点上方「清空条件」，或从推荐套餐换一个策略。</div>
        )}
      </div>

      {result.length > visible && (
        <button className="sc-more" onClick={() => setVisible(visible + 60)}>
          加载更多（剩余 {result.length - visible} 只）
        </button>
      )}
    </div>
  )
}
