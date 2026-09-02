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

  // 3.5 加入自选池流程：点"＋ 加入" → 已选待同步徽标 → localStorage 持久化 → 刷新仍在 → 复制清单 → 列表页提示
  await page.waitForSelector('.mk-add-btn', { timeout: 10000 });
  await page.locator('.mk-add-btn').first().click();
  await page.waitForTimeout(800);
  const pickedTag = await page.$$eval('.mk-picked-tag', (els) => els.length);
  const pickedName = await page.$eval('.mk-picked-tag', (el) => el.closest('.mk-item').querySelector('.mk-name').textContent.trim()).catch(() => '');
  console.log('[3.5] 点击加入后 已选待同步=' + pickedTag, '首个:', pickedName);
  if (pickedTag === 0) errors.push('加入按钮点击后未出现已选待同步徽标');
  const ls = await page.evaluate(() => JSON.parse(localStorage.getItem('watchlist_pending_v1') || '[]'));
  console.log('      localStorage 记录:', JSON.stringify(ls));
  if (ls.length !== 1) errors.push('localStorage 待同步记录应为 1, 实际 ' + ls.length);
  const syncBanner = await page.evaluate(() => document.body.innerText.includes('已选 1 只待同步'));
  if (!syncBanner) errors.push('sync-banner 未显示已选数量');
  // 刷新验证跨会话持久化
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mk-list .mk-item', { timeout: 15000 });
  const afterReload = await page.$$eval('.mk-picked-tag', (els) => els.length);
  console.log('      刷新后仍保留已选:', afterReload);
  if (afterReload === 0) errors.push('刷新后 localStorage 持久化失效');
  const copyBtn = await page.$eval('.sync-copy-btn', (el) => el.textContent).catch(() => '');
  console.log('      复制清单按钮:', copyBtn.trim());
  if (!copyBtn.includes('复制')) errors.push('复制清单按钮缺失');
  await shot(page, 'e2e-4-pick.png');
  // 返回列表页，验证待同步提示条
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.stock-row', { timeout: 10000 });
  const pendingBanner = await page.evaluate(() => document.body.innerText.includes('已选待同步'));
  console.log('      列表页待同步提示条:', pendingBanner);
  if (!pendingBanner) errors.push('列表页待同步提示条缺失');
  await shot(page, 'e2e-5-pending-banner.png');

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
