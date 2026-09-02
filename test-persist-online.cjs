// 自选池持久化复现：全新会话 → 默认导入 → 加入自选 → 刷新 → 删除 → 刷新
// 验证 localWatch(localStorage) 在刷新后是否保留用户的增删
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'https://01dingzu.github.io/stock-dashboard/';
const errors = [];
const KEY = 'watchlist_local_v1';

async function getLocal(page) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : JSON.parse(raw);
  }, KEY);
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

  // 1. 全新会话打开首页 → 应触发默认池导入
  await page.goto(BASE + '?t=' + Date.now(), { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  let ls = await getLocal(page);
  console.log('[1] fresh 首页后 localStorage 条数:', ls ? ls.length : null, '| 期望 20（默认池导入）');
  if (!ls || ls.length !== 20) errors.push('首次导入应为 20, 实际 ' + (ls && ls.length));
  const initialRows = await page.$$eval('.stock-row', (els) => els.length);
  console.log('[1] 列表行数:', initialRows);

  // 2. 全市场筛选页点"＋ 加入"一只（默认 Top60 全是低估池成员=默认池，需翻页到非默认股）
  await page.goto(BASE + '?t=' + Date.now() + '#/screener', { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForSelector('.mk-add-btn', { timeout: 20000 });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) {
    const hasUnadded = await page.evaluate(() => !!document.querySelector('.mk-add-btn:not(.added)'));
    if (hasUnadded) break;
    const moreBtn = await page.$('.sc-more');
    if (!moreBtn) { console.log('[2] 无更多按钮，当前列表全部已加入'); break; }
    await moreBtn.click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector('.mk-add-btn:not(.added)', { timeout: 10000 });
  const addName = await page.evaluate(() => {
    const btn = document.querySelector('.mk-add-btn:not(.added)');
    if (!btn) return null;
    const item = btn.closest('.mk-item');
    return item ? item.querySelector('.mk-name').childNodes[0].textContent.trim() : null;
  });
  await page.click('.mk-add-btn:not(.added)');
  await page.waitForTimeout(800);
  ls = await getLocal(page);
  console.log('[2] 加入「' + addName + '」后 localStorage 条数:', ls ? ls.length : null, '| 期望 21');
  if (!ls || ls.length !== 21) errors.push('加入后应为 21, 实际 ' + (ls && ls.length));
  const addedCode = ls ? ls[ls.length - 1].code : null;
  const addedName = ls ? ls[ls.length - 1].name : null;
  console.log('[2] 新增条目:', addedCode, addedName);

  // 3. 刷新（重新加载首页）→ 加入的应还在
  await page.goto(BASE + '?t=' + Date.now(), { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  ls = await getLocal(page);
  const stillHas = ls ? ls.some((i) => i.code === addedCode) : false;
  console.log('[3] 刷新后条数:', ls ? ls.length : null, '| 加入的', addedCode, '仍在?', stillHas, '| 期望 21 / true');
  if (!ls || ls.length !== 21 || !stillHas) errors.push('刷新后加入项丢失!');
  const body3 = await page.evaluate(() => document.body.innerText.includes('待同步') ? '含待同步横幅' : '无待同步横幅');
  console.log('[3] 列表状态:', body3);

  // 4. 首页删一只默认池股（点第一行 ×）
  const rmName = await page.evaluate(() => {
    const row = document.querySelector('.stock-row .row-remove');
    if (!row) return null;
    return (row.closest('.stock-row').innerText || '').split('\n')[0] || '(行首文本)';
  });
  await page.click('.stock-row .row-remove');
  await page.waitForTimeout(800);
  ls = await getLocal(page);
  console.log('[4] 删除「' + rmName + '」后条数:', ls ? ls.length : null, '| 期望 20');

  // 5. 再刷新 → 删除应保留
  await page.goto(BASE + '?t=' + Date.now(), { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForSelector('.stock-row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  ls = await getLocal(page);
  const rows5 = await page.$$eval('.stock-row', (els) => els.length);
  console.log('[5] 再刷新后条数:', ls ? ls.length : null, '行数:', rows5, '| 期望 20');
  if (!ls || ls.length !== 20) errors.push('删除未持久化');

  console.log('\n================ RESULT ================');
  if (errors.length) { console.log('FAIL ' + errors.length + ':'); errors.forEach((e) => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('ALL PASS — 线上持久化正常，加入/删除刷新后均保留');
  await browser.close();
}

main().catch((e) => { console.error('SCRIPT ERR', e); process.exit(1); });
