/* 线上 privacy.html 真跑取证（v0.29.2 建）
 *
 * 为什么需要它：隐私披露是**有合规红线**的一页 —— 「披露口径」必须与「服务端实际行为」
 * 逐条对齐（v0.28.0 曾出现政策写「store no personal data」而实际已存行程数据的矛盾）。
 * 静态 diff 只能证明「我改了字」，证明不了「线上渲染出来的那一页真的这么说」。
 *
 * 判据（全部来自线上渲染后的 innerText / DOM，不看源码）：
 *   ① 第 4 节存在且标题正确；
 *   ② 行程 7 天删除的表述在；
 *   ③ 订阅 180 天的表述仍在（两句不能互相顶掉）；
 *   ④ 没有任何「不存个人数据」类的绝对化表述（红线）；
 *   ⑤ 零页面错误。
 * 顺带出图存 `_shots/privacy-v0.29.2-live.png` 供肉眼对照。
 *
 * 用法：NODE_PATH=<workbuddy node workspace>/node_modules node _internal/shot_privacy_live.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const errors = [];
  const shots = path.join(__dirname, '_shots');   /* 与 shot_*_live.cjs 同目录；已在 .gitignore */
  fs.mkdirSync(shots, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('https://sinoky.pages.dev/privacy.html?cb=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].map(e => e.textContent.trim());
    const txt = document.body.innerText;
    return {
      title: document.title,
      sections: h2,
      tripSection: h2.find(t => /Notifications and trip/i.test(t)) || null,
      has7day: /7 days after your trip ends/i.test(txt),
      has180: /180 days/i.test(txt),
      absoluteClaim: /stores?\s+no\s+personal\s+data|never\s+saved/i.test(txt),
      lastUpdated: (document.querySelector('.tag') || {}).textContent || null,
      textLen: txt.length
    };
  });

  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
  console.log('\n=== 线上 privacy.html 真跑（v0.29.2）===');
  ok('页面打开且有标题', !!r.title, r.title);
  ok('第 4 节「Notifications and trip reminders」在', !!r.tripSection, JSON.stringify(r.sections));
  ok('行程「结束后 7 天删除」表述已上线', r.has7day);
  ok('订阅「180 天」表述仍在（两句不互顶）', r.has180);
  ok('无「不存个人数据」类绝对化表述（红线）', !r.absoluteClaim);
  ok('零页面错误', errors.length === 0, errors.join(' | '));
  console.log('  ℹ️  Last updated = ' + r.lastUpdated + ' | 正文 ' + r.textLen + ' 字符');

  await page.screenshot({ path: path.join(shots, 'privacy-v0.29.2-live.png'), fullPage: true });
  console.log('  📸 _shots/privacy-v0.29.2-live.png');

  await browser.close();
  console.log('\n' + (fail === 0 ? '✅ privacy 线上取证全绿' : '❌ privacy 线上取证有失败') + ' — ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('❌ 运行异常：', e); process.exit(1); });
