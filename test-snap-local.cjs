// 自选池"任意股快照行"本地验证：非默认池股(浦发 600000)在自选池列表显示 收盘/当日/周/月
// 步骤：注入 localStorage(含默认池招行 + 非默认浦发) → 打开 → 断言两行均渲染、浦发行带快照标签与周月、无 pending banner
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5177/';
const errors = [];
async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 预置自选池：招行(默认池/深度) + 浦发(非默认/市场快照)
  await page.evaluate(() => {
    localStorage.setItem('watchlist_local_v1', JSON.stringify([
      { code: 'sh.600036', name: '招商银行', industry: '银行' },
      { code: 'sh.600000', name: '浦发银行', industry: '银行' },
    ]));
    localStorage.removeItem('watchlist_pending_v1');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);

  // [1] 行数 2 且无待同步横幅
  const rows = await page.$$eval('.stock-row', (els) => els.map((e) => e.textContent));
  const banner = await page.$('.pending-banner').catch(() => null);
  const bannerText = banner ? await banner.textContent() : '';
  console.log('[1] 行数:', rows.length, '| pending-banner:', JSON.stringify(bannerText));
  if (rows.length !== 2) errors.push(`行数 ${rows.length} != 2`);
  if (bannerText && bannerText.includes('暂无行情')) errors.push('不应出现待同步横幅（浦发已被 px 覆盖）');

  // [2] 招行 = 深度行（无快照标签，有估值分或价格）；浦发 = 快照行（有 .snap-tag + 周/月）
  const snapTags = await page.$$eval('.snap-tag', (els) => els.map((e) => e.parentElement.textContent.trim()));
  console.log('[2] snap-tag 行:', snapTags);
  if (snapTags.length !== 1 || !snapTags[0].includes('浦发银行')) errors.push('浦发快照行缺失/标记错误');

  const pxRow = await page.$$eval('.stock-row', (els) => {
    const r = els.find((e) => e.textContent.includes('浦发银行'));
    if (!r) return null;
    return {
      hasSnap: !!r.querySelector('.snap-tag'),
      price: r.querySelector('.p')?.textContent || '',
      chg: r.querySelector('.chg')?.textContent || '',
      rp: Array.from(r.querySelectorAll('.rp')).map((x) => x.textContent),
    };
  });
  console.log('[2] 浦发行 UI:', JSON.stringify(pxRow));
  if (!pxRow || !pxRow.hasSnap) errors.push('浦发行缺 snap-tag');
  if (!pxRow || !pxRow.rp.length || !pxRow.rp[0].includes('周')) errors.push('浦发行缺周/月小字');

  const cmRow = await page.$$eval('.stock-row', (els) => {
    const r = els.find((e) => e.textContent.includes('招商银行'));
    if (!r) return null;
    return { hasSnap: !!r.querySelector('.snap-tag'), price: r.querySelector('.p')?.textContent || '' };
  });
  console.log('[2] 招行深度行:', JSON.stringify(cmRow));
  if (!cmRow || cmRow.hasSnap) errors.push('招行不应是快照行（默认池有深度数据）');

  // [3] 汇总条应含周/月统计（2 行都有行情）
  const strip = await page.$eval('.perf-strip', (e) => e.textContent).catch(() => '');
  console.log('[3] perf-strip:', JSON.stringify(strip));
  if (!strip.includes('周') || !strip.includes('月')) errors.push('汇总条缺失周/月统计');

  // [4] 周涨排序：浦发 +0.76 vs 招行 +2.69，招行应排前（非默认行也能参与周排序）
  await page.click('text=周涨↓');
  await page.waitForTimeout(500);
  const namesAfter = await page.$$eval('.stock-row .name', (els) => els.map((e) => e.textContent.trim()));
  console.log('[4] 周涨↓排序:', namesAfter.join(' > '));
  if (!namesAfter[0].startsWith('招商银行')) errors.push('周排序未把招行排第一');

  await page.screenshot({ path: 'e2e-snap-local.png', fullPage: false });
  await browser.close();
  console.log(errors.length ? 'FAIL:\n' + errors.join('\n') : 'ALL PASS');
  process.exit(errors.length ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(2); });
