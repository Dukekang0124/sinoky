/* Sinoky 正主验收脚本 —— Flashcards 视图 (v0.2.0)
   用法（playwright 在受管 workspace，需 NODE_PATH）：
     NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" node verify-cards.cjs
   前置：本地静态服务已起（python -m http.server 8125） */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8125';
const PASS = [], FAIL = [];
function check(name, ok, detail) { (ok ? PASS : FAIL).push(name + (detail ? ' | ' + detail : '')); }
const HAS_CN = /[一-鿿]/;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // T1 版本号
  const ver = await page.evaluate(() => window.APP_VERSION);
  check('T1 APP_VERSION = 0.2.0', ver === '0.2.0', 'got ' + ver);

  // T2 底部导航出现 Cards（英文）
  const navCards = await page.textContent('#nav-cards').catch(() => '');
  check('T2 nav has "Cards"', /Cards/.test(navCards || ''), (navCards || '').trim());

  // T3 进入字卡视图并加载 193 张
  await page.click('#nav-cards');
  await page.waitForTimeout(1200);
  const prog = await page.textContent('#fc-prog');
  check('T3 deck loaded (193 cards)', /\/ 193/.test(prog || ''), (prog || '').trim());

  // T4 卡片汉字渲染
  const hz = await page.textContent('.fc-hz').catch(() => '');
  check('T4 card character rendered', !!(hz || '').trim(), hz);

  // T5 拼音默认遮挡（先遮后猜）
  const pyHidden = await page.evaluate(() => {
    const el = document.querySelector('.fc-py');
    return el ? el.classList.contains('hidden') : null;
  });
  check('T5 pinyin blurred by default', pyHidden === true, 'hidden=' + pyHidden);

  // T6 Reveal 后拼音与释义同时出现
  await page.click('#fc-wrap button:text-is("Reveal")');
  await page.waitForTimeout(400);
  const rev = await page.evaluate(() => {
    const py = document.querySelector('.fc-py');
    const back = document.querySelector('.fc-back');
    return { py: py ? !py.classList.contains('hidden') : null, back: back ? back.classList.contains('on') : null };
  });
  check('T6 reveal shows pinyin + gloss', rev.py === true && rev.back === true, JSON.stringify(rev));

  // T7 释义是英文（核心目的：服务外国人）
  const mean = await page.textContent('.fc-mean').catch(() => '');
  check('T7 meaning is English', !!mean && !HAS_CN.test(mean), mean);

  // T8 翻页
  const hz1 = await page.textContent('.fc-hz');
  await page.click('#fc-wrap button:text-is("Next →")');
  await page.waitForTimeout(400);
  const hz2 = await page.textContent('.fc-hz');
  check('T8 next card advances', hz1 !== hz2, hz1 + ' -> ' + hz2);

  // T9 收藏进生词本
  await page.click('#fc-wrap button:text-is("☆ Save")');
  await page.waitForTimeout(400);
  const savedTxt = await page.textContent('#fc-saved');
  check('T9 save to wordbook', /1 saved/.test(savedTxt || ''), (savedTxt || '').trim());

  // T10 生词本列表出现条目
  const nwCount = await page.textContent('#nw-count');
  const nwItems = await page.evaluate(() => document.querySelectorAll('.nw-item').length);
  check('T10 wordbook lists the item', nwCount === '1' && nwItems === 1, 'badge=' + nwCount + ' items=' + nwItems);

  // T11 生词本释义为英文（汉字本身除外）
  const nwMn = await page.textContent('.nw-item .mn').catch(() => '');
  check('T11 wordbook gloss is English', !!nwMn && !HAS_CN.test(nwMn), (nwMn || '').trim());

  // T12 从生词本移除
  await page.click('.nw-item .mini >> nth=1');
  await page.waitForTimeout(400);
  const nwAfter = await page.textContent('#nw-count');
  check('T12 remove from wordbook', nwAfter === '0', 'badge=' + nwAfter);

  // T13 390px 无横向溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('T13 no horizontal overflow @390px', overflow <= 0, 'overflow=' + overflow);

  // T14 界面无中文 UI 残留（学习用汉字允许）
  const uiCn = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return (t.match(/评分|识别失败|麦克风|请允许|无法启动|连接失败|生词|字卡|阅读|连句/g) || []);
  });
  check('T14 no Chinese UI strings', uiCn.length === 0, uiCn.join(','));

  // T15 零 JS 报错
  check('T15 zero JS errors', errors.length === 0, errors.slice(0, 3).join(' ; '));

  console.log('\n===== PASS (' + PASS.length + ') =====');
  PASS.forEach(p => console.log('  PASS  ' + p));
  if (FAIL.length) {
    console.log('\n===== FAIL (' + FAIL.length + ') =====');
    FAIL.forEach(f => console.log('  FAIL  ' + f));
  }
  console.log('\n结果: ' + PASS.length + '/' + (PASS.length + FAIL.length));
  await browser.close();
  process.exit(FAIL.length ? 1 : 0);
})();
