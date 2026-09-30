/* 2026-09-30 Sinoky 产品功能全面审计（真浏览器 L3）
   覆盖：启动/导航 · 录音(录制/播放/异常) · 评分渲染 · 播放(TTS/本地) · 全按钮点击 · 页面跳转/返回
   纪律：本地静态服务 sinoky-app/ + page.route 桩掉所有 /api/*（零生产写入），真 Chrome + 假麦克风。
   用法：NODE_PATH=<workspace>/node_modules node _internal/audit_ui_20260930.cjs
   产出：_internal/_audit_ui_20260930/result.json + 控制台逐项结论 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_audit_ui_20260930');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, r) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.normalize(path.join(ROOT, p));
      if (!fp.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
      fs.readFile(fp, (e, b) => {
        if (e) { r.writeHead(404); return r.end('not found'); }
        r.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        r.end(b);
      });
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

const MOCK = { asr: { mode: 'ok', text: '你好' }, score: { mode: 'ok' }, tts: { mode: 'ok' }, chat: { mode: 'ok' } };
const REQ = { asr: [], score: [], tts: [] };
const RESULT = { startedAt: new Date().toISOString(), tests: [], notes: [], pageErrors: [], consoleErrors: [], badResponses: [] };
let fails = 0;
function rec(name, ok, detail) {
  if (!ok) fails++;
  RESULT.tests.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? '   ' + detail : ''));
}
const tinyWav = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=', 'base64');
const SCORE_OK = { overall: 100, verdict: 'Great ✅', perSyll: [{ target: 'nǐ', user: 'nǐ', score: 1, errs: [], tExp: 3, tGot: 3, toneOk: true }, { target: 'hǎo', user: 'hǎo', score: 1, errs: [], tExp: 3, tGot: 3, toneOk: true }], n: 2 };

(async () => {
  const server = await startServer();
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('sinoky_lang_chosen', '1');
      localStorage.setItem('sinoky_tour', '1');
      localStorage.setItem('sinoky_state', JSON.stringify({ lang: 'en', onboarded: true, phrases: {}, days: [], streak: 0, tone: { total: 0, right: 0 } }));
    } catch (e) {}
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stub":true}' }));
  await ctx.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const pd = route.request().postData() || '';
    if (/\/api\/asr$/.test(p)) {
      REQ.asr.push(pd.length);
      if (MOCK.asr.mode === 'fail') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'whisper returned no text' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: MOCK.asr.text }) });
    }
    if (/\/api\/score$/.test(p)) {
      REQ.score.push(pd);
      if (MOCK.score.mode === 'abort') return route.abort();
      if (MOCK.score.mode === 'err') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'target and user are required' }) });
      if (MOCK.score.mode === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      if (MOCK.score.mode === 'partial') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ overall: 50, verdict: 'Retry ❌', perSyll: [{ target: 'nǐ', user: 'ní', score: 0.5, errs: ['tone'], tExp: 3, tGot: 2, toneOk: false }, { target: 'hǎo', user: 'hǎo', score: 1, errs: [], tExp: 3, tGot: 3, toneOk: true }], n: 2 }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCORE_OK) });
    }
    if (/\/api\/tts/.test(p)) {
      REQ.tts.push(route.request().url());
      if (MOCK.tts.mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"tts down"}' });
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: tinyWav });
    }
    if (/\/api\/chat/.test(p)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Nice, keep going!', degraded: false }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stub":true}' });
  });

  const page = await ctx.newPage();
  const diag = [];
  page.on('pageerror', (e) => RESULT.pageErrors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') RESULT.consoleErrors.push(t.slice(0, 200)); if (/\[REC\]|\[SCORE\]|\[ASR\]/.test(t)) diag.push(t.slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) RESULT.badResponses.push(r.status() + ' ' + r.url()); });

  const onView = (v) => page.evaluate((x) => { const e = document.getElementById('v-' + x); return !!(e && e.classList.contains('on')); }, v);
  const toScene = async (id) => { await page.evaluate((s) => openScene(s), id || 'arrival'); await page.waitForTimeout(450); };
  const dismissOverlays = () => page.evaluate(() => { document.querySelectorAll('.ovl').forEach((m) => { try { m.style.display = 'none'; } catch (e) {} }); });

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1600);

  /* ============ S. 启动 ============ */
  rec('S1 启动直达首页（跳过语言门/引导）', await onView('home'));
  rec('S2 语言门未弹出', await page.evaluate(() => { const g = document.getElementById('lang-gate'); return !g || getComputedStyle(g).display === 'none'; }));

  /* ============ N. 导航 ============ */
  console.log('\n--- N. 页面跳转 / 返回 ---');
  const tabs = [['nav-home', 'home'], ['nav-practice', 'practice'], ['nav-explore', 'explore'], ['nav-prog', 'prog'], ['nav-me', 'me']];
  for (const [nav, view] of tabs) {
    const el = await page.$('#' + nav);
    if (!el) { rec('N1 底栏 ' + nav + ' 存在', false); continue; }
    await el.click(); await page.waitForTimeout(400);
    const ok = await onView(view) && await page.evaluate((n) => { const e = document.getElementById(n); return !!e && e.classList.contains('on'); }, nav);
    rec('N1 点击 ' + nav + ' → 视图+底栏高亮 ' + view, ok);
  }
  await page.evaluate(() => go('home')); await page.waitForTimeout(200);
  await toScene('arrival');
  rec('N2 openScene(arrival) → v-scene 显示', await onView('scene'));
  const nPhr = await page.evaluate(() => document.querySelectorAll('#sc-list [id^="ph-"]').length);
  rec('N3 场景句子卡渲染', nPhr > 0, 'phrases=' + nPhr);
  await page.evaluate(() => goBack()); await page.waitForTimeout(350);
  rec('N4 goBack() → 回到 home（sceneFrom）', await onView('home'));
  // 浏览器返回
  await page.evaluate(() => { go('home'); openScene('arrival'); }); await page.waitForTimeout(400);
  const urlBefore = page.url();
  await page.goBack({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(500);
  const backState = await page.evaluate(() => ({ url: location.href, scene: !!(document.getElementById('v-scene') || {}).classList && document.getElementById('v-scene').classList.contains('on'), home: document.getElementById('v-home') && document.getElementById('v-home').classList.contains('on'), alive: document.body && document.body.innerHTML.length > 500 }));
  RESULT.notes.push({ k: 'browser-back', v: backState });
  console.log('   ℹ️ 浏览器返回后：' + JSON.stringify(backState));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(1400);

  /* ============ R. 录音 ============ */
  console.log('\n--- R. 录音（录制/播放/异常）---');
  await toScene('arrival');
  rec('R0 第1句 Score 按钮存在', !!(await page.$('#sc-btn-0')));
  REQ.asr.length = 0; REQ.score.length = 0;
  await page.click('#sc-btn-0'); await page.waitForTimeout(300);
  const listening = await page.evaluate(() => { const b = document.getElementById('sc-btn-0'), box = document.getElementById('score-0'); return { btn: b && b.textContent.trim(), listening: b && b.classList.contains('listening'), box: box && box.textContent.trim().slice(0, 40) }; });
  rec('R1 点 Score → 进入录音态（Stop + Listening）', /Stop|⏹/.test(listening.btn || '') && listening.listening, JSON.stringify(listening));
  await page.waitForTimeout(2600);   /* 录满 ~2.9s：假麦克风也要让 blob ≥ 500B，否则会命中「No sound captured」守卫（测试台时序，非产品缺陷） */
  await page.click('#sc-btn-0'); await page.waitForTimeout(2500);
  const scored = await page.evaluate(() => { const box = document.getElementById('score-0'); const card = box && box.querySelector('.score-card'); return { hasCard: !!card, overall: card ? (card.querySelector('.score-overall') || {}).textContent : null, boxText: box ? box.textContent.trim().slice(0, 90) : '' }; });
  rec('R2 停止 → ASR(mock)→评分(mock)→渲染 score-card=100', scored.hasCard && /100/.test(scored.overall || ''), JSON.stringify({ hasCard: scored.hasCard, overall: scored.overall, box: scored.boxText }));
  rec('R3 录音经 ASR 上传（/api/asr 被调）', REQ.asr.length >= 1, 'asr calls=' + REQ.asr.length + ' (postData len=' + REQ.asr[0] + ')');
  rec('R4 /api/score 收到 {target,user} 且 user=ASR 文本', REQ.score.some((b) => /"target"/.test(b) && /"user"/.test(b) && /你好/.test(b)), (REQ.score[0] || '').slice(0, 110));
  const modalAfterScore = await page.evaluate(() => !!document.getElementById('extendModal'));
  RESULT.notes.push({ k: 'modal-after-score', v: modalAfterScore });
  console.log('   ℹ️ 评分成功后弹出引导弹窗 extendModal（Say your own line）：' + modalAfterScore);

  // R5 麦克风被拒
  await dismissOverlays();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })); });
  await page.click('#sc-btn-0'); await page.waitForTimeout(600);
  const micMsg = await page.evaluate(() => (document.getElementById('score-0') || {}).textContent || '');
  rec('R5 麦克风被拒 → 显示 "Microphone blocked" + 修复指引', /Microphone blocked/i.test(micMsg), micMsg.slice(0, 70));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1400); await toScene('arrival');

  // R6 ASR 失败
  MOCK.asr.mode = 'fail';
  await dismissOverlays();
  await page.click('#sc-btn-0'); await page.waitForTimeout(2600); await page.click('#sc-btn-0'); await page.waitForTimeout(2200);
  const asrMsg = await page.evaluate(() => (document.getElementById('score-0') || {}).textContent || '');
  rec('R6 ASR 失败 → 显式透出原因（Did not catch that…）', /Did not catch that/i.test(asrMsg), asrMsg.slice(0, 90));
  MOCK.asr.mode = 'ok';

  // R7 评分接口不可达（网络错）
  MOCK.score.mode = 'abort';
  await dismissOverlays();
  await page.click('#sc-btn-0'); await page.waitForTimeout(2600); await page.click('#sc-btn-0'); await page.waitForTimeout(2600);
  const netMsg = await page.evaluate(() => (document.getElementById('score-0') || {}).textContent || '');
  rec('R7 评分请求失败 → "Scoring failed" 而非静默/空白', /Scoring failed/i.test(netMsg), netMsg.slice(0, 90));
  MOCK.score.mode = 'ok';

  // R8 评分返回 error 字段
  MOCK.score.mode = 'err';
  await dismissOverlays();
  await page.click('#sc-btn-0'); await page.waitForTimeout(2600); await page.click('#sc-btn-0'); await page.waitForTimeout(2400);
  const errMsg = await page.evaluate(() => (document.getElementById('score-0') || {}).textContent || '');
  rec('R8 评分返回 {error} → 展示后端口径错误', /required/i.test(errMsg), errMsg.slice(0, 90));
  MOCK.score.mode = 'ok';

  // R10 非满分评分的渲染保真（overall + 错因块 + 声调标注）
  MOCK.score.mode = 'partial';
  await dismissOverlays();
  await page.click('#sc-btn-0'); await page.waitForTimeout(2600); await page.click('#sc-btn-0'); await page.waitForTimeout(2400);
  const partial = await page.evaluate(() => { const box = document.getElementById('score-0'); const card = box && box.querySelector('.score-card'); return { overall: card ? (card.querySelector('.score-overall') || {}).textContent : null, hasFix: !!(box && box.querySelector('.score-fix')), text: box ? box.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '' }; });
  rec('R10 非满分评分 → 渲染 overall(50) + 错因块(.score-fix) + 应为X声', partial.hasFix && /50/.test(partial.overall || ''), JSON.stringify(partial));
  MOCK.score.mode = 'ok';

  // R9 不支持录音（无 MediaRecorder）
  await dismissOverlays();
  await page.evaluate(() => { try { delete window.MediaRecorder; } catch (e) {} window.MediaRecorder = undefined; });
  await page.click('#sc-btn-0'); await page.waitForTimeout(500);
  const nsMsg = await page.evaluate(() => (document.getElementById('score-0') || {}).textContent || '');
  rec('R9 无 MediaRecorder → "not supported in this browser"', /not supported/i.test(nsMsg), nsMsg.slice(0, 80));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1400); await toScene('arrival');

  /* ============ P. 播放 ============ */
  console.log('\n--- P. 播放（本地克隆音色 / 服务端 TTS）---');
  const playBtn = await page.$('#v-scene .spk');
  rec('P0 场景卡片存在播放按钮(.spk)', !!playBtn);
  // P1 默认路径（SENT_AUDIO 命中 → 本地 mp3）
  REQ.tts.length = 0;
  await page.evaluate(() => { const b = document.querySelector('#v-scene .spk'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  const audio1 = await page.evaluate(() => ({ src: window.AUDIO && window.AUDIO.src, hasSrc: !!(window.AUDIO && window.AUDIO.src), paused: window.AUDIO ? window.AUDIO.paused : null }));
  rec('P1 点播放 → 有音频元素被赋值并播放（本地或TTS）', audio1.hasSrc, JSON.stringify(audio1.src ? audio1.src.slice(0, 60) : ''));
  // P2 强制走服务端 TTS
  REQ.tts.length = 0;
  await page.evaluate(() => { window.SENT_AUDIO = null; const b = document.querySelector('#v-scene .spk'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  rec('P2 本地无音源时 → 回退请求 /api/tts', REQ.tts.length >= 1, 'tts calls=' + REQ.tts.length);
  // P3 TTS 失败 → 不崩（降级链）
  const before = RESULT.pageErrors.length;
  MOCK.tts.mode = 'fail';
  await page.evaluate(() => { window.SENT_AUDIO = null; const b = document.querySelector('#v-scene .spk'); if (b) b.click(); });
  await page.waitForTimeout(2500);
  rec('P3 TTS 全失败 → 降级不抛未捕获异常', RESULT.pageErrors.length === before, 'pageErrors+' + (RESULT.pageErrors.length - before));
  MOCK.tts.mode = 'ok';
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1400);

  /* ============ B. 全按钮点击 ============ */
  console.log('\n--- B. 全按钮点击响应 ---');
  const VIEWS = ['home', 'practice', 'explore', 'prog', 'me', 'settings', 'cities', 'days', 'dialog', 'review', 'cards', 'sentences', 'reading', 'scenes-read', 'cityguide', 'tone'];
  const sweep = [];
  for (const v of VIEWS) {
    await page.evaluate((x) => { try { go(x); } catch (e) {} }, v); await page.waitForTimeout(300);
    const present = await page.evaluate((x) => { const r = document.getElementById('v-' + x); return !!(r && r.classList.contains('on')); }, v);
    if (!present) { sweep.push({ view: v, reachable: false, n: 0, clicked: 0, errs: [] }); continue; }
    const n = await page.evaluate((x) => { const r = document.getElementById('v-' + x); return r ? r.querySelectorAll('button,a,[onclick]').length : 0; }, v);
    const errs = [];
    let clicked = 0;
    const cap = Math.min(n, 40);
    for (let i = 0; i < cap; i++) {
      await page.evaluate((x) => { try { go(x); } catch (e) {} }, v); await page.waitForTimeout(40);
      const r = await page.evaluate(([x, idx]) => {
        const root = document.getElementById('v-' + x); if (!root) return 'gone';
        const els = root.querySelectorAll('button,a,[onclick]'); const el = els[idx]; if (!el) return 'gone';
        try { el.click(); return 'ok'; } catch (e) { return 'ERR:' + ((e && e.message) || e); }
      }, [v, i]);
      if (r === 'ok') clicked++; else if (r !== 'gone') errs.push(i + ':' + r);
      await page.waitForTimeout(30);
    }
    // 清理：停录音 + 关掉可能的模态
    await page.evaluate(() => { try { if (typeof stopRecording === 'function') stopRecording(); } catch (e) {} try { document.querySelectorAll('#lang-gate').forEach((m) => (m.style.display = 'none')); } catch (e) {} });
    sweep.push({ view: v, reachable: true, n, clicked, errs });
    rec('B ' + v.padEnd(12) + ' 按钮 ' + String(n).padStart(3) + ' 个，点击 ' + String(clicked).padStart(3) + ' 个，抛错 ' + errs.length, errs.length === 0, errs.slice(0, 3).join(' | '));
  }
  RESULT.notes.push({ k: 'button-sweep', v: sweep });

  /* ============ E. 汇总 ============ */
  RESULT.failCount = fails;
  RESULT.diag = diag;
  RESULT.badResponses = RESULT.badResponses.filter((x) => !/stub|127\.0\.0\.1\/api/.test(x));
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(RESULT, null, 2), 'utf8');
  await page.screenshot({ path: path.join(OUT, 'final.png') });
  await browser.close();
  server.close();

  console.log('\n=== 录音/评分/ASR 诊断日志 ===');
  diag.slice(-30).forEach((d) => console.log('  ' + d));
  console.log('\n=== 运行时健康 ===');
  console.log('  pageerror: ' + RESULT.pageErrors.length + (RESULT.pageErrors.length ? '\n    ' + RESULT.pageErrors.slice(0, 8).join('\n    ') : ''));
  console.log('  console.error: ' + RESULT.consoleErrors.length + (RESULT.consoleErrors.length ? '\n    ' + RESULT.consoleErrors.slice(0, 8).join('\n    ') : ''));
  console.log('  4xx/5xx: ' + RESULT.badResponses.length + (RESULT.badResponses.length ? '\n    ' + RESULT.badResponses.slice(0, 8).join('\n    ') : ''));
  console.log('\n=== 审计结果：' + (RESULT.tests.length - fails) + '/' + RESULT.tests.length + ' 通过，失败 ' + fails + ' ===');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
