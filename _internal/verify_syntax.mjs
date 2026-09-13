// 临时语法校验：抽取 index.html 内联 <script> 块做 vm 解析（不执行），捕获白屏级语法错误
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 仅抽取无 src 属性的内联 <script>...</script>
const re = /<script>([\s\S]*?)<\/script>/g;
let m, n = 0, errs = 0;
while ((m = re.exec(html))) {
  n++;
  const code = m[1];
  try {
    new vm.Script(code, { filename: `inline#${n}` });
    console.log(`✓ inline script #${n} 语法 OK (${code.length} chars)`);
  } catch (e) {
    errs++;
    console.error(`✗ inline script #${n} 语法错误: ${e.message}`);
    // 打印附近上下文
    const lines = code.split('\n');
    console.error(`  (块内有 ${lines.length} 行)`);
  }
}
console.log(`\n内联脚本: ${n} 个, 语法错误: ${errs} 个`);

// ─────────────────────────────────────────────────────────────────────────
// v0.23.8 FIX：仓库根目录的独立 JS 也必须查语法。
// 原来这里只查 index.html 内联块 + 几个 JSON ⇒ **sw.js 从来没被这道闸门看过**，
// 于是 v0.22.0 起那 15 条裸路径（SyntaxError）一路带到 v0.23.7 上线，
// Service Worker 静默注册失败 8 个版本都没人发现。闸门不覆盖出错的文件 = 假绿。
//
// 按「真实运行时的模块类型」分别解析（package.json 无 "type":"module"）：
//   sw.js      → 经典脚本（CJS），vm.Script 直接解析即可
//   _worker.js → CF Pages advanced mode，运行时按 **ESM** 解析（含 import / export default）
//                ⇒ 必须复制成 .mjs 再 node --check，用 vm.Script 会误报
//                  「Cannot use import statement outside a module」
// ─────────────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sinoky-syn-'));
const ROOT_JS = [
  { f: 'sw.js', mode: 'script' },
  { f: '_worker.js', mode: 'module' },
];
for (const { f, mode } of ROOT_JS) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) { console.log(`- ${f} 不存在，跳过`); continue; }
  const src = fs.readFileSync(p, 'utf8');
  try {
    if (mode === 'script') {
      new vm.Script(src, { filename: f });
    } else {
      const tmp = path.join(TMP, f.replace(/\.js$/, '') + '.mjs');
      fs.writeFileSync(tmp, src);
      const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n').slice(0, 3).join(' | '));
    }
    console.log(`✓ ${f} 语法 OK (${mode})`);
  } catch (e) {
    errs++;
    console.error(`✗ ${f} 语法错误: ${e.message}`);
  }
}
fs.rmSync(TMP, { recursive: true, force: true });

// 校验新增 JSON
for (const f of ['data/flashcards.hsk1.json', 'data/flashcards.hsk2.json', 'data/flashcards.hsk3.json', 'data/flashcards-levels.json', 'version.json']) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    console.log(`✓ ${f} JSON OK (keys: ${Object.keys(j).join(',')})`);
  } catch (e) {
    errs++;
    console.error(`✗ ${f} JSON 错误: ${e.message}`);
  }
}
process.exit(errs ? 1 : 0);
