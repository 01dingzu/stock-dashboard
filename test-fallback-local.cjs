// 本地验证：市场版兜底详情页（MarketCard fallback）UI 流程
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5177/';
const errors = [];

async function shot(page, name) {
  await page.screenshot({ path: name, fullPage: false });
  console.log('screenshot:', name);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('404') || t.includes('Failed to load resource')) return;
      errors.push(t);
    }
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // 1. 市场页加载
  await page.goto(BASE + '#/market', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.mk-list .mk-item', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const items = await page.$$eval('.mk-item', (els) => els.length);
  const notAdded = await page.$$eval('.mk-item.not-added', (els) => els.length);
  console.log('[1] market items=' + items + ', 未加入行=' + notAdded);
  if (items < 20) errors.push('市场清单条数异常: ' + items);
  if (notAdded < 1) errors.push('无可点击的未加入行');

  // 2. 点击未加入行 → 兜底详情（MarketCard）
  const targetCode = await page.$eval('.mk-item.not-added .mk-code', (el) => el.textContent).catch(() => '');
  const targetName = await page.$eval('.mk-item.not-added .mk-name', (el) => el.childNodes[0].textContent.trim()).catch(() => '');
  console.log('[2] 点击未加入行 code=' + targetCode + ' name=' + targetName.trim().slice(0, 10));
  await page.click('.mk-item.not-added >> nth=0');
  await page.waitForSelector('.mk-hero', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const heroText = await page.$eval('.mk-hero', (el) => el.textContent.replace(/\s+/g, ' ')).catch(() => '');
  const commentaryVisible = await page.$eval('.commentary', (el) => el.textContent.length > 0).catch(() => false);
  const headText = await page.$eval('.detail-head .nm', (el) => el.textContent).catch(() => '');
  const addBtn = await page.$eval('.fallback-add', (el) => el.textContent).catch(() => '');
  console.log('[2b] hero="' + heroText.slice(0, 60) + '" commentary=' + commentaryVisible + ' head=' + headText);
  if (!heroText.includes('#') || !heroText.includes('评分')) errors.push('hero 排名/评分缺失: ' + heroText);
  if (!commentaryVisible) errors.push('市场版综合说明缺失');
  if (headText !== targetName.trim()) errors.push('头部名称不符: ' + headText + ' vs ' + targetName.trim());
  if (!addBtn.includes('加入')) errors.push('加入按钮缺失');
  await shot(page, 'e2e-fallback-1.png');

  // 3. 加入按钮 → 已加入态
  await page.click('.fallback-add');
  await page.waitForTimeout(800);
  const btnAfter = await page.$eval('.fallback-add', (el) => el.textContent).catch(() => '');
  console.log('[3] 加入后按钮="' + btnAfter + '"');
  if (!btnAfter.includes('已加入')) errors.push('加入后状态未更新: ' + btnAfter);
  await shot(page, 'e2e-fallback-2.png');

  // 4. 列表页出现新加入条目（pending）
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  await page.waitForTimeout(600);
  const listNames = await page.$$eval('.stock-row .name', (els) => els.map((e) => e.textContent));
  const hasNew = listNames.some((n) => n.includes(targetName.trim().slice(0, 4)));
  const pendingText = await page.evaluate(() => document.body.innerText.includes('待同步'));
  console.log('[4] 列表含新加入=' + hasNew + ', 待同步banner=' + pendingText + ', 列表数=' + listNames.length);
  if (!hasNew) errors.push('列表未出现新加入股票');
  if (!pendingText) errors.push('待同步提示缺失（新加入无深度数据）');

  // 5. 深度详情回归（中国平安）
  await page.evaluate(() => { location.hash = '#/stock/sh.601318'; });
  await page.waitForSelector('.chart canvas, .chart', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const deepOK = await page.$eval('.commentary', (el) => el.textContent.length > 10).catch(() => false);
  console.log('[5] 深度详情回归 commentary=' + deepOK);
  if (!deepOK) errors.push('深度详情页回归失败');

  // 6. 未收录股票 → 友好提示（未找到）
  await page.evaluate(() => { location.hash = '#/stock/sz.999999'; });
  await page.waitForTimeout(4000);
  const errText = await page.$eval('.error', (el) => el.textContent.replace(/\s+/g, ' ')).catch(() => '');
  console.log('[6] 错误提示="' + errText.slice(0, 90) + '"');
  if (!errText.includes('未找到') && !errText.includes('扫描范围')) errors.push('未收录提示缺失: ' + errText);

  if (errors.length) {
    console.log('--- ERRORS ---');
    errors.forEach((e) => console.log('  ', e.slice(0, 200)));
  } else {
    console.log('console errors: NONE');
  }
  await browser.close();
  console.log(errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
