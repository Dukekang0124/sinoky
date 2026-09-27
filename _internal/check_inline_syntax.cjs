/* check_inline_syntax.cjs —— 单文件 PWA 的 HTML 内联 <script> 逐块语法检查。
   为什么需要：index.html 内联 JS 无法用 `node --check`（不是 .js 文件），
   构建闸门 build-web.mjs 只做根目录归类断言，不解析 JS。
   用法：node _internal/check_inline_syntax.cjs [path/to/index.html] */
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;              // 外链脚本跳过
  if (/type\s*=\s*["'](?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
  const code = m[2];
  if (!code.trim()) continue;
  n++;
  const line = html.slice(0, m.index).split('\n').length;
  try { new Function(code); }
  catch (e) { bad++; console.log('❌ 第 ' + line + ' 行起的 script 块语法错误: ' + e.message); }
}
console.log((bad ? '❌ ' : '✅ ') + '内联 script 块共 ' + n + ' 个，语法错误 ' + bad + ' 个');
process.exit(bad ? 1 : 0);
