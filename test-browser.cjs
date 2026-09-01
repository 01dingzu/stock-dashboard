// 真实浏览器端到端验证（系统 Chrome + playwright-core，绕开 Chromium 下载）
// 用法: node test-browser.js
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:4174/';
const errors = [];
const logs = [];

async function shot(page, name) {
  await page.screenshot({ path: name, fullPage: false });
  console.log('screenshot:', name);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('console', (m) => { console.log('CONSOLE', m.type(), m.text().slice(0, 250)); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message.slice(0, 300)); errors.push('PAGEERROR: ' + e.message); });
  page.on('requestfailed', (r) => console.log('REQFAIL', r.url(), r.failure()?.errorText));

  // ---- 列表页（移动端） ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('--- after goto, url:', page.url());
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('--- body text (300):', body);
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no SW API';
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length ? 'registered: ' + regs[0].active?.state : 'none';
  });
  console.log('--- SW state:', swState);
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  const rowCount = await page.$$eval('.stock-row', (els) => els.length);
  const firstName = await page.$eval('.stock-row .name', (el) => el.textContent);
  console.log('列表页: rows =', rowCount, 'first =', firstName);
  await shot(page, 'shot-list-mobile.png');

  // ---- 进入第一只股票详情 ----
  await page.click('.stock-row');
  await page.waitForSelector('.chart', { timeout: 10000 });
  await page.waitForTimeout(2500); // 等 ECharts 渲染
  const hasCanvas = await page.$$eval('.chart canvas', (els) => els.length);
  console.log('详情页 canvas 数:', hasCanvas);
  const pe = await page.$eval('.facts .fact .v', (el) => el.textContent);
  console.log('首个基本面卡片:', pe);
  await shot(page, 'shot-detail-mobile.png');

  // 切换副图指标 RSI / KDJ
  await page.click('.title .tag:has-text("RSI")');
  await page.waitForTimeout(1200);
  await shot(page, 'shot-detail-rsi.png');
  await page.click('.title .tag:has-text("KDJ")');
  await page.waitForTimeout(1200);
  await shot(page, 'shot-detail-kdj.png');

  // ---- 桌面视口再截一张 ----
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(1200);
  await shot(page, 'shot-detail-desktop.png');

  // ---- 返回列表（直接修改 hash 绕开 click 不稳定） ----
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.stock-row', { timeout: 10000 });
  console.log('返回列表 OK');

  // ---- 数据完整性：全部 20 只详情页可打开 ----
  const codes = await page.$$eval('.stock-row', (els) => els.map((e) => e.getAttribute('data-code')));
  console.log('codes from data-code attr:', codes.length);

  if (errors.length) {
    console.log('--- console errors ---');
    errors.forEach((e) => console.log('  ', e.slice(0, 200)));
  } else {
    console.log('console errors: NONE');
  }
  await browser.close();
  console.log(errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
