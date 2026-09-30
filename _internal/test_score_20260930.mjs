/* 2026-09-30 评分系统「真跑」单测（product-claim-vs-production-audit · L2 层）
   被测：_worker.js 的 scoreSyllables（经副本 _score_probe.mjs 真 import，用真 pinyin-pro）
   覆盖：评分逻辑（声母/韵母/调加权）、overall 换算、verdict 三档阈值、边界（缺音节/多音节/空/标点）
         以及 /api/score HTTP 端点契约（合法→200、缺参→400）。
   用法：node _internal/test_score_20260930.mjs
   退出码：0 全过 / 1 有失败 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* 自愈：若 worker 副本不存在则从 _worker.js 生成（副本必须与原文件同目录，相对 import 才解析得到） */
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const PROBE = path.join(ROOT, '_score_probe.mjs');
if (!fs.existsSync(PROBE)) {
  fs.writeFileSync(PROBE, fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8') + '\nexport { scoreSyllables, parsePy, cmp, ensurePinyin };\n');
  console.log('[gen] 已生成 worker 副本 _score_probe.mjs');
}
const mod = await import('../_score_probe.mjs');
const worker = mod.default, scoreSyllables = mod.scoreSyllables, ensurePinyin = mod.ensurePinyin;

const py = await ensurePinyin();
let pass = 0, fail = 0;
const rows = [];
function check(name, cond, detail) {
  (cond ? pass++ : fail++);
  rows.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? '✅' : '❌') + ' ' + name + (detail ? '   ' + detail : ''));
}

/* ---- A. 评分逻辑与结果准确性（算法直测）---- */
let r;

r = scoreSyllables('你好', '你好', py);
check('A1 满分 你好 vs 你好 → overall 100 / Great / 全音节 1.0',
  r.overall === 100 && r.verdict.includes('Great') && r.n === 2 &&
  r.perSyll.every(s => s.score === 1 && s.toneOk === true),
  JSON.stringify({ o: r.overall, v: r.verdict, s: r.perSyll.map(x => x.score) }));

r = scoreSyllables('你好', '你', py);
check('A2 缺音节 你好 vs 你 → overall 50 / Retry / 第2音节 missing',
  r.overall === 50 && r.verdict.includes('Retry') && r.perSyll[1].errs.includes('missing syllable'),
  JSON.stringify({ o: r.overall, s: r.perSyll.map(x => x.score), e: r.perSyll[1].errs }));

r = scoreSyllables('你好', '泥好', py);
check('A3 声调错 你好 vs 泥好 → overall 75 / Pass / 第1音节 toneOk=false',
  r.overall === 75 && r.verdict.includes('Pass') && r.perSyll[0].toneOk === false && r.perSyll[0].errs.includes('tone'),
  JSON.stringify({ o: r.overall, v: r.verdict, p0: r.perSyll[0] }));

r = scoreSyllables('是', '时', py);
check('A4 单字声调错 是(shì) vs 时(shí) → 50 / 韵母声母对、调错',
  r.overall === 50 && r.perSyll[0].errs.includes('tone') && r.perSyll[0].errs.indexOf('initial') < 0 && r.perSyll[0].errs.indexOf('final') < 0,
  JSON.stringify({ o: r.overall, e: r.perSyll[0].errs }));

r = scoreSyllables('你', '你好', py);
check('A5 多音节 你 vs 你好 → 50（目标第2音节 missing）',
  r.overall === 50 && r.perSyll[1].errs.includes('missing syllable'),
  JSON.stringify({ o: r.overall }));

r = scoreSyllables('你好！', '你好', py);
check('A6 标点归一 你好！vs 你好 → 100（nonZh removed）',
  r.overall === 100, JSON.stringify({ o: r.overall, n: r.n }));

r = scoreSyllables('你好', '', py);
check('A7 空 user 你好 vs "" → 0，不抛异常', r.overall === 0, JSON.stringify({ o: r.overall, n: r.n }));

r = scoreSyllables('', '你好', py);
check('A8 空 target "" vs 你好 → 0', r.overall === 0, JSON.stringify({ o: r.overall, n: r.n }));

r = scoreSyllables('一二三四五六七八九十', '一二三四五六七八九十', py);
check('A9 长句满分 10 字 → 100', r.overall === 100 && r.n === 10, JSON.stringify({ o: r.overall, n: r.n }));

/* verdict 三档阈值（>=85 Great / >=70 Pass / else Retry）—— 由 A1/A3/A2 三例覆盖边界两侧 */

/* ---- B. /api/score HTTP 端点契约（真调 handler，env={} 走内存限流兜底）---- */
async function callScore(body, hdrs) {
  const req = new Request('https://sinoky.pages.dev/api/score', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs || {}),
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, {});
  let j = null; try { j = await res.json(); } catch (e) {}
  return { status: res.status, j };
}
try {
  const e1 = await callScore({ target: '你好', user: '你好' });
  check('B1 端点 合法请求 → 200 + overall 100', e1.status === 200 && e1.j && e1.j.overall === 100,
    JSON.stringify({ s: e1.status, o: e1.j && e1.j.overall }));

  const e2 = await callScore({});
  check('B2 端点 缺参数 → 400 + error', e2.status === 400 && e2.j && !!e2.j.error,
    JSON.stringify({ s: e2.status, e: e2.j && e2.j.error }));

  const e3 = await callScore({ target: '你好' });
  check('B3 端点 缺 user → 400', e3.status === 400, JSON.stringify({ s: e3.status }));

  const e4 = await callScore({ target: '你好', user: '你好' }, { origin: 'https://evil.example.com' });
  check('B4 端点 跨站 Origin → 403（Origin 门生效）', e4.status === 403,
    JSON.stringify({ s: e4.status, e: e4.j && e4.j.error }));
} catch (e) {
  check('B 端点契约（真调 handler）', false, 'handler 抛错：' + e.message);
}

console.log('\n=== 评分单测结果：' + pass + '/' + (pass + fail) + ' 通过 ===');
process.exit(fail ? 1 : 0);
