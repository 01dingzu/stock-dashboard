// 全市场低估清单 + 自选池管理 + 六因子指标 E2E（系统 Chrome + playwright-core，SW 屏蔽）
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
      if (t.includes('404') || t.includes('Failed to load resource')) return; // 忽略预期 404
      errors.push(t);
    }
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => console.log('REQFAIL', r.url(), r.failure()?.errorText));

  // 1. 列表页：默认池 20 只 + 移除按钮
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  const row0 = await page.$$eval('.stock-row', (els) => els.length);
  const removeBtns = await page.$$eval('.row-remove', (els) => els.length);
  console.log('[1] 列表行数=' + row0 + ', 移除按钮=' + removeBtns);
  if (row0 < 10) errors.push('默认池行数异常: ' + row0);
  if (removeBtns < 10) errors.push('移除按钮缺失');
  await shot(page, 'e2e-1-list.png');

  // 2. 移除第一只（贵州茅台）→ 持久化验证
  await page.click('.stock-row .row-remove >> nth=0');
  await page.waitForTimeout(800);
  const row1 = await page.$$eval('.stock-row', (els) => els.length);
  console.log('[2] 移除后行数=' + row1);
  if (row1 !== row0 - 1) errors.push('移除未生效: ' + row0 + ' -> ' + row1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  const row2 = await page.$$eval('.stock-row', (els) => els.length);
  const firstRowName = await page.$eval('.stock-row .name', (el) => el.textContent).catch(() => '');
  console.log('[2b] 刷新后行数=' + row2 + ', 首行=' + firstRowName.trim().slice(0, 12));
  if (row2 !== row0 - 1) errors.push('移除未持久化: 刷新后 ' + row2);
  if (firstRowName.includes('中国平安')) errors.push('被移除的中国平安仍显示');

  // 3. 市场页：新六因子指标展示
  await page.evaluate(() => { location.hash = '#/market'; });
  await page.waitForSelector('.mk-list .mk-item', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const mkCount = await page.$$eval('.mk-item', (els) => els.length);
  const meta2Text = await page.$eval('.mk-meta2', (el) => el.textContent).catch(() => '');
  const hasDiv = meta2Text.includes('息');
  const hasCap = meta2Text.includes('市值');
  const hasDebt = meta2Text.includes('负债');
  const hasYoy = meta2Text.includes('净利');
  const noteHasSix = await page.evaluate(() => document.body.innerText.includes('六因子'));
  console.log('[3] items=' + mkCount + ', meta2="' + meta2Text.slice(0, 80) + '"');
  console.log('    六因子banner=' + noteHasSix + ' 息=' + hasDiv + ' 市值=' + hasCap + ' 负债=' + hasDebt + ' 净利=' + hasYoy);
  if (mkCount < 20) errors.push('市场清单条数异常: ' + mkCount);
  if (!(hasDiv && hasCap && hasDebt && hasYoy)) errors.push('新指标展示缺失');
  if (!noteHasSix) errors.push('六因子口径说明缺失');
  await shot(page, 'e2e-2-market.png');

  // 4. 加入自选池 toggle
  const addBtn = page.locator('.mk-add-btn:not(.added)').first();
  if (await addBtn.count()) {
    const codeBefore = await page.$eval('.mk-item.not-added .mk-code', (el) => el.textContent);
    await addBtn.click();
    await page.waitForTimeout(800);
    const addedCount = await page.$$eval('.mk-item.added .mk-add-btn.added', (els) => els.length);
    const syncVisible = await page.evaluate(() => document.body.innerText.includes('待同步'));
    console.log('[4] 加入后 added=' + addedCount + ', 待同步banner=' + syncVisible + ' (code=' + codeBefore + ')');
    if (addedCount < 1) errors.push('加入按钮未生效');
    // 再点一次取消加入
    await page.locator('.mk-add-btn.added').first().click();
    await page.waitForTimeout(800);
    const addedAfter = await page.$$eval('.mk-item.added', (els) => els.length);
    console.log('    再点取消后 added=' + addedAfter);
    if (addedAfter === 0) errors.push('应保留 watchlist 默认池成员（招商银行等）未变，不应全清空');
    if (addedAfter >= addedCount) errors.push('取消加入未生效（数量未减少）');
  } else {
    console.log('[4] 无未加入条目可测（全部已加入）');
  }

  // 5. 详情页综合说明回归（中国平安）
  await page.evaluate(() => { location.hash = '#/stock/sh.601318'; });
  await page.waitForSelector('.chart canvas, .chart', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const commentary = await page.$eval('.commentary', (el) => el.textContent.slice(0, 200)).catch(() => null);
  console.log('[4] 详情页综合说明:', commentary ? '可见' : '缺失');
  if (!commentary) errors.push('commentary block missing');
  await shot(page, 'e2e-3-detail.png');

  // 5b. 市场版兜底详情（点击未加入行 → 市场版评分+解释）
  await page.evaluate(() => { location.hash = '#/market'; });
  await page.waitForSelector('.mk-list .mk-item', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const noBtn = page.locator('.mk-item.not-added').first();
  if (await noBtn.count()) {
    const tCode = await noBtn.locator('.mk-code').textContent();
    await noBtn.click();
    await page.waitForSelector('.mk-hero', { timeout: 20000 });
    await page.waitForTimeout(800);
    const heroOk = await page.$eval('.mk-hero', (el) => /#/.test(el.textContent) && /评分/.test(el.textContent));
    const commentOk = await page.$eval('.commentary', (el) => (el.textContent || '').length > 10).catch(() => false);
    const addBtnOk = !!(await page.$('.fallback-add'));
    const hasAddBtn = !!addBtnOk;
    console.log('[5b] 兜底详情 code=' + tCode + ' hero=' + heroOk + ' comment=' + commentOk + ' addBtn=' + hasAddBtn);
    if (!heroOk) errors.push('市场版兜底 hero 缺失');
    if (!commentOk) errors.push('市场版兜底 commentary 缺失');
    if (!addBtnOk) errors.push('市场版兜底加入按钮缺失');
    await shot(page, 'e2e-5-fallback.png');
    // 返回市场页（为步骤 6 做准备）
    await page.evaluate(() => { location.hash = '#/market'; });
    await page.waitForSelector('.mk-list .mk-item', { timeout: 20000 });
  } else {
    console.log('[5b] 无未加入条目可测兜底详情');
  }

  // 6. 友好错误（访问不存在股）
  await page.evaluate(() => { location.hash = '#/stock/sh.999999'; });
  await page.waitForTimeout(3000);
  const errorText = await page.$eval('.error', (el) => el.textContent).catch(() => '');
  console.log('[6] 错误信息:', errorText ? errorText.replace(/\s+/g, ' ').slice(0, 100) : '无');
  // 兼容新旧文案：全市场兜底上线后，"尚未生成"也会保留路径
  if (!errorText.includes('未找到') && !errorText.includes('尚未生成') && !errorText.includes('扫描范围')) errors.push('友好错误信息缺失');

  if (errors.length) {
    console.log('--- ERRORS ---');
    errors.forEach((e) => console.log('  ', e.slice(0, 200)));
  } else {
    console.log('console errors: NONE');
  }
  await browser.close();
  console.log(errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
