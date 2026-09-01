// 全市场低估清单 + 综合说明 E2E（系统 Chrome + playwright-core，SW 屏蔽）
// 用法: node test-market-e2e.cjs
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'https://01dingzu.github.io/stock-dashboard/';
const errors = [];

async function shot(page, name) {
  await page.screenshot({ path: name, fullPage: false });
  console.log('screenshot:', name);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => console.log('REQFAIL', r.url(), r.failure()?.errorText));

  // ---- 1. 列表页加载 + topbar 入口 ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  const navBtn = await page.$eval('.back-btn, .topbar a, .nav-btn', (el) => el.textContent).catch(() => 'N/A');
  console.log('列表页 OK, nav:', navBtn);
  const hasMarketEntry = await page.evaluate(() => document.body.innerText.includes('全市场低估'));
  console.log('列表页含「全市场低估」入口:', hasMarketEntry);
  await shot(page, 'e2e-1-list.png');

  // ---- 2. 进入 #/market 低估清单 ----
  await page.evaluate(() => { location.hash = '#/market'; });
  await page.waitForSelector('.mk-list .mk-item', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const mkCount = await page.$$eval('.mk-item', (els) => els.length);
  const mkFirst = await page.$eval('.mk-item', (el) => el.textContent.slice(0, 120));
  console.log('低估清单 items =', mkCount);
  console.log('首条:', mkFirst);
  const noteVisible = await page.evaluate(() => document.body.innerText.includes('不构成投资建议'));
  console.log('评分口径说明可见:', noteVisible);
  await shot(page, 'e2e-2-market.png');

  // ---- 3. 点击首条进入详情 ----
  await page.click('.mk-item');
  await page.waitForSelector('.chart canvas, .chart', { timeout: 15000 });
  await page.waitForTimeout(2500);
  // 综合说明区块
  const commentary = await page.$eval('.commentary', (el) => el.textContent.slice(0, 200)).catch(() => null);
  console.log('详情页综合说明:', commentary ? '可见' : '缺失', commentary ? '-> ' + commentary : '');
  if (!commentary) errors.push('commentary block missing');
  await shot(page, 'e2e-3-detail.png');

  // ---- 4. 详情页回到列表，再验证列表 topbar 返回 ----
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.stock-row', { timeout: 10000 });
  console.log('返回列表 OK');

  if (errors.length) {
    console.log('--- console errors ---');
    errors.forEach((e) => console.log('  ', e.slice(0, 200)));
  } else {
    console.log('console errors: NONE');
  }
  await browser.close();
  console.log(errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
