// test_i18n_gate.mjs —— 变异测试：证明 i18n 闸门真的会「咬」
//
// 为什么要这一步：一个永远都通过的闸门等于没有闸门。
// 这里做 3 个反向变异，每个都必须让闸门 exit 1（并命中对应那一段判据）：
//   M1 新增一条字典里没有的 T() 文案        → A 段必须报
//   M2 从某个字典删掉一个 key               → B 段必须报（对齐破裂）
//   M3 把某个字典的值改成空串               → C 段必须报
// 全部在临时目录上跑，不碰工作区。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const GATE = path.join(APP, 'scripts', 'check-i18n.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
};

function runGate(root) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status || 1, out: String((e.stdout || '')) + String((e.stderr || '')) };
  }
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinoky-i18n-'));
  fs.mkdirSync(path.join(dir, 'langs'), { recursive: true });
  fs.copyFileSync(path.join(APP, 'index.html'), path.join(dir, 'index.html'));
  for (const l of ['zh', 'es', 'ru', 'vi', 'id', 'th']) {
    fs.copyFileSync(path.join(APP, 'langs', l + '.json'), path.join(dir, 'langs', l + '.json'));
  }
  return dir;
}

console.log('\n=== 0. \u57fa\u7ebf\uff1a\u672a\u53d8\u5f02\u5e94\u901a\u8fc7 ===');
{
  const d = makeSandbox();
  const r = runGate(d);
  ok('M0 \u672a\u53d8\u5f02 \u2192 exit 0', r.code === 0, '\u5b9e\u9645 ' + r.code);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n=== M1. \u65b0\u589e\u4e00\u6761\u5b57\u5178\u91cc\u6ca1\u6709\u7684 T() \u6587\u6848 ===');
{
  const d = makeSandbox();
  const p = path.join(d, 'index.html');
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace('function buildStat(){', "function buildStat(){ var _x = T('MUTANT_STRING_NOT_IN_ANY_DICT');");
  fs.writeFileSync(p, s);
  const r = runGate(d);
  ok('M1 exit 1', r.code === 1, '\u5b9e\u9645 ' + r.code);
  ok('M1 \u62a5\u51fa A \u6bb5\u7f3a\u5931', /A\. T\(\) \u5b57\u9762\u91cf/.test(r.out) && r.out.includes('MUTANT_STRING_NOT_IN_ANY_DICT'), '');
  ok('M1 \u516d\u4e2a\u8bed\u8a00\u5168\u90e8\u62a5\u7f3a', (r.out.match(/\u7f3a 1 \u6761/g) || []).length === 6, '\u5b9e\u9645 ' + (r.out.match(/\u7f3a 1 \u6761/g) || []).length);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n=== M2. \u4ece zh \u5b57\u5178\u5220\u6389\u4e00\u4e2a key\uff08\u5bf9\u9f50\u7834\u88c2\uff09===');
{
  const d = makeSandbox();
  const zp = path.join(d, 'langs', 'zh.json');
  const z = JSON.parse(fs.readFileSync(zp, 'utf8'));
  const victim = Object.keys(z)[0];
  delete z[victim];
  fs.writeFileSync(zp, JSON.stringify(z, null, 2));
  const r = runGate(d);
  ok('M2 exit 1', r.code === 1, '\u5b9e\u9645 ' + r.code);
  ok('M2 \u62a5\u51fa B \u6bb5\u5bf9\u9f50\u5dee\u5f02', /B\. 6 \u4e2a\u5b57\u5178 key \u96c6\u5408\u4e00\u81f4/.test(r.out) && /\u5bf9\u9f50\u5dee\u5f02/.test(r.out), '');
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n=== M3. \u628a\u67d0\u5b57\u5178\u503c\u6539\u6210\u7a7a\u4e32 ===');
{
  const d = makeSandbox();
  const pp = path.join(d, 'langs', 'es.json');
  const e = JSON.parse(fs.readFileSync(pp, 'utf8'));
  const victim = Object.keys(e)[3];
  e[victim] = '   ';
  fs.writeFileSync(pp, JSON.stringify(e, null, 2));
  const r = runGate(d);
  ok('M3 exit 1', r.code === 1, '\u5b9e\u9645 ' + r.code);
  ok('M3 \u62a5\u51fa C \u6bb5\u7a7a\u503c', /C\. \u5b57\u5178\u503c\u4e0d\u5f97\u4e3a\u7a7a/.test(r.out) && /\u7a7a\u8bd1\u6587/.test(r.out), '');
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log('\u7ed3\u679c\uff1a' + pass + ' \u901a\u8fc7 / ' + fail + ' \u5931\u8d25');
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
process.exit(fail ? 1 : 0);
