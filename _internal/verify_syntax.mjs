// 临时语法校验：抽取 index.html 内联 <script> 块做 vm 解析（不执行），捕获白屏级语法错误
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
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
