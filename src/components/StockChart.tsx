import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { StockData } from '../types'

const UP = '#f6465d'    // 红涨
const DOWN = '#2ebd85'  // 绿跌
const MA_COLORS: Record<string, string> = { ma5: '#f7c948', ma10: '#3b82f6', ma20: '#c084fc', ma60: '#22d3ee' }
const MA_WINS = ['ma5', 'ma10', 'ma20', 'ma60'] as const

export type Indicator = 'macd' | 'rsi' | 'kdj'

interface Props {
  data: StockData
  indicator: Indicator
  showBoll: boolean
}

export default function StockChart({ data, indicator, showBoll }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(buildOption(data, indicator, showBoll), { notMerge: true })
  }, [data, indicator, showBoll])

  return <div ref={ref} className="chart" />
}

function buildOption(data: StockData, indicator: Indicator, showBoll: boolean): echarts.EChartsOption {
  const k = data.kline
  const dates = k.map((x) => x.d)
  const candles = k.map((x) => [x.o, x.c, x.l, x.h] as number[])
  const vols = k.map((x) => ({ value: x.v ?? 0, itemStyle: { color: x.c >= x.o ? UP : DOWN } }))
  const volMa = k.map((x) => x.vol_ma5)

  const maSeries = MA_WINS.map((m) => ({
    name: m.toUpperCase(),
    type: 'line' as const,
    data: k.map((x) => x[m]),
    smooth: true,
    showSymbol: false,
    lineStyle: { width: 1, color: MA_COLORS[m] },
    xAxisIndex: 0,
    yAxisIndex: 0,
  }))

  const bollSeries = [
    { name: 'BOLL上', type: 'line' as const, data: k.map((x) => x.boll_up), showSymbol: false, lineStyle: { width: 1, type: 'dashed' as const, color: '#5b6b85' }, xAxisIndex: 0, yAxisIndex: 0 },
    { name: 'BOLL中', type: 'line' as const, data: k.map((x) => x.boll_mid), showSymbol: false, lineStyle: { width: 1, type: 'dashed' as const, color: '#5b6b85' }, xAxisIndex: 0, yAxisIndex: 0 },
    { name: 'BOLL下', type: 'line' as const, data: k.map((x) => x.boll_low), showSymbol: false, lineStyle: { width: 1, type: 'dashed' as const, color: '#5b6b85' }, xAxisIndex: 0, yAxisIndex: 0 },
  ]

  const indSeries = buildIndicatorSeries(data, indicator)

  return {
    animation: false,
    backgroundColor: 'transparent',
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'cross' },
      backgroundColor: '#1e2632',
      borderColor: '#2a3342',
      textStyle: { color: '#e6e9ef', fontSize: 11 },
    },
    legend: {
      show: false,
    },
    grid: [
      { left: 50, right: 12, top: 12, height: '52%' },
      { left: 50, right: 12, top: '67%', height: '11%' },
      { left: 50, right: 12, top: '81%', height: '13%' },
    ],
    xAxis: [0, 1, 2].map((i) => ({
      type: 'category' as const,
      data: dates,
      gridIndex: i,
      axisLine: { lineStyle: { color: '#2a3342' } },
      axisLabel: { show: i === 2, color: '#8b95a7', fontSize: 10 },
      axisTick: { show: false },
      splitLine: { show: false },
    })),
    yAxis: [
      {
        scale: true, gridIndex: 0,
        axisLabel: { color: '#8b95a7', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e2632' } },
      },
      {
        gridIndex: 1, splitNumber: 2,
        axisLabel: { color: '#8b95a7', fontSize: 10 },
        splitLine: { show: false },
      },
      {
        scale: true, gridIndex: 2, splitNumber: 3,
        axisLabel: { color: '#8b95a7', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e2632' } },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], start: 55, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1, 2], start: 55, end: 100, bottom: 2, height: 14, borderColor: '#2a3342', backgroundColor: '#171d27', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: '#3b82f6' }, textStyle: { color: '#8b95a7', fontSize: 10 } },
    ],
    series: [
      {
        name: 'K线', type: 'candlestick', data: candles,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
        xAxisIndex: 0, yAxisIndex: 0,
      },
      ...maSeries,
      ...(showBoll ? bollSeries : []),
      {
        name: '成交量', type: 'bar', data: vols, xAxisIndex: 1, yAxisIndex: 1,
        barWidth: '60%',
      },
      { name: 'VOL_MA5', type: 'line', data: volMa, showSymbol: false, xAxisIndex: 1, yAxisIndex: 1, lineStyle: { width: 1, color: '#f7c948' } },
      ...indSeries,
    ],
  }
}

function buildIndicatorSeries(data: StockData, indicator: Indicator): echarts.SeriesOption[] {
  if (indicator === 'macd') {
    const d = data.macd
    return [
      {
        name: 'MACD', type: 'bar', data: d.map((p) => ({ value: p.macd, itemStyle: { color: (p.macd ?? 0) >= 0 ? UP : DOWN } })), xAxisIndex: 2, yAxisIndex: 2, barWidth: '60%',
      },
      { name: 'DIF', type: 'line', data: d.map((p) => p.dif), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#f7c948' } },
      { name: 'DEA', type: 'line', data: d.map((p) => p.dea), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#3b82f6' } },
    ]
  }
  if (indicator === 'rsi') {
    const d = data.rsi
    return [
      { name: 'RSI6', type: 'line', data: d.map((p) => p.rsi6), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#f7c948' } },
      { name: 'RSI12', type: 'line', data: d.map((p) => p.rsi12), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#3b82f6' } },
      { name: 'RSI24', type: 'line', data: d.map((p) => p.rsi24), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#c084fc' } },
      {
        name: 'RSI-70', type: 'line', data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: '#5b6b85', type: 'dashed' }, label: { show: false }, data: [{ yAxis: 70 }, { yAxis: 30 }] }, xAxisIndex: 2, yAxisIndex: 2,
      },
    ]
  }
  const d = data.kdj
  return [
    { name: 'K', type: 'line', data: d.map((p) => p.kdj_k), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#f7c948' } },
    { name: 'D', type: 'line', data: d.map((p) => p.kdj_d), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#3b82f6' } },
    { name: 'J', type: 'line', data: d.map((p) => p.kdj_j), showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, lineStyle: { width: 1, color: '#c084fc' } },
  ]
}
