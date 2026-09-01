// 全市场低估清单 + 综合说明 E2E（系统 Chrome + playwright-core，SW 屏蔽）
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
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      // 忽略预期的 404（步骤 6 故意访问不存在的股）
      if (t.includes('404') || t.includes('Failed to load resource')) return;
      errors.push(t);
    }
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => console.log('REQFAIL', r.url(), r.failure()?.errorText));

  // 1. 列表页
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  const hasMarketEntry = await page.evaluate(() => document.body.innerText.includes('全市场低估'));
  console.log('[1] 列表页含全市场低估入口:', hasMarketEntry);
  if (!hasMarketEntry) errors.push('topbar missing 全市场低估');
  await shot(page, 'e2e-1-list.png');

  // 2. 进入 #/market
  await page.evaluate(() => { location.hash = '#/market'; });
  await page.waitForSelector('.mk-list .mk-item', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const mkCount = await page.$$eval('.mk-item', (els) => els.length);
  const outCount = await page.$$eval('.mk-item-out', (els) => els.length);
  const tagCount = await page.$$eval('.mk-out-tag', (els) => els.length);
  const noteVisible = await page.evaluate(() => document.body.innerText.includes('不构成投资建议'));
  console.log('[2] items=' + mkCount + ', 未加入=' + outCount + '(tags=' + tagCount + '), 评分说明=' + noteVisible);
  if (tagCount === 0) errors.push('未加入徽标缺失');
  if (!noteVisible) errors.push('评分口径说明缺失');
  await shot(page, 'e2e-2-market.png');

  // 3. 未加入条目 cursor
  if (outCount > 0) {
    const firstCursor = await page.$eval('.mk-item-out', (el) => getComputedStyle(el).cursor);
    console.log('[3] 未加入条目 cursor:', firstCursor);
    if (firstCursor !== 'default') errors.push('未加入条目 cursor 应为 default, 实际 ' + firstCursor);
  }

  // 4. 通过 hash 直接进入详情（验证综合说明）
  await page.evaluate(() => { location.hash = '#/stock/sh.601318'; });
  await page.waitForSelector('.chart canvas, .chart', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const commentary = await page.$eval('.commentary', (el) => el.textContent.slice(0, 250)).catch(() => null);
  console.log('[4] 详情页综合说明:', commentary ? '可见' : '缺失');
  if (!commentary) errors.push('commentary block missing');
  if (commentary) console.log('    预览:', commentary.slice(0, 100) + '...');
  await shot(page, 'e2e-3-detail.png');

  // 5. 返回
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.stock-row', { timeout: 10000 });
  console.log('[5] 返回列表 OK');

  // 6. 访问不存在股，验证友好错误
  await page.evaluate(() => { location.hash = '#/stock/sh.999999'; });
  await page.waitForTimeout(3000);
  const errorText = await page.$eval('.error', (el) => el.textContent).catch(() => '');
  console.log('[6] 错误信息:', errorText ? errorText.replace(/\s+/g, ' ').slice(0, 120) : '无');
  if (!errorText.includes('可能不在自选池')) errors.push('友好错误信息缺失');
  await shot(page, 'e2e-6-error.png');

  if (errors.length) {
    console.log('--- console errors ---');
    errors.forEach((e) => console.log('  ', e.slice(0, 200)));
  } else {
    console.log('console errors: NONE');
  }
  await browser.close();
  console.log(errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
