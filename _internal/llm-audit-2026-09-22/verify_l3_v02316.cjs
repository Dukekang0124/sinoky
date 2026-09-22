// v0.23.16 L3 闭环度量验收：coach 触达(hit) + 闭环(loop) + buildStat 注入 + funnel 卡渲染 + 离线(miss) + 7 语言零 pageerror
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const COACH_REPLY = '诺诺说：二声要往上扬，再多练几次就稳了！';

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  fs.readFile(fp, (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(fp);
    const ct = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript'
      : ext === '.json' ? 'application/json' : ext === '.css' ? 'text/css' : 'text/plain';
    res.writeHead(200, { 'Content-Type': ct }); res.end(buf);
  });
});

function mkRoutes(page, failChat) {
  page.route('**/api/chat', r => {
    const rb = r.request().postData() || '';
    if (failChat || rb.includes('__fail__')) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'mock fail' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: COACH_REPLY, model: 'glm-4-flash', degraded: false }) });
  });
  page.route('**/api/score', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    overall: 62,
    perSyll: [{ target: '你', user: '泥', score: 0.2, toneOk: false, tExp: 3 },
              { target: '好', user: '好', score: 0.99 }]
  }) }));
  page.route('**/api/asr', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '泥好' }) }));
  page.route('**/api/ts', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: '' }) }));
  page.route('**/api/tts', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: '' }) }));
}

function seedGlobals() {
  window.NONO_LINE = { hz: '你好', py: 'nǐ hǎo', en: 'hello', key: 'test#0', scene: 'test' };
  window.NONO_MS = Date.now();
  window.asrText = async () => ({ ok: true, text: '泥好' });
}

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const out = [];
  const LANGS = ['en', 'zh', 'es', 'ru', 'vi', 'id', 'th'];
  let profileCaptured = null;

  for (const lang of LANGS) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    let profBody = null;
    page.route('**/api/profile', r => { profBody = r.request().postData(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });
    mkRoutes(page, false);
    await page.addInitScript(l => {
      localStorage.setItem('sinoky_state', JSON.stringify({ onboarded: true, lang: l }));
    }, lang);
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(async () => {
      const drive = async () => {
        window.NONO_LINE = { hz: '你好', py: 'nǐ hǎo', en: 'hello', key: 'test#0', scene: 'test' };
        window.NONO_MS = Date.now();
        window.asrText = async () => ({ ok: true, text: '泥好' });
        let p = document.getElementById('nono-practice');
        if (!p) { p = document.createElement('div'); p.id = 'nono-practice'; document.body.appendChild(p); }
        await nonoGrade(new Blob());
        await new Promise(res => setTimeout(res, 700));
      };
      await drive();   // 第一次：coach 成功 → hit + seed pending
      await drive();   // 第二次：checkAiLoop 检测上轮 pending → loop++
      const f = (window.S && window.S.aiFunnel) || {};
      const bs = (typeof buildStat === 'function') ? buildStat() : {};
      const aiHtml = (typeof aiWeakHtml === 'function') ? aiWeakHtml() : '';
      const box = p => document.querySelector('#nono-practice #np-comment');
      try { if (typeof pushProfile === 'function') await pushProfile(); } catch (e) {}
      return {
        hit: f.hit || 0, miss: f.miss || 0, loop: f.loop || 0,
        aiFunnelInBuildStat: !!bs.aiFunnel,
        buildStatAiFunnelHit: (bs.aiFunnel && bs.aiFunnel.hit) || 0,
        funnelCardHasRows: aiHtml.indexOf('wr-n') >= 0,
        coachReplaced: !!(document.querySelector('#nono-practice #np-comment') && document.querySelector('#nono-practice #np-comment').innerHTML.indexOf('诺诺说') >= 0)
      };
    });
    if (profBody) { try { const j = JSON.parse(profBody); profileCaptured = (j.stat && j.stat.aiFunnel) || null; } catch (e) {} }
    out.push({ lang, errs, hit: r.hit, loop: r.loop, miss: r.miss, aiFunnelInBuildStat: r.aiFunnelInBuildStat, buildStatAiFunnelHit: r.buildStatAiFunnelHit, funnelCardHasRows: r.funnelCardHasRows, coachReplaced: r.coachReplaced });
    await page.close();
  }

  // 离线兜底：coach 失败 → miss+1，#np-comment 保持模板（慢慢来）
  const page2 = await browser.newPage();
  const errs2 = [];
  page2.on('pageerror', e => errs2.push(String(e)));
  mkRoutes(page2, true);
  await page2.addInitScript(() => { localStorage.setItem('sinoky_state', JSON.stringify({ onboarded: true, lang: 'zh' })); });
  await page2.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
  await page2.waitForTimeout(700);
  const r2 = await page2.evaluate(async () => {
    window.NONO_LINE = { hz: '你好', py: 'nǐ hǎo', en: 'hello', key: 'test#0', scene: 'test' };
    window.NONO_MS = Date.now();
    window.asrText = async () => ({ ok: true, text: '泥好' });
    let p = document.getElementById('nono-practice');
    if (!p) { p = document.createElement('div'); p.id = 'nono-practice'; document.body.appendChild(p); }
    await nonoGrade(new Blob());
    await new Promise(res => setTimeout(res, 700));
    const box = p.querySelector('#np-comment');
    const f = (window.S && window.S.aiFunnel) || {};
    return { miss: f.miss || 0, comment: box ? box.innerHTML : null };
  });
  out.push({ scenario: 'offline-fallback', errs: errs2, miss: r2.miss, commentHasTemplate: (r2.comment || '').indexOf('慢慢来') >= 0, commentHasCoach: (r2.comment || '').indexOf('诺诺说') >= 0 });

  await browser.close();
  server.close();
  console.log(JSON.stringify(out, null, 1));
  const anyErr = out.some(o => o.errs && o.errs.length);
  const onlineOk = out.slice(0, 7).every(o => o.hit >= 1 && o.loop >= 1 && o.aiFunnelInBuildStat && o.funnelCardHasRows && o.coachReplaced);
  const offlineOk = out[7].miss >= 1 && out[7].commentHasTemplate && !out[7].commentHasCoach;
  const buildStatOk = out.slice(0, 7).every(o => o.buildStatAiFunnelHit >= 1);
  const profileOk = !!profileCaptured && (profileCaptured.hit || 0) >= 1;
  console.log('ONLINE_OK=' + onlineOk, 'OFFLINE_OK=' + offlineOk, 'BUILDSTAT_OK=' + buildStatOk, 'PROFILE_OK=' + profileOk, 'NO_PAGEERROR=' + !anyErr);
  console.log(onlineOk && offlineOk && buildStatOk && profileOk && !anyErr ? 'ALL_PASS' : 'HAS_FAILURE');
})();
