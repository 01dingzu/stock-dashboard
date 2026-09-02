// split-brain 场景验证（本地）：预置旧 pending key → 打开 → 应并入 localWatch 且清掉旧 key
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5177/';
const KEY = 'watchlist_local_v1';
const PEND = 'watchlist_pending_v1';
const errors = [];

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

  // 1. 全新打开 → 默认导入 20
  await page.goto(BASE + '?t=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.stock-row', { timeout: 15000 });
  await page.waitForTimeout(1200);
  let n = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).length, KEY);
  console.log('[1] 初始 localWatch:', n, '| 期望 20');
  if (n !== 20) errors.push('初始应为 20');

  // 2. 模拟"旧 v6 页面"把 2 只写入 pending key（其中一只已存在 → 应去重，另一只应并入）
  const pend = await page.evaluate(({ p }) => {
    localStorage.setItem(p, JSON.stringify([
      { code: 'sh601318', name: '中国平安', industry: '保险' },   // 默认池已有 → 去重
      { code: 'sz.000333', name: '美的集团', industry: '家电' },  // 新 → 并入
      { code: 'sh600000', name: '浦发银行', industry: '银行' },   // 新 → 并入
    ]));
    return localStorage.getItem(p).length;
  }, { p: PEND });
  console.log('[2] 预置 pending key 字节:', pend);

  // 3. 刷新 → absorbLegacy 应并入 2 只新项（22 条），pending key 应被删除
  await page.goto(BASE + '?t=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.stock-row', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const s3 = await page.evaluate(({ k, p }) => {
    const arr = JSON.parse(localStorage.getItem(k));
    return { n: arr.length, hasMeidi: arr.some(i => i.code === 'sz.000333'), hasPufa: arr.some(i => i.code === 'sh600000'), pendLeft: localStorage.getItem(p) };
  }, { k: KEY, p: PEND });
  console.log('[3] 刷新后:', JSON.stringify(s3), '| 期望 n=22 hasMeidi=true hasPufa=true pendLeft=null');
  if (s3.n !== 22) errors.push('并入后应为 22, 实际 ' + s3.n);
  if (!s3.hasMeidi || !s3.hasPufa) errors.push('pending 项未并入');
  if (s3.pendLeft !== null) errors.push('pending key 未清理');

  // 4. 再刷新 → 仍 22（幂等不重复）
  await page.goto(BASE + '?t=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.stock-row', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const s4 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).length, KEY);
  console.log('[4] 再次刷新 localWatch:', s4, '| 期望 22');
  if (s4 !== 22) errors.push('再次刷新应为 22, 实际 ' + s4);

  // 5. 行内应显示美的/浦发（待同步横幅）
  const body = await page.evaluate(() => document.body.innerText.includes('美的集团') && document.body.innerText.includes('浦发银行'));
  console.log('[5] 列表含美的/浦发:', body, '| 期望 true');

  console.log('\n================ RESULT ================');
  if (errors.length) { console.log('FAIL:'); errors.forEach((e) => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('ALL PASS — split-brain 兜底迁移正常');
  await browser.close();
}
main().catch((e) => { console.error('SCRIPT ERR', e); process.exit(1); });
