// 抽取 index.html 末尾的 AI script 块并做语法校验（node --check 等价）
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const anchor = '/* v0.23.15 AI 点评增强';
if (!html.includes(anchor)) { console.error('anchor not found'); process.exit(1); }
const s = html.lastIndexOf('<script>', html.indexOf(anchor));
const e = html.indexOf('</script>', html.indexOf(anchor));
if (s < 0 || e < 0 || e <= s) { console.error('block not found', s, e); process.exit(1); }
const code = html.slice(s + '<script>'.length, e);
console.log('extracted chars:', code.length);
writeFileSync(resolve(process.cwd(), '_internal/fix-2026-09-22/_ai_block.js'), code, 'utf8');
console.log('wrote _ai_block.js');
