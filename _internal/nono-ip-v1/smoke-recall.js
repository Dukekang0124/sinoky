/* ============================================================================
   v0.23.4 —— 「诺诺记得你」浏览器真跑验收
   ----------------------------------------------------------------------------
   康哥铁律：语法校验 / grep / diff 只证明「看起来对」，不算验收。
   本脚本验证的是**行为**：
     · S.nono 里存着的 last/weak/best 真的会被说出来（不是只有一个函数名）
     · 三条文案分支（召回 / 超越 / 再来）真的可达，且数字真的被替换进去
     · 「练这一句」真的把用户带回那句（NONO_LINE 变成它），形成闭环
     · 每天只一次（第二次调用不再消耗）、今天刚练过不说、超 60 天当新用户
     · 易错句优先于最近句（weak 计数最高者胜出）
     · 冷启动（打开 App 停在首页、不经过 go()）也能说出来
     · 全程零 JS 运行时错误、零横向溢出

   跑法：NODE_PATH=... node smoke-recall.js
   ============================================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const PORT = 8103;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      const f = path.join(APP, u);
      fs.readFile(f, (e, buf) => {
        if (e) { rsp.writeHead(404); return rsp.end('404'); }
        const ext = path.extname(f).toLowerCase();
        rsp.writeHead(200, { 'Content-Type': u === '/index.html' ? 'text/html; charset=utf-8' : (MIME[ext] || 'application/octet-stream') });
        rsp.end(buf);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

/* UTC 日期偏移（与 S.nono.last.at 的写入口径一致：toISOString().slice(0,10)） */
const iso = (off) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  /* locale 锁英文：T() 按 navigator.language 取语言包；本机是 zh，
     不锁的话 T('Practice that line') 返回「练这一句」，按英文源文写的断言会误报。 */
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
    return route.abort();
  });

  const page = await ctx.newPage();
  const R = [];
  const chk = (n, c, e) => R.push([c ? 'PASS' : 'FAIL', n, e === undefined ? '' : String(e)]);
  const errors = [];
  page.on('pageerror', (e) => errors.push('' + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  /* 只把 onboarded 置真 + 清诺诺相关标记。
     不能 localStorage.clear()：清掉 sinoky_state 会触发首启引导层（#v-onboard 全屏），
     把浮标与面板整个挡住（v0.23.0 那轮踩过）。 */
  await page.evaluate(() => {
    try {
      const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
      s.onboarded = true;
      localStorage.setItem('sinoky_state', JSON.stringify(s));
    } catch (e) {}
    ['sinoky_tour', 'sinoky_nono_tour', 'sinoky_nono_invite', 'sinoky_nono_recall',
     'sinoky_nono_daily', 'sinoky_nono_day', 'sinoky_nono'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const stripOnboard = () => page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) { o.classList.remove('on'); o.style.display = 'none'; }
    if (typeof window.go === 'function') window.go('home');
    return true;
  });
  await stripOnboard();
  await page.waitForTimeout(500);
  await stripOnboard();     /* 再摘一次：覆盖 app 迟到的初始化（这个 flaky 出现过两次） */

  /* ---------------- A. 注入层就位 ---------------- */
  const base = await page.evaluate(() => ({
    recall: typeof window.nonoRecall,
    daily: typeof window.nonoDailyLine,
    show: typeof window.nonoShow,
    pk: typeof window.nonoPracticeKey,
    view: (typeof window.nonoView === 'function') ? window.nonoView() : '(none)',
    hasMarker: (document.documentElement.innerHTML.indexOf('nonoRecall') > -1),
    src: (function () { const e = document.getElementById('nono-pose'); return e ? (e.getAttribute('src') || '') : ''; })(),
  }));
  chk('注入层暴露 window.nonoRecall', base.recall === 'function', base.recall);
  chk('nonoDailyLine 仍在（被包装而非替换）', base.daily === 'function', base.daily);
  chk('依赖的 nonoShow / nonoPracticeKey 均在', base.show === 'function' && base.pk === 'function',
      `${base.show}/${base.pk}`);
  chk('当前视图是 home（后续断言的语境前提）', base.view === 'home', base.view);
  chk('注入块里含 §11 标记', base.hasMarker, '');

  /* 取一个真实存在的句 key（SCENES 第一条的第 0 句）—— 用假 key 测不出「真的能跳回去」 */
  const keys = await page.evaluate(() => {
    const sc = (window.SCENES || [])[0];
    const sc2 = (window.SCENES || [])[1];
    return {
      k1: sc ? sc.id + '#0' : null,
      hz1: sc && sc.phrases && sc.phrases[0] ? sc.phrases[0].hz : '',
      k2: sc2 ? sc2.id + '#0' : null,
    };
  });
  chk('取到真实句 key（两项）', !!keys.k1 && !!keys.k2, `${keys.k1} / ${keys.k2}`);

  /* ---------------- 场景脚手架 ---------------- */
  const setup = async (sn, extra = {}) => page.evaluate(({ sn, extra }) => {
    ['sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day'].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    try { localStorage.removeItem('sinoky_nono'); } catch (e) {}
    try { localStorage.setItem('sinoky_tour', '1'); } catch (e) {}
    if (sn === null) { try { S.nono = undefined; } catch (e) {} }
    else { S.nono = JSON.parse(JSON.stringify(sn)); }
    S.feat = S.feat || {}; delete S.feat.nonoRecall;
    NONO.closed = false; NONO.lockUntil = 0;
    const p = document.getElementById('nono-panel'); if (p) p.style.display = 'none';
    const m = document.getElementById('nono-msg'); if (m) m.innerHTML = '';
    const a = document.getElementById('nono-acts'); if (a) a.innerHTML = '';
    if (extra.set) { Object.keys(extra.set).forEach((k) => localStorage.setItem(k, extra.set[k])); }
    return true;
  }, { sn, extra });

  const fire = () => page.evaluate(() => { try { window.nonoDailyLine(); } catch (e) { return 'THROW ' + e.message; } return 'ok'; });

  const snap = () => page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    const m = document.getElementById('nono-msg');
    const a = document.getElementById('nono-acts');
    return {
      open: !!(p && p.style.display === 'block'),
      msg: m ? m.innerHTML : '',
      txt: m ? m.textContent.replace(/\s+/g, ' ').trim() : '',
      acts: a ? a.innerHTML : '',
      btnTxt: a ? Array.from(a.querySelectorAll('button')).map((b) => b.textContent.trim()).join('|') : '',
      feat: (S.feat || {}).nonoRecall || 0,
      mark: localStorage.getItem('sinoky_nono_recall') || '',
      daily: localStorage.getItem('sinoky_nono_daily') || '',
    };
  });

  /* ---------------- P1 召回分支（gap=3） ---------------- */
  await setup({ n: 5, best: 78, last: { key: keys.k1, score: 78, at: iso(-3) }, weak: {} });
  await fire();
  let s = await snap();
  chk('P1 面板被打开（真的说出来了）', s.open, '');
  chk('P1 文案是「召回」分支且天数已替换', /3 days ago/.test(s.txt), s.txt.slice(0, 90));
  chk('P1 带「练这一句」+「Later」两个动作', /Practice that line/.test(s.btnTxt) && /Later/.test(s.btnTxt), s.btnTxt);
  chk('P1 埋点 S.feat.nonoRecall = 1', s.feat === 1, String(s.feat));
  chk('P1 写了「今天已说」标记', s.mark === iso(0), s.mark);
  chk('P1 同时写了每日句标记（防原函数当天再给一条）', /"day":/.test(s.daily), s.daily.slice(0, 60));

  /* ---------------- P2 每天只一次 ---------------- */
  await fire();
  const s2 = await snap();
  chk('P2 第二次调用不再消耗（feat 仍为 1）', s2.feat === 1, String(s2.feat));

  /* ---------------- P3 今天刚练过（gap=0）不打扰 ---------------- */
  await setup({ n: 5, best: 78, last: { key: keys.k1, score: 78, at: iso(0) }, weak: {} });
  await fire();
  const s3 = await snap();
  chk('P3 gap=0 不触发', s3.feat === 0, String(s3.feat));

  /* ---------------- P4 易错句优先（weak 计数最高者胜出） ---------------- */
  await setup({ n: 9, best: 88, last: { key: keys.k1, score: 88, at: iso(-2) }, weak: { [keys.k2]: 4 } });
  await fire();
  const s4 = await snap();
  chk('P4 走「卡句」分支且次数已替换', /4 times/.test(s4.txt), s4.txt.slice(0, 90));
  chk('P4 动作指向的是卡住的那句（不是最近那句）', s4.acts.indexOf(keys.k2) > -1 && s4.acts.indexOf(keys.k1) < 0,
      `${keys.k2} / ${keys.k1}`);

  /* ---------------- P5 超 60 天当新用户 ---------------- */
  await setup({ n: 5, best: 78, last: { key: keys.k1, score: 78, at: iso(-61) }, weak: {} });
  await fire();
  const s5 = await snap();
  chk('P5 gap=61 不触发', s5.feat === 0, String(s5.feat));

  /* ---------------- P6 从没判过分（无 S.nono）不触发 ---------------- */
  await setup(null);
  await fire();
  const s6 = await snap();
  chk('P6 无 S.nono 不触发', s6.feat === 0, String(s6.feat));

  /* ---------------- P7/P8 另两条分支可达 ---------------- */
  await setup({ n: 5, best: 55, last: { key: keys.k1, score: 55, at: iso(-1) }, weak: {} });
  await fire();
  const s7 = await snap();
  chk('P7 gap=1 + 低分 → 「再来一次」分支，分数已替换', /55/.test(s7.txt) && /One more try/.test(s7.txt), s7.txt.slice(0, 90));

  await setup({ n: 5, best: 88, last: { key: keys.k1, score: 88, at: iso(-1) }, weak: {} });
  await fire();
  const s8 = await snap();
  chk('P8 gap=1 + 高分 → 「超越它」分支', /88/.test(s8.txt) && /Beat it today/.test(s8.txt), s8.txt.slice(0, 90));

  /* ---------------- P9 点「练这一句」真的回到那句 ---------------- */
  await setup({ n: 5, best: 78, last: { key: keys.k1, score: 78, at: iso(-3) }, weak: {} });
  await fire();
  const clicked = await page.evaluate(() => {
    const a = document.getElementById('nono-acts');
    if (!a) return false;
    const b = Array.from(a.querySelectorAll('button')).find((x) => /Practice that line/.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  });
  chk('P9 找到并点击了「练这一句」', clicked, '');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    line: (window.NONO_LINE && window.NONO_LINE.key) || '',
    practice: (document.getElementById('nono-practice') || {}).innerHTML || '',
    panel: (document.getElementById('nono-panel') || {}).style.display || '',
  }));
  chk('P9 闭环成立：NONO_LINE 变成那句', after.line === keys.k1, `NONO_LINE=${after.line}（期望 ${keys.k1}）`);
  chk('P9 练习区渲染出该句汉字', !!keys.hz1 && after.practice.indexOf(keys.hz1) > -1, keys.hz1);
  chk('P9 面板保持打开', after.panel === 'block', after.panel);

  /* ---------------- P10 冷启动（打开 App 停在首页，不经过 go()） ----------------
     加一层「消息变更历史」取证：光看最终文本分不清「recall 没触发」和
     「触发了但被后续调用覆盖」——这两者结论完全不同。 */
  await page.addInitScript(() => {
    window.__msgLog = [];
    window.__rcLog = [];
    const arm = () => {
      const m = document.getElementById('nono-msg');
      if (!m) return false;
      try {
        new MutationObserver(() => {
          window.__msgLog.push((m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70));
        }).observe(m, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
      return true;
    };
    if (!arm()) { const t = setInterval(() => { if (arm()) clearInterval(t); }, 20); }
    /* 记录每一次 nonoRecall() 的调用与前置条件 —— 光看最终文本分不清
       「没被调用」「被调用但前置条件不满足」「被后续调用覆盖」，而这三者结论完全不同。 */
    const armRc = () => {
      if (typeof window.nonoRecall !== 'function') return false;
      const orig = window.nonoRecall;
      window.nonoRecall = function () {
        const st = {
          ms: Date.now(),
          view: (typeof window.nonoView === 'function') ? window.nonoView() : '?',
          n: (window.S && window.S.nono) ? window.S.nono.n : null,
          closed: (window.NONO || {}).closed,
          lock: (window.NONO || {}).lockUntil || 0,
          tour: localStorage.getItem('sinoky_tour'),
          mark: localStorage.getItem('sinoky_nono_recall'),
        };
        let r = null;
        try { r = orig.apply(this, arguments); } catch (e) { r = 'THROW ' + e.message; }
        st.ret = r;
        window.__rcLog.push(st);
        return r;
      };
      return true;
    };
    if (!armRc()) { const t2 = setInterval(() => { if (armRc()) clearInterval(t2); }, 10); }
  });
  await page.evaluate(({ sn }) => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.onboarded = true; s.nono = sn;
    s.feat = s.feat || {}; delete s.feat.nonoRecall;     /* 清掉前几场的残留计数，让 feat 成为纯净证据 */
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    localStorage.setItem('sinoky_tour', '1');
    ['sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day', 'sinoky_nono'].forEach((k) => localStorage.removeItem(k));
  }, { sn: { n: 5, best: 78, last: { key: keys.k1, score: 78, at: iso(-4) }, weak: {} } });
  await page.reload({ waitUntil: 'load' });
  /* 诊断：reload 后 boot 早期，前置条件到底哪一条不满足 */
  const pre = await page.evaluate(() => ({
    hasS: typeof S,
    n: (S && S.nono) ? S.nono.n : null,
    lastAt: (S && S.nono && S.nono.last) ? S.nono.last.at : null,
    stateHasNono: (function () { try { return !!JSON.parse(localStorage.getItem('sinoky_state') || '{}').nono; } catch (e) { return 'ERR'; } })(),
    view: window.nonoView ? window.nonoView() : null,
    closed: (window.NONO || {}).closed,
    lock: (window.NONO || {}).lockUntil,
    busy: typeof window.nonoBusy === 'function' ? window.nonoBusy() : null,
    tour: localStorage.getItem('sinoky_tour'),
    mark: localStorage.getItem('sinoky_nono_recall'),
    recallFn: typeof window.nonoRecall,
  }));
  console.log('  [诊断·reload 后早期]', JSON.stringify(pre));
  await page.waitForTimeout(3600);            /* bootRecall 在 load 后 2400ms 触发 */
  const s10 = await page.evaluate(() => {
    const m = document.getElementById('nono-msg');
    const p = document.getElementById('nono-panel');
    return {
      view: (typeof window.nonoView === 'function') ? window.nonoView() : '(none)',
      open: !!(p && p.style.display === 'block'),
      txt: m ? m.textContent.replace(/\s+/g, ' ').trim() : '',
      feat: (S.feat || {}).nonoRecall || 0,
      mark: localStorage.getItem('sinoky_nono_recall') || '',
      day: localStorage.getItem('sinoky_nono_day') || '',
      daily: localStorage.getItem('sinoky_nono_daily') || '',
      log: (window.__msgLog || []).slice(-4),
      rcLog: (window.__rcLog || []),
    };
  });
  chk('P10 冷启动：默认停在 home', s10.view === 'home', s10.view);
  console.log("  [诊断·nonoRecall 调用日志]", JSON.stringify(s10.rcLog));
  chk("P10 一句话真的被说出来过（消息历史里出现过）",
      /days ago/.test(s10.log.join(' || ')), s10.log.join(' || '));
  chk('P10 最终停在记得你（未被今日句覆盖）', /4 days ago/.test(s10.txt),
      `${s10.txt.slice(0, 70)} | mark=${s10.mark} day=${s10.day} daily=${s10.daily} feat=${s10.feat}`);

  /* ---------------- Z. 收口 ---------------- */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk('零横向溢出', overflow <= 0, `overflow=${overflow}`);
  chk('零 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();

  const pass = R.filter((r) => r[0] === 'PASS').length;
  const fail = R.filter((r) => r[0] === 'FAIL');
  console.log('\n=== 「诺诺记得你」浏览器真跑验收 ===');
  R.forEach((r) => console.log(`  ${r[0] === 'PASS' ? '✓' : '✗'} ${r[1]}${r[2] ? '   [' + r[2] + ']' : ''}`));
  console.log(`\n通过 ${pass} 项，失败 ${fail.length} 项`);
  if (fail.length) { console.log('\n失败明细：'); fail.forEach((r) => console.log(`  ✗ ${r[1]}   [${r[2]}]`)); }
  process.exit(fail.length ? 1 : 0);
}
