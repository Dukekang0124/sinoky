/* v0.24.1 真机验收：i18n 盲区闭合
 *
 * 验证目标（对应体检 P0-2 三类）：
 *   1) 字典层：27 条新增 key 在 6 语言下 T() 均返回译文（≠ key），且非英语译文零 CJK 残留
 *   2) 根因层：VIEW_HINT 3 条「早已有 key 却永不生效」的，现在 T() 能命中
 *   3) DOM 层：tourHtml() 在 es 下输出的整卡文本无英文源文；渲染进 DOM 后等 600ms
 *      （越过 MutationObserver 的 400ms 窗口）断言不被 applyI18n 冲回英文
 *   4) 芯片层：quotaBadge 不再吐中文
 *   5) 无 pageerror
 *
 * 跑法：NODE_PATH=<managed node_modules> node _internal/fix-2026-09-24/test_i18n_closure.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8155;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

/* 27 条新增 key（与 _internal/fix-2026-09-24/add_i18n_keys.cjs 同源） */
const NEW_KEYS = [
  '<b>先听，再跟我念 3 遍。</b><br>Tap the mic and say it out loud.',
  '<b>读一句，说一句。</b><br>Reading it is not the same as saying it.',
  '<b>选一句，说 3 遍。</b><br>Slow the first time, real the third.',
  '<b>挑一句，说给我听。</b><br>You saved these — now say them out loud.',
  '<b>看懂了，也要说出来。</b><br>Understanding it is not the same as saying it.',
  '<b>每一枚勋章，都是你开口换来的。</b><br>Say one more line — the next one is close.',
  '✅ Unlocked · unlimited',
  '{n} {feat} left today',
  'should be',
  ' · tone should be',
  'Nono will show you around',
  '1st tone', '2nd tone', '3rd tone', '4th tone', 'neutral tone',
  '👋 New here?',
  '60 SECONDS',
  'Three steps — that is the whole app:',
  '<b>New to Chinese?</b> Characters do not tell you how to say them — that is what the small letters above them are for (pinyin: <b>nǐ hǎo</b>). The little marks are tones: ā á ǎ à — four tones, four different words. Tap ▶ to hear any line; tap 🐢 to slow it down — tap again for slower (0.5×, best for hearing the tones).',
  '1️⃣ Tap a line below → listen, cover the Chinese, <b>say it out loud 3×</b>. Speaking is the whole point.',
  '2️⃣ Do one <b>Day</b> card a day — the streak keeps you coming back.',
  '3️⃣ Open <b>Tones</b> for 1 minute — train your ear: four tones, four different words.',
  '4️⃣ Want to <b>write</b> characters too? Open <b>Cards</b> → tap ✍️ <b>Strokes</b> — watch the stroke order, then trace it yourself.',
  '🔒 Recordings are never saved · 💬 Feedback (bottom-left) any time',
  "Got it — let's speak",
  'I’m Nono 🐼 — here are the three things that matter. Want the full map? Tap me any time.',
];

/* 3 条「早已有 key 但永不生效」的 VIEW_HINT（本轮根因修复的实证对象） */
const PREEXISTING = [
  '<b>Pick a scene you will actually use tomorrow.</b>',
  '<b>One step today — one line is enough.</b><br>Say it to me.',
  '<b>One line each — you play the "you".</b>',
];

let pass = 0, fail = 0;
const ok_ = (id, m) => { pass++; console.log('  \u2713 ' + id + ' ' + m); };
const no_ = (id, m) => { fail++; console.log('  \u2717 ' + id + ' ' + m); };

const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

(async () => {
  const server = http.createServer(serve);
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: 'mock' }) }));
  await page.route('**/bigmodel.cn/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { try { var s = document.getElementById('splash'); if (s) s.classList.add('hide'); } catch (e) {} });

  console.log('== v0.24.1 i18n 盲区闭合 · 真机验收 ==\n');

  // ───────────────────────── 第 1 组：字典层（6 语言 × 27 key）
  console.log('1. 字典层：27 条新增 key 在 6 语言下均命中且非英语零 CJK 残留');
  for (const lang of ['es', 'ru', 'vi', 'id', 'th']) {
    await page.evaluate((l) => window.setLang(l), lang);
    await page.waitForFunction((l) => window.LANG_PACK && window.LANG_PACK[l] && Object.keys(window.LANG_PACK[l]).length > 700, lang, { timeout: 15000 });
    const r = await page.evaluate((keys) => {
      const out = { miss: [], same: [], cjk: [] };
      for (const k of keys) {
        const v = window.T(k);
        if (v === undefined || v === null || v === '') out.miss.push(k);
        else if (v === k) out.same.push(k);
        else if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(v)) out.cjk.push({ k: k.slice(0, 40), v: v.slice(0, 60) });
      }
      return out;
    }, NEW_KEYS);
    if (r.miss.length || r.same.length || r.cjk.length) {
      no_('D-' + lang, '未命中 ' + r.miss.length + ' / 未翻译 ' + r.same.length + ' / 含 CJK ' + r.cjk.length +
        (r.same.length ? ' | 例:' + JSON.stringify(r.same[0].slice(0, 50)) : '') +
        (r.cjk.length ? ' | CJK例:' + JSON.stringify(r.cjk[0]) : ''));
    } else {
      ok_('D-' + lang, '27/27 命中，全部为 ' + lang + ' 译文，零 CJK');
    }
  }

  // ───────────────────────── 第 2 组：根因（3 条已有 key 现在能命中）
  console.log('\n2. 根因：VIEW_HINT 3 条「早已有 key 却永不生效」，T() 现在能命中');
  await page.evaluate(() => window.setLang('es'));
  await page.waitForFunction(() => window.LANG_PACK && window.LANG_PACK.es, { timeout: 15000 });
  const pre = await page.evaluate((keys) => keys.map((k) => ({ k: k.slice(0, 30), v: window.T(k), changed: window.T(k) !== k })), PREEXISTING);
  pre.forEach((p, i) => {
    p.changed ? ok_('R' + (i + 1), 'T() 命中 → ' + JSON.stringify(p.v.slice(0, 55)))
      : no_('R' + (i + 1), '仍未命中（形状不匹配？）：' + JSON.stringify(p.k));
  });

  // ───────────────────────── 第 3 组：DOM 层（tourHtml 输出 + 抗 MutationObserver 冲回）
  console.log('\n3. DOM 层：tourHtml() 在 es 下无英文源文；渲染后 600ms 不被冲回');
  const tour = await page.evaluate(() => {
    try { localStorage.removeItem('sinoky_tour'); } catch (e) {}
    return typeof window.tourHtml === 'function' ? window.tourHtml() : null;
  });
  if (!tour) { no_('T1', 'tourHtml() 不可用'); }
  else {
    const leaks = ['New here?', 'Three steps', '60 SECONDS', 'Got it', 'Recordings are never saved', 'here are the three things']
      .filter((s) => tour.includes(s));
    leaks.length ? no_('T1', 'tourHtml 仍含英文源文：' + leaks.join(' / ')) : ok_('T1', 'tourHtml 输出无英文源文残留');
    tour.includes('¿Primera vez aquí?') ? ok_('T2', '含西语引导文案（¿Primera vez aquí?）') : no_('T2', '未见西语引导文案');
  }
  // 渲染进 DOM，越过 MutationObserver 400ms 窗口
  const after = await page.evaluate(async () => {
    const host = document.getElementById('home-scenes');
    if (!host) return 'no-host';
    host.innerHTML = window.tourHtml();
    await new Promise((r) => setTimeout(r, 600));
    return host.innerText;
  });
  if (after === 'no-host') { no_('T3', '#home-scenes 不存在'); }
  else {
    const back = ['New here?', 'Three steps', 'Got it'].filter((s) => after.includes(s));
    back.length ? no_('T3', '600ms 后被 applyI18n 冲回英文：' + back.join(' / ')) : ok_('T3', '渲染 + 600ms 后仍为译文（未被冲回）');
  }

  // ───────────────────────── 第 4 组：芯片层（quotaBadge 不再吐中文）
  console.log('\n4. 芯片层：quotaBadge 在 es 下无中文');
  const chip = await page.evaluate(() => {
    const sk = window.SK;
    if (!sk || typeof sk.quotaBadge !== 'function') return { skip: true };
    try { return { a: sk.quotaBadge('chat'), b: sk.quotaBadge('sentence'), c: sk.quotaBadge('score') }; } catch (e) { return { err: e.message }; }
  });
  if (chip.skip) { no_('Q0', 'window.SK.quotaBadge 不可用（限额芯片验证缺失）'); }
  else if (chip.err) { no_('Q1', 'quotaBadge 抛错：' + chip.err); }
  else {
    const all = [chip.a, chip.b, chip.c].join(' ');
    const bad = CJK.test(all);
    bad ? no_('Q1', '芯片仍含中文：' + JSON.stringify(all))
      : ok_('Q1', '芯片无中文：' + JSON.stringify(chip.a));
  }

  // ───────────────────────── 第 5 组：zh 回归（中文版仍是中文）
  console.log('\n5. 回归：zh 下引导卡为中文');
  await page.evaluate(() => window.setLang('zh'));
  await page.waitForFunction(() => window.LANG_PACK && window.LANG_PACK.zh, { timeout: 15000 });
  const zhTour = await page.evaluate(() => { try { return window.tourHtml(); } catch (e) { return ''; } });
  zhTour.includes('第一次来？') ? ok_('Z1', 'zh 引导卡标题为「第一次来？」') : no_('Z1', 'zh 引导卡异常：' + zhTour.slice(0, 80));
  !zhTour.includes('New here?') ? ok_('Z2', 'zh 无英文残留') : no_('Z2', 'zh 仍含 New here?');

  // ───────────────────────── 第 6 组：错误
  console.log('\n6. 运行期错误');
  pageErrors.length ? no_('E0', '有 ' + pageErrors.length + ' 个 pageerror：' + pageErrors.slice(0, 2).join(' | ')) : ok_('E0', '无 pageerror');

  await browser.close();
  server.close();
  console.log('\n' + '─'.repeat(50));
  console.log('结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('─'.repeat(50));
  process.exit(fail ? 1 : 0);
})();
