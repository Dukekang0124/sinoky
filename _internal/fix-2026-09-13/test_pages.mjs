/**
 * test_pages.mjs —— 静态页渲染验收（v0.23.8 FIX · #41 落地页 + #39 credits.html）
 *
 * 为什么不靠 grep：审计原话说「落地页零诺诺，grep mascot|nono|.webp 零命中」。
 * 实测 landing/index.html v0.22.0 起就有 `.nono-hero`（nono-hero.webp 480×600）+ 跟读句。
 * grep 命中 ≠ 页面能用 —— 图片路径写错、CSS 挡住、webp 不被支持……
 * 这些只有**渲染后看 naturalWidth** 才知道。所以这里用浏览器真跑。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2705 ' + m); };
const no = (m) => { fail++; console.log('  \u274c ' + m); };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
};

function serve(root) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(root, rel);
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        const alt = path.join(root, rel, 'index.html');
        if (fs.existsSync(alt)) {
          resp.writeHead(200, { 'Content-Type': MIME['.html'] }); return resp.end(fs.readFileSync(alt));
        }
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serve(APP);
  const base = 'http://127.0.0.1:' + port;
  try {
    // ═════════ #41 落地页 ═════════
    console.log('\n=== #41 落地页 /landing/ ===');
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const bad = [];
      page.on('requestfailed', (r) => bad.push(r.url()));
      const resp = await page.goto(base + '/landing/', { waitUntil: 'load' });
      resp.status() === 200 ? ok('L1 HTTP 200') : no('L1 状态 ' + resp.status());

      const fig = await page.$('.nono-hero-fig');
      if (!fig) no('L2 找不到 .nono-hero-fig（诺诺不在首屏）');
      else {
        const info = await fig.evaluate((el) => ({
          nw: el.naturalWidth, nh: el.naturalHeight, w: el.clientWidth,
          vis: getComputedStyle(el).display !== 'none' && el.clientWidth > 40,
          src: el.getAttribute('src'),
        }));
        info.nw > 0 ? ok('L2 诺诺图真的加载了（naturalWidth=' + info.nw + '×' + info.nh + ' src=' + info.src + '）')
                    : no('L2 诺诺图 404/未解码（naturalWidth=0，src=' + info.src + '）');
        info.vis ? ok('L3 诺诺图可见且渲染宽度 ' + info.w + 'px') : no('L3 诺诺图被隐藏或尺寸为 0');
      }

      const say = await page.evaluate(() => {
        const q = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
        return { hz: q('.nono-say .ns-hz'), py: q('.nono-say .ns-py'), en: q('.nono-say .ns-en') };
      });
      say.hz === '你好' ? ok('L4 可跟读中文句在位：「' + say.hz + ' ' + say.py + '」')
                       : no('L4 跟读句缺失：' + JSON.stringify(say));
      say.en && /say it out loud/i.test(say.en) ? ok('L5 有「说出口」的行动号召：' + JSON.stringify(say.en))
                                                : no('L5 缺 CTA：' + JSON.stringify(say.en));

      bad.length === 0 ? ok('L6 首屏零请求失败') : no('L6 请求失败：' + bad.slice(0, 4).join(' / '));

      await page.screenshot({ path: path.join(HERE, 'tmp', 'landing_hero.png'), clip: { x: 0, y: 0, width: 1280, height: 900 } });
      console.log('     ↳ 截图 _internal/fix-2026-09-13/tmp/landing_hero.png');
      await ctx.close();
    }

    // ═════════ #39 credits.html ═════════
    console.log('\n=== #39 credits.html ===');
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const resp = await page.goto(base + '/credits.html', { waitUntil: 'load' });
      resp.status() === 200 ? ok('C1 HTTP 200') : no('C1 状态 ' + resp.status());
      const r = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          hasArphic: t.includes('Arphic'),
          hasQr: t.includes('qrcode-generator'),
          hasTts: /Microsoft Edge/.test(t),
          link: !!document.querySelector('a[href="ARPHICPL.TXT"]'),
          back: !!document.querySelector('a.back[href="./"]'),
          js: document.querySelectorAll('script').length,
        };
      });
      r.hasArphic ? ok('C2 列了 Arphic（APL 署名）') : no('C2 缺 Arphic');
      r.hasQr ? ok('C3 列了 qrcode-generator（v0.23.6 补的漏项）') : no('C3 缺 qrcode-generator');
      r.hasTts ? ok('C4 披露了 Microsoft Edge TTS（修正过度声明）') : no('C4 未披露 TTS');
      r.link ? ok('C5 可点进 ARPHICPL.TXT 许可全文') : no('C5 许可全文链接缺失');
      r.back ? ok('C6 有回主站出口') : no('C6 无返回链接');
      r.js === 0 ? ok('C7 零 JS（页面不依赖脚本，合规页最稳）') : no('C7 含 ' + r.js + ' 个 script，应零 JS');

      // 真点一次许可链接（同源 .txt 应在标签页打开且 200）
      const [p2] = await Promise.all([ctx.waitForEvent('page'), page.click('a[href="ARPHICPL.TXT"]')]);
      await p2.waitForLoadState('domcontentloaded');
      const txt = await p2.evaluate(() => document.body.innerText.slice(0, 40));
      /ARPHIC PUBLIC LICENSE/.test(txt) ? ok('C8 点开后拿到真许可全文：' + JSON.stringify(txt.slice(0, 30)))
                                        : no('C8 许可全文未命中：' + JSON.stringify(txt));
      await ctx.close();
    }

    // ═════════ 产品内鸣谢块 ═════════
    console.log('\n=== 产品内鸣谢块（index.html 页脚）===');
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'load' });
      // 走到 me/prog 视图才能看到页脚；直接断言 details.attr 存在于 DOM
      const r = await page.evaluate(() => {
        const d = document.querySelector('details.attr');
        if (!d) return null;
        return { text: d.textContent, sum: d.querySelector('summary') && d.querySelector('summary').textContent };
      });
      if (!r) no('A1 找不到 details.attr');
      else {
        r.text.includes('qrcode-generator') ? ok('A2 产品内鸣谢含 qrcode-generator') : no('A2 缺 qrcode-generator');
        /* ⚠️ 断言不能绑死英文：页面加载后 applyI18n 会把文案换成当前语言
           （zh 下 'Microsoft Edge' → '微软 Edge'）。用语言无关的 'Edge'。 */
        /Edge/.test(r.text) ? ok('A3 产品内鸣谢含 TTS 披露（语言无关判据 /Edge/）') : no('A3 缺 TTS 披露');
        /credits\.html/.test(r.text) || true; // 链接是 a[href]，textContent 不含；下面单独查
        const hasLink = await page.evaluate(() => !!document.querySelector('details.attr a[href="credits.html"]'));
        hasLink ? ok('A4 产品内鸣谢链到 credits.html') : no('A4 缺 credits.html 链接');
        const lang = await page.evaluate(() => document.documentElement.lang || document.querySelector('.i18n-lang')?.value || '?');
        console.log('     ↳ 当前界面语言 lang=' + lang + '（可解释 A3 为何要语言无关判据）');
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n──────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('──────────────────────────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
