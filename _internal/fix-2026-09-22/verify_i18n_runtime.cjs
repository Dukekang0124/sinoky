/* i18n 修复运行时验证 v1（2026-09-22）
 * 覆盖：7 语加载无 fallback / SK.showLimitWall + maybeExtendSentence 本地化 / 无 {x} 残留 / 无 pageerror
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..');
const LANGS = ['en', 'zh', 'es', 'ru', 'vi', 'id', 'th'];
const MIME = { '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}'); return;                     // 所有未知请求（含 /api/*）回空 JSON
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8642, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  let fail = 0;

  for (const L of LANGS) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(([lang]) => {
      try {
        localStorage.setItem('sinoky_state', JSON.stringify({ onboarded: true, lang: lang }));
      } catch (e) {}
    }, [L]);
    await page.route('**/api/**', r => r.fulfill({ json: {} }));
    await page.goto('http://127.0.0.1:8642/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2500);          // 等语言包 fetch + applyI18n

    const r = await page.evaluate(async ([lang]) => {
      const out = {};
      try {
        // 1) fallback 检测：字典里每个有译文的 key，T(k) 必须不等于 k
        const cur = (typeof curLang === 'function') ? curLang() : 'en';
        out.curLang = cur;
        const pack = (window.LANG_PACK && window.LANG_PACK[cur]) || {};
        const T = (typeof window.T === 'function') ? window.T : (k => k);
        const fb = [];
        for (const k of Object.keys(pack)) {
          if (pack[k] === k) continue;        // 品牌/同形
          if (T(k) === k) fb.push(k);
        }
        out.fbCount = fb.length; out.fbSample = fb.slice(0, 5);

        // 2) 限额墙（web 分支 + chat 特化文案）
        window.SK.showLimitWall('chat');
        await new Promise(r2 => setTimeout(r2, 120));
        const wall = document.getElementById('limitWall');
        out.wallText = wall ? wall.innerText.replace(/\s+/g, ' ').slice(0, 220) : 'MISSING';
        if (wall) wall.remove();

        // 3) 接一句弹层
        window.SK.maybeExtendSentence({ hz: '你好' });
        await new Promise(r2 => setTimeout(r2, 120));
        const ext = document.getElementById('extendModal');
        out.extText = ext ? ext.innerText.replace(/\s+/g, ' ').slice(0, 220) : 'MISSING';
        if (ext) ext.remove();

        // 4) 额度卡
        window.SK.renderQuotaUI();
        await new Promise(r2 => setTimeout(r2, 120));
        const qc = document.getElementById('quotaCard');
        out.quotaText = qc ? qc.innerText.replace(/\s+/g, ' ').slice(0, 200) : 'MISSING';
        if (qc) qc.remove();

        // 5) 占位符残留（innerText：排除 script/style 源码中的字面量）
        out.placeholders = (document.body.innerText.match(/\{(wx|hz|en|n|x)\}/g) || []).length;
      } catch (e) { out.err = String(e); }
      return out;
    }, [L]);

    const cjkIn = s => /[\u4e00-\u9fff]/.test(s);
    const problems = [];
    if (r.err) problems.push('eval err: ' + r.err);
    if (errors.length) problems.push('pageerror: ' + errors[0]);
    if (L !== 'en' && r.fbCount > 0) problems.push('fallback ' + r.fbCount + ': ' + r.fbSample.join(' | '));
    if (r.wallText === 'MISSING' || r.extText === 'MISSING' || r.quotaText === 'MISSING') problems.push('panel missing');
    if (r.placeholders > 0) problems.push('placeholders residue: ' + r.placeholders);
    if (L === 'zh' && (cjkIn(r.wallText) === false || cjkIn(r.extText) === false)) problems.push('zh 未显示中文');
    if (['en', 'es', 'ru', 'vi', 'id', 'th'].includes(L)) {
      const extUi = r.extText.replace(/你好/g, '');
      if (cjkIn(r.wallText) || cjkIn(extUi) || cjkIn(r.quotaText)) problems.push('非中文语种出现中文');
    }
    if (L === 'ru' && !/[\u0400-\u04FF]/.test(r.quotaText)) problems.push('ru 无西里尔');
    if (L === 'th' && !/[\u0E00-\u0E7F]/.test(r.quotaText)) problems.push('th 无泰文');

    const cjkSnip = (r.wallText + '|' + r.extText + '|' + r.quotaText).match(/[^|]*[\u4e00-\u9fff][^|]*/g) || [];
    if (problems.includes('非中文语种出现中文')) console.log('   [' + L + '] CJK snippets: ' + JSON.stringify(cjkSnip));
    const ok = problems.length === 0;
    if (!ok) fail++;
    results.push({ lang: L, ok, problems, wall: r.wallText.slice(0, 90), ext: r.extText.slice(0, 90) });
    await ctx.close();
  }

  await browser.close();
  server.close();
  for (const r of results) {
    console.log((r.ok ? 'PASS' : 'FAIL') + ' [' + r.lang + ']' + (r.ok ? '' : ' ' + r.problems.join(' ; ')));
    console.log('   wall: ' + r.wall);
    console.log('   ext : ' + r.ext);
  }
  console.log(fail === 0 ? 'ALL_7_LANGS_PASS' : ('FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})();
