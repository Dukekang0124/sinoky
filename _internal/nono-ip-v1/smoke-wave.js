/* ============================================================================
   v0.23.5 —— 「首访招手邀请」浏览器真跑验收
   ----------------------------------------------------------------------------
   康哥铁律：语法校验 / grep / diff 只证明「看起来对」，不算验收。
   本脚本验证的是**行为**（不是「函数名存在」）：
     · 首访（零开口）时，诺诺说出口的是「你好！(nǐ hǎo) + Say it back to me」
       而不是老的「Hi, I'm Nono 🐼 …」（后者是自我介绍，换不来开口）
     · 姿态真的是 wave（招手），按钮真的能把用户带进「你好」的跟读
     · 已开口的用户**不**被打扰（A/B 对比：唯一变量是 S.phrases）
     · 首启引导卡没过时不抢；引导卡一点掉、窗口内就能补上（跨时刻的重试）
     · 与 §8「导览邀请」的位阶真的成立：零开口先收招手邀请、导览让位；
       已开口则反过来（导览邀请照出）—— 两个邀请都在 home、都在 boot 后 8 秒
     · 每天最多一次
     · 冷启动（打开 App 停在首页、不经过 go()）也真的会说出来
     · 全程零 JS 运行时错误、零横向溢出

   跑法：NODE_PATH=... node smoke-wave.js
   ============================================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const PORT = 8104;

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

const today = () => new Date().toISOString().slice(0, 10);

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  /* locale 锁英文：T() 按 navigator.language 取语言包；本机是 zh，
     不锁的话 T('Say it back to me.') 返回「说给我听。」，按英文源文写的断言会误报。 */
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
    ['sinoky_tour', 'sinoky_nono_tour', 'sinoky_nono_invite', 'sinoky_nono_wave',
     'sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day', 'sinoky_nono'].forEach((k) => localStorage.removeItem(k));
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
    wave: typeof window.nonoWave,
    cg: typeof window.nonoContextGreet,
    show: typeof window.nonoShow,
    pk: typeof window.nonoPracticeKey,
    endTour: typeof window.endTour,
    view: (typeof window.nonoView === 'function') ? window.nonoView() : '(none)',
    hasMarker: (document.documentElement.innerHTML.indexOf('首访招手邀请') > -1),
    hasRank: (document.documentElement.innerHTML.indexOf('v0.23.5 位阶') > -1),
  }));
  chk('注入层暴露 window.nonoWave', base.wave === 'function', base.wave);
  chk('nonoContextGreet 仍在（被包装而非替换）', base.cg === 'function', base.cg);
  chk('依赖的 nonoShow / nonoPracticeKey / endTour 均在',
      base.show === 'function' && base.pk === 'function' && base.endTour === 'function',
      `${base.show}/${base.pk}/${base.endTour}`);
  chk('当前视图是 home（后续断言的语境前提）', base.view === 'home', base.view);
  chk('注入块里含 §12 标记', base.hasMarker, '');
  chk('注入块里含 §8 位阶条件', base.hasRank, '');

  /* ---------------- 场景脚手架 ----------------
     phrases={}  = 零开口（首访）；phrases={'arrival':[…]} = 已开口。
     这是 A/B 对比里唯一的变量。 */
  const setup = async (opts = {}) => page.evaluate((o) => {
    ['sinoky_nono_wave', 'sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day',
     'sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    try { localStorage.removeItem('sinoky_nono'); } catch (e) {}
    try {
      if (o.tour === false) localStorage.removeItem('sinoky_tour');
      else localStorage.setItem('sinoky_tour', '1');
    } catch (e) {}
    S.phrases = o.spoken ? { arrival: [{ hz: '你好', py: 'nǐ hǎo', en: 'Hello!' }] } : {};
    S.feat = S.feat || {}; delete S.feat.nonoWave;
    NONO.closed = false; NONO.lockUntil = 0;
    const p = document.getElementById('nono-panel'); if (p) p.style.display = 'none';
    const m = document.getElementById('nono-msg'); if (m) m.innerHTML = '';
    const a = document.getElementById('nono-acts'); if (a) a.innerHTML = '';
    const inv = document.getElementById('nono-invite'); if (inv) inv.classList.remove('on');
    if (o.view && typeof window.go === 'function') window.go(o.view);
    return true;
  }, opts);

  const fire = () => page.evaluate(() => { try { return window.nonoWave(); } catch (e) { return 'THROW ' + e.message; } });

  const snap = () => page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    const m = document.getElementById('nono-msg');
    const a = document.getElementById('nono-acts');
    const inv = document.getElementById('nono-invite');
    const pose = document.getElementById('nono-pose');
    return {
      open: !!(p && p.style.display === 'block'),
      msgs: m ? m.innerHTML : '',
      txt: m ? m.textContent.replace(/\s+/g, ' ').trim() : '',
      btnTxt: a ? Array.from(a.querySelectorAll('button')).map((b) => b.textContent.trim()).join('|') : '',
      acts: a ? a.innerHTML : '',
      pose: pose ? (pose.getAttribute('src') || '') : '',
      feat: (S.feat || {}).nonoWave || 0,
      mark: localStorage.getItem('sinoky_nono_wave') || '',
      inviteOn: !!(inv && inv.classList.contains('on')),
      inviteExists: !!inv,
    };
  });

  /* ---------------- P1 首访 → 招手邀请（核心） ---------------- */
  await setup({ spoken: false });
  const r1 = await fire();
  let s = await snap();
  chk('P1 首访：nonoWave() 返回 true（真的发出了）', r1 === true, String(r1));
  chk('P1 面板被打开', s.open, '');
  chk('P1 先说中文「你好！」且带拼音', /你好！/.test(s.msgs) && /nǐ hǎo/.test(s.msgs), s.txt.slice(0, 80));
  chk('P1 再邀请回一句（英文文案来自字典）', /Say it back to me\./.test(s.txt), s.txt.slice(0, 90));
  chk('P1 不再是老的自我介绍「I\'m Nono」', !/I'm Nono/.test(s.txt), s.txt.slice(0, 90));
  chk('P1 姿态是 wave（招手）', /wave/.test(s.pose), s.pose);
  chk('P1 两个动作：Say it back + Later', /Say it back/.test(s.btnTxt) && /Later/.test(s.btnTxt), s.btnTxt);
  chk('P1 按钮指向首场景首句 arrival#0', /arrival#0/.test(s.acts), s.acts.slice(0, 110));
  chk('P1 埋点 S.feat.nonoWave = 1', s.feat === 1, String(s.feat));
  chk('P1 写了「今天已邀请」标记', s.mark === today(), `${s.mark} / ${today()}`);

  /* ---------------- P2 每天只一次 ---------------- */
  const r2 = await fire();
  const s2 = await snap();
  chk('P2 第二次调用不再消耗（feat 仍为 1）', s2.feat === 1 && r2 === false, `feat=${s2.feat} ret=${r2}`);

  /* ---------------- P3 已开口 → 不打扰（A/B 对照） ---------------- */
  await setup({ spoken: true });
  const r3 = await fire();
  const s3 = await snap();
  chk('P3 已开口：nonoWave() 返回 false', r3 === false, String(r3));
  chk('P3 已开口：面板未打开、埋点未涨', !s3.open && s3.feat === 0, `open=${s3.open} feat=${s3.feat}`);
  chk('P3 已开口：没写标记（不污染后续判断）', s3.mark === '', s3.mark);

  /* ---------------- P4 首启引导卡没过 → 不抢（I-014） ---------------- */
  await setup({ spoken: false, tour: false });
  const r4 = await fire();
  const s4 = await snap();
  chk('P4 sinoky_tour != 1 时不发（新用户不被遮挡）', r4 === false && s4.feat === 0, `ret=${r4} feat=${s4.feat}`);
  chk('P4 也没写标记（引导卡过后还能补上）', s4.mark === '', s4.mark);

  /* ---------------- P5 非 home 视图不发 ---------------- */
  await setup({ spoken: false, view: 'days' });
  const r5 = await fire();
  const s5 = await snap();
  chk('P5 视图不是 home 时不发', r5 === false && s5.feat === 0, `ret=${r5}`);
  await page.evaluate(() => window.go('home'));

  /* ---------------- P6 用户关掉陪伴 → 静默 ---------------- */
  await setup({ spoken: false });
  await page.evaluate(() => { NONO.closed = true; });
  const r6 = await fire();
  const s6 = await snap();
  chk('P6 NONO.closed 时不发（尊重「关掉陪伴」）', r6 === false && s6.feat === 0, `ret=${r6}`);
  await page.evaluate(() => { NONO.closed = false; });

  /* ---------------- P7 面板被「用户」占用 → 不抢 ----------------
     判据是**面板状态**（NONO.mode），不是「面板是否打开」：
     主代码的「今日句」会先把面板占住（普通态），而那正是该被本邀请替换的东西。 */
  await setup({ spoken: false });
  await page.evaluate(() => {
    document.getElementById('nono-panel').style.display = 'block';
    window.NONO.mode = 'practice';                 /* 用户正在练习 */
  });
  const r7 = await fire();
  chk('P7 面板被用户占用（练习中）时不抢', r7 === false, String(r7));
  await page.evaluate(() => {
    window.NONO.mode = ''; document.getElementById('nono-panel').style.display = 'none';
  });
  /* 反例：同样面板开着，但内容只是诺诺在念「今日句」⇒ 应当覆盖 */
  await setup({ spoken: false });
  await page.evaluate(() => {
    document.getElementById('nono-panel').style.display = 'block';
    document.getElementById('nono-msg').innerHTML = 'Your line for today: nihao';
    window.NONO.mode = '';
  });
  const r7b = await fire();
  const s7b = await snap();
  chk('P7b 面板只是「今日句」时允许覆盖（首访第一句该是邀请）',
      r7b === true && /Say it back to me\./.test(s7b.txt), `ret=${r7b} txt=${s7b.txt.slice(0, 60)}`);

  /* ---------------- P8 点「Say it back」→ 真的进到「你好」的跟读 ---------------- */
  await setup({ spoken: false });
  await fire();
  const clicked = await page.evaluate(() => {
    const a = document.getElementById('nono-acts');
    if (!a) return false;
    const b = Array.from(a.querySelectorAll('button')).find((x) => /Say it back/.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  });
  chk('P8 找到并点击了「Say it back」', clicked, '');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    line: (window.NONO_LINE && window.NONO_LINE.key) || '',
    hz: (window.NONO_LINE && window.NONO_LINE.hz) || '',
    practice: (document.getElementById('nono-practice') || {}).innerHTML || '',
    panel: (document.getElementById('nono-panel') || {}).style.display || '',
    mode: (window.NONO || {}).mode || '',
  }));
  chk('P8 闭环成立：NONO_LINE 是首场景首句 arrival#0', after.line === 'arrival#0', `NONO_LINE=${after.line}`);
  chk('P8 练习区渲染出「你好」', /你好/.test(after.practice) && after.hz === '你好', `hz=${after.hz}`);
  chk('P8 面板保持打开（用户直接可以开口）', after.panel === 'block', after.panel);

  /* ---------------- P9 冷启动 A 组：零开口（真时序，不是直调） ----------------
     首访用户「打开就停在 home」，不经过 go() ⇒ 只有 boot 补枪能覆盖。
     同时验证位阶：招手邀请发出后，§8 的导览邀请**不该**跟着冒出来。 */
  const bootArm = async (spoken) => {
    await page.evaluate((sp) => {
      const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
      s.onboarded = true;
      s.phrases = sp ? { arrival: [{ hz: '你好', py: 'nǐ hǎo', en: 'Hello!' }] } : {};
      s.feat = s.feat || {}; delete s.feat.nonoWave;
      localStorage.setItem('sinoky_state', JSON.stringify(s));
      localStorage.setItem('sinoky_tour', '1');
      ['sinoky_nono_wave', 'sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day',
       'sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
    }, spoken);
    await page.reload({ waitUntil: 'load' });
  };
  const waitSnap = async (ms) => {
    await page.waitForTimeout(ms);
    return page.evaluate(() => {
      const p = document.getElementById('nono-panel');
      const m = document.getElementById('nono-msg');
      const inv = document.getElementById('nono-invite');
      const pose = document.getElementById('nono-pose');
      return {
        open: !!(p && p.style.display === 'block'),
        txt: m ? m.textContent.replace(/\s+/g, ' ').trim() : '',
        pose: pose ? (pose.getAttribute('src') || '') : '',
        feat: (S.feat || {}).nonoWave || 0,
        mark: localStorage.getItem('sinoky_nono_wave') || '',
        tour: localStorage.getItem('sinoky_tour') || '',
        inviteOn: !!(inv && inv.classList.contains('on')),
        inviteExists: !!inv,
        manual: (() => { const a = document.getElementById('nono-acts'); return a ? a.innerHTML : ''; })(),
      };
    });
  };

  await bootArm(false);
  const A1 = await waitSnap(12000);     /* boot 1.6s + 8s 延时 + 重试余量 */
  chk('P9 冷启动 A：零开口 → 招手邀请真的自己冒出来了', A1.open && A1.feat === 1, `open=${A1.open} feat=${A1.feat}`);
  chk('P9 冷启动 A：文案是「你好！+ Say it back to me」', /你好！/.test(A1.txt) && /Say it back to me\./.test(A1.txt), A1.txt.slice(0, 90));
  chk('P9 冷启动 A：姿态 wave', /wave/.test(A1.pose), A1.pose);
  chk('P9 冷启动 A：日标记落了', A1.mark === today(), A1.mark);
  chk('P9 冷启动 A：不像今天句那样随机（§12b 吃掉了今日句）',
      !/Your line for today/.test(A1.txt), A1.txt.slice(0, 90));
  chk('P9 冷启动 A：导览邀请未叠层', !A1.inviteOn, `inviteOn=${A1.inviteOn}`);

  /* ---------------- P10 冷启动 B 组：已开口（A/B 对照） ----------------
     唯一变量 = S.phrases（A 组是 {}，这里有一句）。
     判据故意**不用**「面板 open」：已开口时主代码的「今日句」本来就会打开面板
     （既有行为，不是本次改动引入）—— 用 open 判会把既有行为误判成本机制的失败。
     改看三个本机制专属的信号：埋点 / 日标记 / 文案。 */
  await bootArm(true);
  const B1 = await waitSnap(12000);
  chk('P10 冷启动 B（已开口）：招手邀请未发出（埋点 0）', B1.feat === 0, `feat=${B1.feat}`);
  chk('P10 冷启动 B：没写日标记', B1.mark === '', B1.mark);
  chk('P10 冷启动 B：面板里不是招手邀请的文案', !/Say it back to me\./.test(B1.txt), B1.txt.slice(0, 80));

  /* ---------------- P11 位阶 A/B（§8 导览邀请 vs §12 招手邀请） ----------------
     两个邀请都在 home、都在 boot 后 8 秒。位阶条件是
       inviteOk(): waveZeroSpeak() && sinoky_nono_wave !== today  → 让位
     所以干净的自变量是**日标记**（其余全部相同）：
       组 1：零开口 + 日标记为空（今天还没被邀请过）→ 导览邀请被挡
       组 2：零开口 + 日标记 = 今天（人为标记为已邀请）→ 导览邀请放行
     组 1 里把 sinoky_tour 留空 ⇒ §12 不会发面板 ⇒ 「导览邀请未出现」只能归因于位阶条件，
     不会与「面板已开不叠层」混淆。 */
  const rankArm = async (waveMark) => {
    await page.evaluate((mk) => {
      const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
      s.onboarded = true; s.phrases = {}; s.feat = s.feat || {}; delete s.feat.nonoWave;
      localStorage.setItem('sinoky_state', JSON.stringify(s));
      localStorage.removeItem('sinoky_tour');            /* 让 §12 沉默，排除面板干扰 */
      ['sinoky_nono_wave', 'sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day',
       'sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
      /* 占满当日气泡配额 ⇒ 主代码的「今日句」也不会开面板 ⇒
         「导览邀请是否出现」只取决于位阶条件，不会与「面板已开不叠层」混淆。 */
      localStorage.setItem('sinoky_nono_day', JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: 4 }));
      if (mk) localStorage.setItem('sinoky_nono_wave', mk);
    }, waveMark);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(9500);                     /* §8 的 inviteTick 在 8000ms */
    return page.evaluate(() => {
      const inv = document.getElementById('nono-invite');
      return {
        inviteOn: !!(inv && inv.classList.contains('on')),
        exists: !!inv,
        panelOpen: (document.getElementById('nono-panel') || {}).style.display === 'block',
      };
    });
  };
  const R1 = await rankArm(null);
  chk('P11 位阶组 1（今日尚未邀请）→ 导览邀请让位', !R1.inviteOn, `inviteOn=${R1.inviteOn} exists=${R1.exists}`);
  chk('P11 位阶组 1：排除面板干扰（§12 确实沉默）', !R1.panelOpen, `panelOpen=${R1.panelOpen}`);
  const R2 = await rankArm(today());
  chk('P11 位阶组 2（今日已邀请过）→ 导览邀请放行', R2.inviteOn, `inviteOn=${R2.inviteOn} exists=${R2.exists}`);

  /* ---------------- P12 冷启动 C 组：引导卡没过 → 点掉后窗口内补上 ----------------
     这是最真实的首访时序：开 App 时有首启引导卡，用户看几秒再点掉，
     「招手邀请」必须在那一刻补上（而不是一开局就放弃）。 */
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.onboarded = true; s.phrases = {};
    s.feat = s.feat || {}; delete s.feat.nonoWave;
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    localStorage.removeItem('sinoky_tour');
    ['sinoky_nono_wave', 'sinoky_nono_recall', 'sinoky_nono_daily', 'sinoky_nono_day',
     'sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  const C1 = await waitSnap(10000);     /* 引导卡未过 → 10s 内应一直不发 */
  chk('P12 C 组：引导卡没过 → 不发（不看 open：今日句本来就会开面板）',
      C1.feat === 0 && C1.mark === '', `feat=${C1.feat} mark=${C1.mark} tour=${C1.tour}`);
  await page.evaluate(() => { try { window.endTour(); } catch (e) {} });
  const C2 = await waitSnap(5000);      /* 点掉引导卡 → 2.5s 一次的重试应命中 */
  chk('P12 C 组：点掉引导卡后窗口内补上（跨时刻重试有效）', C2.open && C2.feat === 1,
      `open=${C2.open} feat=${C2.feat} tour=${C2.tour}`);
  chk('P12 C 组：补上的文案正确', /你好！/.test(C2.txt) && /Say it back to me\./.test(C2.txt), C2.txt.slice(0, 90));

  /* ---------------- Z. 收口 ---------------- */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk('零横向溢出', overflow <= 0, `overflow=${overflow}`);
  chk('零 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();

  const pass = R.filter((r) => r[0] === 'PASS').length;
  const fail = R.filter((r) => r[0] === 'FAIL');
  console.log('\n=== 「首访招手邀请」浏览器真跑验收 ===');
  R.forEach((r) => console.log(`  ${r[0] === 'PASS' ? '✓' : '✗'} ${r[1]}${r[2] ? '   [' + r[2] + ']' : ''}`));
  console.log(`\n通过 ${pass} 项，失败 ${fail.length} 项`);
  if (fail.length) { console.log('\n失败明细：'); fail.forEach((r) => console.log(`  ✗ ${r[1]}   [${r[2]}]`)); }
  process.exit(fail.length ? 1 : 0);
}
