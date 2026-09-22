// v0.23.15 LLM 渗透运行时验收：coach 在线替换 + 离线兜底 + aiWeak 写入 + aiWeakHtml 渲染 + 7 语言无 pageerror
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

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const out = [];
  const LANGS = ['en', 'zh', 'es', 'ru', 'vi', 'id', 'th'];

  for (const lang of LANGS) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    mkRoutes(page, false);
    await page.addInitScript(l => {
      localStorage.setItem('sinoky_state', JSON.stringify({ onboarded: true, lang: l }));
    }, lang);
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(async () => {
      window.NONO_LINE = { hz: '你好', py: 'nǐ hǎo', en: 'hello', key: 'test#0', scene: 'test' };
      window.NONO_MS = Date.now();
      window.asrText = async () => ({ ok: true, text: '泥好' });
      let p = document.getElementById('nono-practice');
      if (!p) { p = document.createElement('div'); p.id = 'nono-practice'; document.body.appendChild(p); }
      await nonoGrade(new Blob());
      await new Promise(res => setTimeout(res, 600));
      const box = p.querySelector('#np-comment');
      const aiw = (window.S && window.S.aiWeak && window.S.aiWeak.dims) || {};
      const aiHtml = (typeof aiWeakHtml === 'function') ? aiWeakHtml() : null;
      return { comment: box ? box.innerHTML : null, aiw, aiHasCard: !!aiHtml && aiHtml.indexOf('AI coach insights') >= 0 };
    });
    out.push({ lang, errs, commentHasCoach: (r.comment || '').indexOf('诺诺说') >= 0, aiw_tone3: r.aiw.tone3 || 0, aiHasCard: r.aiHasCard });
    await page.close();
  }

  // 离线兜底：coach 失败 → #np-comment 保持硬编码 comment（慢慢来），不被 AI 替换
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
    await new Promise(res => setTimeout(res, 600));
    const box = p.querySelector('#np-comment');
    return { comment: box ? box.innerHTML : null };
  });
  out.push({ scenario: 'offline-fallback', errs: errs2, commentHasCoach: (r2.comment || '').indexOf('诺诺说') >= 0, commentHasTemplate: (r2.comment || '').indexOf('慢慢来') >= 0 });

  await browser.close();
  server.close();
  console.log(JSON.stringify(out, null, 1));
  const anyErr = out.some(o => o.errs && o.errs.length);
  const onlineOk = out.slice(0, 7).every(o => o.commentHasCoach && o.aiw_tone3 >= 1 && o.aiHasCard);
  const offlineOk = out[7].commentHasTemplate && !out[7].commentHasCoach;
  console.log('ONLINE_OK=' + onlineOk, 'OFFLINE_OK=' + offlineOk, 'NO_PAGEERROR=' + !anyErr);
  console.log(onlineOk && offlineOk && !anyErr ? 'ALL_PASS' : 'HAS_FAILURE');
})();
