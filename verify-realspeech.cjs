const { chromium } = require('playwright');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  console.log((ok ? '✅ PASS' : '❌ FAIL') + ' ' + n + (extra ? '  ' + extra : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p = await c.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.evaluate(() => { const el = document.querySelector('#home-scenes button'); if (el) el.click(); });
  await p.waitForTimeout(1500);

  // T1 语速按钮初始档位
  const spd0 = await p.evaluate(() => {
    const b = document.querySelector('#sc-list .speed');
    return b ? b.textContent.trim() : null;
  });
  check('T1 语速按钮初始为 Slow', spd0 && /Slow/.test(spd0), '→ ' + spd0);

  // T2 第一次点击 → 4s 后切到 Normal
  await p.evaluate(() => { const b = document.querySelector('#sc-list .speed'); if (b) b.click(); });
  await p.waitForTimeout(4600);
  const spd1 = await p.evaluate(() => {
    const b = document.querySelector('#sc-list .speed');
    return b ? b.textContent.trim() : null;
  });
  check('T2 点击一次后切到 Normal', spd1 && /Normal/.test(spd1), '→ ' + spd1);

  // T3 第二次点击 → 切到 Real
  await p.evaluate(() => { const b = document.querySelector('#sc-list .speed'); if (b) b.click(); });
  await p.waitForTimeout(4600);
  const spd2 = await p.evaluate(() => {
    const b = document.querySelector('#sc-list .speed');
    return b ? b.textContent.trim() : null;
  });
  check('T3 再点击切到 Real（真实语速档）', spd2 && /Real/.test(spd2), '→ ' + spd2);

  // T4 第三次点击 → 回到 Slow（循环）
  await p.evaluate(() => { const b = document.querySelector('#sc-list .speed'); if (b) b.click(); });
  await p.waitForTimeout(4600);
  const spd3 = await p.evaluate(() => {
    const b = document.querySelector('#sc-list .speed');
    return b ? b.textContent.trim() : null;
  });
  check('T4 第三次点击回到 Slow（三档循环）', spd3 && /Slow/.test(spd3), '→ ' + spd3);

  // T5 Real speech 按钮存在
  const toggles = await p.evaluate(() => document.querySelectorAll('.real-toggle').length);
  check('T5 每个句子都有 Real speech 入口', toggles === 4, 'count=' + toggles);

  // T6 默认折叠
  const hidden0 = await p.evaluate(() => {
    const el = document.getElementById('real-0');
    return el ? el.style.display : null;
  });
  check('T6 变体默认折叠', hidden0 === 'none', 'display=' + hidden0);

  // T7 点击展开 → 显示变体
  await p.evaluate(() => { const b = document.querySelector('.real-toggle'); if (b) b.click(); });
  await p.waitForTimeout(600);
  const items = await p.evaluate(() => {
    const list = document.getElementById('real-0');
    return {
      display: list ? list.style.display : null,
      count: list ? list.querySelectorAll('.real-item').length : 0,
      first: list && list.querySelector('.real-item') ? list.querySelector('.real-item').innerText.replace(/\n/g, ' | ') : null,
    };
  });
  check('T7 展开后显示变体', items.display === 'block' && items.count === 2, JSON.stringify(items));

  // T8 变体内容含语体标签
  const styles = await p.evaluate(() => {
    const list = document.getElementById('real-0');
    return Array.from(list.querySelectorAll('.real-style')).map(e => e.textContent.trim());
  });
  check('T8 变体带语体标签', styles.length === 2 && styles.every(s => /casual|polite|formal|slang/.test(s)), JSON.stringify(styles));

  // T9 点击变体能触发播放（TTS 请求）
  let ttsCalled = false;
  p.on('request', r => { if (/api\/tts|dictvoice/i.test(r.url())) ttsCalled = true; });
  await p.evaluate(() => { const it = document.querySelector('#real-0 .real-item'); if (it) it.click(); });
  await p.waitForTimeout(3500);
  check('T9 点击变体触发发音', ttsCalled);

  // T10 布局无横向溢出
  const overflow = await p.evaluate(() => {
    const el = document.querySelector('#sc-list .p-actions');
    return {
      actions: el ? el.scrollWidth - el.clientWidth : -1,
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check('T10 布局无横向溢出', overflow.actions <= 0 && overflow.doc <= 0, JSON.stringify(overflow));

  check('T11 零 JS 错误', errs.filter(e => !/favicon/i.test(e)).length === 0, JSON.stringify(errs.slice(0, 2)));

  console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
