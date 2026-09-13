/**
 * test_credits_gate.mjs —— 证明署名闸门真的会咬（Sinoky v0.23.8 FIX · 组 4）
 *
 * 「闸门通过」有两种可能：①真的没问题 ②闸门根本不会响。
 * 只有变异测试能区分这两者 —— 往沙箱里注入**已知缺陷**，闸门必须在对应段报错并 exit 1。
 *
 * 沙箱做法：mkdtemp 里放 index.html + credits.html + vendor/，用 --root 指过去，
 * 完全不碰工作区。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const GATE = path.join(APP, 'scripts', 'check-credits.mjs');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2705 ' + m); };
const no = (m) => { fail++; console.log('  \u274c ' + m); };

/** 真 vendor/ 下的库文件名（只取文件名，内容用桩 —— 闸门只看文件名） */
const VENDOR_STUBS = ['hanzi-writer.min.js', 'pinyin-pro.bundle.mjs', 'vconsole.min.js'];

/**
 * 造一个可跑的沙箱；mutate(沙箱目录) 里改文件。
 *
 * ⚠️ 踩坑：最初用 `fs.cpSync('vendor', …)` 复制真目录 —— **node 进程被静默杀掉**
 *    （exit 127、零输出、无异常）。vendor/pinyin-pro 是 {common,core,data} 三层子树，
 *    疑似被沙箱的文件操作守卫拦下。改用「写桩文件」后正常。
 *    教训：沙箱/测试里尽量避免对大目录做递归复制，用最小桩件。
 */
function sandbox(mutate) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sinoky-cred-'));
  fs.mkdirSync(path.join(d, 'vendor'), { recursive: true });
  for (const n of VENDOR_STUBS) fs.writeFileSync(path.join(d, 'vendor', n), '// stub\n');
  for (const f of ['index.html', 'credits.html']) {
    fs.copyFileSync(path.join(APP, f), path.join(d, f));
  }
  if (mutate) mutate(d);
  const r = spawnSync(process.execPath, [GATE, '--root', d], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), dir: d };
}

const runClean = () => {
  const r = sandbox(null);
  return r;
};

// ── 基线 ──
console.log('\n=== 基线：未变异 ===');
{
  const r = runClean();
  r.code === 0 ? ok('B0 exit 0（无缺陷时应当通过）') : no('B0 未变异却失败：' + r.out.slice(-400));
}

// ── M1：新增一个没登记的 vendor 库 ──
console.log('\n=== M1：往 vendor/ 丢一个未登记的新库 ===');
{
  const r = sandbox((d) => {
    fs.writeFileSync(path.join(d, 'vendor', 'brand-new-lib.min.js'), '// whatever\n');
  });
  r.code === 1 ? ok('M1 exit 1（闸门拦住了未登记的新库）') : no('M1 竟然通过了 —— A 段没咬住');
  /brand-new-lib.*未登记/.test(r.out) ? ok('M1 报出具体是哪个库') : no('M1 报错信息没点名：' + r.out.slice(-300));
}

// ── M2：从 credits.html 删掉一个条目 ──
console.log('\n=== M2：credits.html 删掉 qrcode-generator ===');
{
  const r = sandbox((d) => {
    const p = path.join(d, 'credits.html');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/qrcode-generator/g, 'qqq'));
  });
  r.code === 1 ? ok('M2 exit 1（C 段咬住）') : no('M2 竟然通过了 —— C 段没咬住');
  /credits\.html 缺/.test(r.out) ? ok('M2 报出是 credits.html 缺条目') : no('M2 报错不明确');
}

// ── M3：把产品内鸣谢块整段删掉 ──
console.log('\n=== M3：index.html 删掉 <details class="attr"> 整块 ===');
{
  const r = sandbox((d) => {
    const p = path.join(d, 'index.html');
    const s = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, s.replace(/<details class="attr">[\s\S]*?<\/details>/, ''));
  });
  r.code === 1 ? ok('M3 exit 1（B 段咬住）') : no('M3 竟然通过了 —— B 段没咬住');
  /找不到 <details class="attr">/.test(r.out) ? ok('M3 明确报「找不到鸣谢块」') : no('M3 报错不明确');
}

// ── M4：鸣谢块里漏掉 qrcode-generator（真实复发形态）──
console.log('\n=== M4：鸣谢块漏掉 qrcode-generator（复现 v0.23.6 那次）===');
{
  const r = sandbox((d) => {
    const p = path.join(d, 'index.html');
    const s = fs.readFileSync(p, 'utf8');
    // 只改鸣谢块内部，credits.html 保持有 —— 精确复现「加库忘写产品内鸣谢」
    const m = s.match(/<details class="attr">[\s\S]*?<\/details>/);
    fs.writeFileSync(p, s.replace(m[0], m[0].replace(/qrcode-generator/g, 'zzz')));
  });
  r.code === 1 ? ok('M4 exit 1（复现的复发形态被拦住）') : no('M4 竟然通过了');
  /鸣谢块缺「qrcode-generator」/.test(r.out) ? ok('M4 报出鸣谢块缺哪一项') : no('M4 报错不明确：' + r.out.slice(-300));
}

// ── M5：内联库标记未登记 ──
console.log('\n=== M5：内联一个新库但没登记 ===');
{
  const r = sandbox((d) => {
    const p = path.join(d, 'index.html');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
      + '\n<script>\n/* --- 内联 some-new-encoder v1.0.0 · MIT --- */\n</script>\n');
  });
  r.code === 1 ? ok('M5 exit 1（发现层咬住内联库）') : no('M5 竟然通过了');
  /内联库 some-new-encoder 未登记/.test(r.out) ? ok('M5 报出未登记的内联库') : no('M5 报错不明确');
}

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('──────────────────────────────');
process.exit(fail ? 1 : 0);
