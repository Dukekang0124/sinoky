/**
 * test_listen_pool.mjs —— 「听辨题库加数据即生效」的能力验证（v0.23.8 FIX · #42）
 *
 * 背景：LISTEN_Q 只有 1 组（ma），注释自称
 *   「康哥录完新音频往 LISTEN_Q 追加即可，前端零改动」。
 * —— 这是**注释里的声明**，没人验过。如果 pickListen/listenCardHtml 里藏着
 * 「只取 pool[0]」之类的隐含假设，追加数据就会静默失效（只有第 1 组出题）。
 *
 * 做法：在页面里把 window.LISTEN_Q 换成「1 组真数据 + N 组合成数据」，
 * 然后断言 listenPool / pickListen / listenCardHtml 全部按多组行为工作。
 * 合成数据的 audio 复用 TONES 的 base64 —— 本测试验的是**数据通路**，
 * 不是音频内容（音频内容由 test_tone_audio.mjs 单独验）。
 *
 * ⚠️ 本测试**不修改产品代码**，也不往产品里塞假音频：全部在浏览器内存里做。
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
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2705 ' + m); };
const no = (m) => { fail++; console.log('  \u274c ' + m); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serve(APP);
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });

    // ── 基线：不注入，先看现状 ──
    console.log('\n=== 基线（未注入）===');
    const base = await page.evaluate(() => ({
      groups: (window.LISTEN_Q || []).length,
      pool: (typeof listenPool === 'function') ? listenPool().length : -1,
      curDay: (typeof currentDay === 'function') ? currentDay() : -1,
    }));
    base.groups === 1 ? ok('B1 现状 LISTEN_Q = 1 组（与审计一致）') : no('B1 现状 ' + base.groups + ' 组');
    base.pool === 1 ? ok('B2 listenPool() = 1 组，currentDay = ' + base.curDay) : no('B2 pool=' + base.pool);

    // ── 注入：1 真 + 5 合成 + 2 个「应当被过滤」的 ──
    console.log('\n=== 注入 5 组合成数据后的行为 ===');
    const inj = await page.evaluate(() => {
      const real = window.LISTEN_Q[0];
      const mk = (syl, day, chars) => ({
        syl, day,
        opts: chars.map((c, i) => ({
          t: i + 1, py: c[1], hz: c[0], pya: c[0] + ':' + c[1], mean: c[2],
          audio: window.TONES[i].audio,     // 复用真音频，只验数据通路
        })),
      });
      const synth = [
        /* ⚠️ 踩坑：第一版把合成组写成 day:2/3/5/7，结果 pool 只有 2 组 —— 因为
           currentDay()=1，而 listenPool() 有一句「不超前：只出当天及以前的题」。
           那是**正确行为**，错的是我的预期。要验「多组都进池」，day 必须 ≤ 当前 Day；
           要验「超前被挡」，就单独放一个 day 很大的组（下面的 future）。 */
        mk('shi', 1, [['诗', 'shī', 'poem'], ['十', 'shí', 'ten'], ['使', 'shǐ', 'to make'], ['是', 'shì', 'to be']]),
        mk('qi', 1, [['七', 'qī', 'seven'], ['骑', 'qí', 'to ride'], ['起', 'qǐ', 'to rise'], ['气', 'qì', 'air']]),
        mk('wan', 1, [['弯', 'wān', 'to bend'], ['完', 'wán', 'to finish'], ['晚', 'wǎn', 'late'], ['万', 'wàn', 'ten thousand']]),
        mk('zhu', 1, [['猪', 'zhū', 'pig'], ['竹', 'zhú', 'bamboo'], ['主', 'zhǔ', 'host'], ['住', 'zhù', 'to live']]),
        mk('shu', 1, [['书', 'shū', 'book'], ['熟', 'shú', 'cooked'], ['数', 'shǔ', 'to count'], ['树', 'shù', 'tree']]),
        // ↓ 应被 listenPool 过滤掉的两组
        { syl: 'future', day: 9999, opts: [{ t: 1, py: 'x', hz: '未', pya: '未:x', mean: 'future', audio: window.TONES[0].audio }] },
        { syl: 'silent', day: 1, opts: [{ t: 1, py: 'y', hz: '空', pya: '空:y', mean: 'no audio', audio: '' }] },
      ];
      const bk = window.LISTEN_Q;
      window.LISTEN_Q = [real].concat(synth);
      const pool = listenPool();
      const out = {
        total: window.LISTEN_Q.length,
        poolLen: pool.length,
        syls: pool.map((g) => g.syl),
        curDay: currentDay(),
      };
      // 可达性：200 个 k 值里每组是否都被抽到过
      const seen = new Set();
      for (let k = 0; k < 200; k++) {
        const it = pickListen(k);
        if (it) seen.add(it.syl);
      }
      out.seen = [...seen].sort();
      // 渲染
      const html = listenCardHtml();
      out.htmlLen = html.length;
      out.hasPlayBtn = /id="ear-play"/.test(html);
      /* ⚠️ 别用 /class="earbtn/g —— 容器是 class="earbtns"，会被一起数进来（第一版就踩了）。 */
      out.btnCount = (html.match(/<button[^>]*class="earbtn"/g) || []).length;
      window.LISTEN_Q = bk;
      return out;
    });

    const wantSyls = ['ma', 'shi', 'qi', 'wan', 'zhu', 'shu'];
    inj.poolLen === 6 ? ok('I1 listenPool() 从 1 → 6 组（数据追加即生效，无隐含「只取第一组」）')
                      : no('I1 pool=' + inj.poolLen + ' 应为 6，实得 ' + JSON.stringify(inj.syls));
    !inj.syls.includes('future') ? ok('I2 day=9999 的超前组被过滤（不超前）') : no('I2 超前组漏进 pool');
    !inj.syls.includes('silent') ? ok('I3 无音频组被过滤（零空壳）') : no('I3 空音频组漏进 pool');
    wantSyls.every((s) => inj.seen.includes(s))
      ? ok('I4 200 次抽题里 6 组全部被抽到（不是每次都出第 1 组）：' + inj.seen.join(','))
      : no('I4 有组永远抽不到，实得 ' + inj.seen.join(','));
    inj.htmlLen > 200 && inj.hasPlayBtn ? ok('I5 listenCardHtml() 正常出卡（' + inj.htmlLen + ' 字符，含播放按钮）')
                                        : no('I5 出卡异常 len=' + inj.htmlLen);
    inj.btnCount === 4 ? ok('I6 答题按钮固定 4 个（四声）') : no('I6 按钮数 ' + inj.btnCount);

    // ── 答题计数闭环（用第 2 组验证，不再依赖 ma）──
    console.log('\n=== 答题计数闭环（多组下仍然正确）===');
    const ans = await page.evaluate(() => {
      const bk = window.LISTEN_Q;
      window.LISTEN_Q = bk.slice();
      S.listen = null; listenAns = -1;
      const it = listenCur();
      const correct = it.q.t;
      const before = S.listen ? S.listen.n : 0;
      answerListen(correct);
      const afterRight = { n: S.listen.n, r: S.listen.r };
      return { syl: it.syl, correct, before, afterRight };
    });
    ans.afterRight.n === 1 && ans.afterRight.r === 1
      ? ok('A1 答对记 n=1 r=1（题目来自 ' + ans.syl + ' 组）')
      : no('A1 计数异常 ' + JSON.stringify(ans));

    const ans2 = await page.evaluate(() => {
      S.listen = null; listenAns = -1;
      const it = listenCur();
      const wrong = (it.q.t % 4) + 1;
      answerListen(wrong);
      return { n: S.listen.n, r: S.listen.r, wrong, correct: it.q.t };
    });
    ans2.n === 1 && ans2.r === 0
      ? ok('A2 答错记 n=1 r=0（选了 ' + ans2.wrong + ' 正确是 ' + ans2.correct + '）')
      : no('A2 计数异常 ' + JSON.stringify(ans2));

    const ans3 = await page.evaluate(() => {
      listenAns = 0;                      // 标记已答
      answerListen(9);                    // 再答一次应被拒
      return { n: S.listen.n };
    });
    ans3.n === 1 ? ok('A3 一题只判一次（重复点击不重复计数）') : no('A3 重复计数 n=' + ans3.n);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n──────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('──────────────────────────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
