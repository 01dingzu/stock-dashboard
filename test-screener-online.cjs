// 全市场筛选页（ScreenerView）线上验证 —— gh-pages
// 步骤：tabs 渲染 → 默认排序 → 预设套用 → 数值范围 → 行业过滤 → 技术形态 → 清空 → 行点击详情 → 加入/移除
const { chromium } = require('C:/Users/liusiying/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'https://01dingzu.github.io/stock-dashboard/';
const SHOT = 'e2e-screener-online';

const errors = [];
const shots = [];
const notFound = [];
function shot(page, name) {
  shots.push(page.screenshot({ path: `${SHOT}-${name}.png`, fullPage: false }));
}
async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));
  // 404 由 response 事件收集（console 消息不含 URL）；favicon 缺失与 stocks/ 404（预期触发兜底页）属已知
  page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });

  // 1. tabs + 数据加载
  await page.goto(BASE + '#/screener', { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForSelector('.sc-count', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const tabs = await page.$$eval('.mk-tab', (els) => els.map((e) => e.textContent));
  console.log('[1] tabs:', tabs.join(' | '), '| on =', (await page.$eval('.mk-tab.on', (e) => e.textContent)).trim());
  if (tabs.length !== 2 || !tabs[0].includes('Top50') || !tabs[1].includes('筛选')) errors.push('tabs 缺失');
  const total = await page.$eval('.sc-count b', (e) => Number(e.textContent));
  const note = await page.$eval('.note-banner', (e) => e.textContent.slice(0, 30)).catch(() => '');
  console.log('[1] 命中数:', total, '| banner:', note);
  if (!(total > 0)) errors.push('筛选页数据未加载');
  const rowN = await page.$$eval('.mk-item', (els) => els.length);
  console.log('[1] 初始行数:', rowN, '(应=60 分页)');
  if (rowN !== 60) errors.push(`初始分页行数 ${rowN} != 60`);

  // 2. 默认按评分降序
  const scores = await page.$$eval('.mk-item .mk-score', (els) => els.slice(0, 3).map((e) => Number(e.textContent)));
  console.log('[2] 前3 score:', scores);
  if (!(scores[0] >= scores[1] && scores[1] >= scores[2])) errors.push('score 未降序');

  // 3. 预设套用（低估值高股息 = 第一个 preset）
  await page.click('.sc-preset >> nth=0');
  await page.waitForTimeout(800);
  const presetOn = await page.$eval('.sc-preset.on .sp-name', (e) => e.textContent).catch(() => '');
  const cnt1 = await page.$eval('.sc-count b', (e) => Number(e.textContent));
  const sortSel = await page.$eval('.sc-sort select', (e) => e.value);
  console.log('[3] 预设:', presetOn.trim(), '| 命中:', cnt1, '| 排序:', sortSel);
  if (!presetOn.includes('低估值高股息')) errors.push('预设未高亮');
  if (!(cnt1 > 0 && cnt1 < total)) errors.push(`预设命中数 ${cnt1} 异常（0 < x < ${total}）`);
  if (sortSel !== 'div_yield') errors.push('预设未切换股息率排序');
  await shot(page, '3-preset');

  // 4. 数值范围：加 PE max=10（PE 输入框是该字段第 2 个 input = max）
  await page.fill('.sc-num >> nth=0 >> input >> nth=1', '10');
  await page.waitForTimeout(800);
  const cnt2 = await page.$eval('.sc-count b', (e) => Number(e.textContent));
  console.log('[4] PE<=10 后命中:', cnt2, '(应 <', cnt1 + ')');
  if (!(cnt2 >= 0 && cnt2 <= cnt1)) errors.push(`PE 筛选后命中数异常 ${cnt2}`);
  await shot(page, '4-pe10');

  // 5. 清空条件 → 恢复
  await page.click('.sc-clear');
  await page.waitForTimeout(600);
  const cnt3 = await page.$eval('.sc-count b', (e) => Number(e.textContent));
  console.log('[5] 清空后命中:', cnt3, '(应=' + total + ')');
  if (cnt3 !== total) errors.push(`清空后 ${cnt3} != ${total}`);

  // 6. 行业过滤（第二个 .sc-chips 为行业区，点第一个行业 chip）
  const indName = await page.$eval('.sc-chips >> nth=0 >> .sc-chip >> nth=0', (e) => e.textContent.replace(/\s+\d+$/, '').trim());
  await page.click('.sc-chips >> nth=0 >> .sc-chip >> nth=0');
  await page.waitForTimeout(800);
  const cnt4 = await page.$eval('.sc-count b', (e) => Number(e.textContent));
  const inds = await page.$$eval('.mk-item .mk-ind', (els) => els.slice(0, 5).map((e) => e.textContent));
  console.log('[6] 行业', indName, '| 命中:', cnt4, '| 行行业:', inds.join(','));
  if (!(cnt4 > 0 && cnt4 < total)) errors.push(`行业筛选 ${cnt4} 异常`);
  if (inds.some((x) => x !== indName)) errors.push('行业过滤后行行业不一致');
  await shot(page, '6-industry');

  // 7. 技术形态：清空行业后点 MACD 金叉（技术区 = 第三个 .sc-chips，但行业已选 → 先清空）
  await page.click('.sc-clear');
  await page.waitForTimeout(500);
  const techChips = await page.$$('.sc-chips >> nth=1 >> .sc-chip');
  if (techChips.length === 0) errors.push('技术 chips 缺失');
  const disabled = techChips.length ? await techChips[0].isDisabled() : true;
  await page.click('.sc-chips >> nth=1 >> .sc-chip >> nth=0');
  await page.waitForTimeout(800);
  const cnt5 = await page.$eval('.sc-count b', (e) => Number(e.textContent));
  const tkText = await page.$eval('.mk-item .tk', (e) => e.textContent).catch(() => '');
  console.log('[7] 技术 disabled:', disabled, '| MACD金叉命中:', cnt5, '| 行技术tag:', tkText);
  if (disabled) errors.push('技术 chip 被禁用（应有 521 只 tech 数据）');
  if (!(cnt5 > 0 && cnt5 < total)) errors.push(`技术筛选 ${cnt5} 异常`);
  if (!tkText.includes('MACD金叉')) errors.push('行内未渲染 MACD金叉 tag');
  await shot(page, '7-tech');

  // 8. 清空 + 行点击 → 兜底详情
  await page.click('.sc-clear');
  await page.waitForTimeout(600);
  const target = await page.$eval('.mk-item >> nth=2 >> .mk-name', (e) => e.textContent);
  await page.click('.mk-item >> nth=2');
  await page.waitForSelector('.mk-hero, .commentary, .chart', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const hash = await page.evaluate(() => location.hash);
  const hero = await page.$('.mk-hero').then((x) => !!x).catch(() => false);
  const deepChart = await page.$('.chart').then((x) => !!x).catch(() => false);
  console.log('[8] 点击', target.trim().slice(0, 18), '→', hash, '| 兜底页:', hero, '| 深度页:', deepChart);
  if (!hash.includes('#/stock/')) errors.push('未跳详情');
  if (!hero && !deepChart) errors.push('详情未渲染（既无兜底也无深度）');
  await shot(page, '8-detail');

  // 9. 返回筛选页 + 加入按钮 toggle
  await page.evaluate(() => { location.hash = '#/screener'; });
  await page.waitForSelector('.sc-count', { timeout: 15000 });
  await page.waitForTimeout(800);
  const btn = page.locator('.mk-item >> nth=0 >> .mk-add-btn');
  const before = (await btn.textContent()).trim();
  await btn.click();
  await page.waitForTimeout(500);
  const after = (await btn.textContent()).trim();
  console.log('[9] 加入按钮:', before, '→', after);
  if (before.includes('加入') && !after.includes('已加入')) errors.push('加入失败');
  // 还原
  if (after.includes('已加入')) { await btn.click(); await page.waitForTimeout(400); }
  await shot(page, '9-add');

  await Promise.all(shots).catch(() => {});
  await browser.close();
  const real404 = notFound.filter((u) => !u.includes('favicon') && !u.includes('/stocks/'));
  if (real404.length) errors.push('非预期 404: ' + real404.join(', '));
  console.log('\n==== RESULT ====');
  console.log(errors.length === 0 ? 'ALL PASS ✅' : `FAIL ${errors.length}\n- ${errors.join('\n- ')}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
