#!/usr/bin/env node
/*
 * Sinoky i18n 闸门（v0.23.8 · 审计 P1-3）
 *
 * 为什么需要这道闸门：
 *   v0.21.1 出过「字典里明明有译文，界面却仍显示英文」的事故，
 *   根因是新增 UI 文案只写了英文原文、没同步进 6 个字典。
 *   这类缺陷在静态层完全静默 —— 页面照样渲染，只是切语言时那一句不生效，
 *   目视 + 语法检查 + 现有 smoke 全都抓不到。只有把「T() 字面量 ⊆ 字典 key」
 *   做成构建闸门，才会在引入问题的当下就失败。
 *
 * 判据（全部硬约束，任一不过即 exit 1）：
 *   A. index.html 里每个 T('...') / T("...") 字面量，必须在 6 个字典里都存在
 *   B. 6 个字典的 key 集合必须完全一致（互相对齐，否则总有语言漏翻）
 *   C. 字典值不得为空字符串（翻译漏成空比缺 key 更隐蔽：T() 会返回空，界面出现空白）
 *
 * 刻意不做「字典 key ⊆ T() 字面量」的反向断言：静态 HTML 文本节点也走字典
 * （applyI18n 的 TreeWalker），字典比 T() 调用宽是正常且必需的。
 *
 * 零依赖：只用 node: 内置模块，CI 不必 npm ci，跑得比安装还快。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// --root <dir> 便于变异测试在临时目录上跑（默认 = scripts/ 的上一级，即 sinoky-app/）
const RI = process.argv.indexOf('--root');
const APP = RI >= 0 ? path.resolve(process.argv[RI + 1]) : path.resolve(HERE, '..');

const LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th'];   // en 是源文，无字典
const IDX = path.join(APP, 'index.html');

let errors = 0;
const err = (m) => { errors++; console.error('  \u2717 ' + m); };
const info = (m) => console.log('  \u00b7 ' + m);

// ── 读字典
const packs = {};
for (const l of LANGS) {
  const p = path.join(APP, 'langs', l + '.json');
  if (!fs.existsSync(p)) { err('langs/' + l + '.json \u4e0d\u5b58\u5728'); packs[l] = {}; continue; }
  try {
    packs[l] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { err('langs/' + l + '.json \u89e3\u6790\u5931\u8d25\uff1a' + e.message); packs[l] = {}; }
}
if (errors) { console.error('\n\u5b57\u5178\u6587\u4ef6\u672c\u8eab\u6709\u95ee\u9898\uff0c\u540e\u7eed\u68c0\u67e5\u4e2d\u6b62\n'); process.exit(1); }

// ── 提取 index.html 里的 T() 字面量（含注入层；注入层用 window.T，文案同样必须进字典）
const html = fs.readFileSync(IDX, 'utf8');
const RE = /\bT\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
const keys = new Set();
let m;
while ((m = RE.exec(html)) !== null) {
  let k = m[2];
  // 还原 JS 字符串转义（\' \" \\ \n 等），否则 'don\'t' 会和字典里的 "don't" 对不上
  // v0.24.1 补：\uXXXX / \u{...} / \xXX 也必须还原。
  //   缺陷现场：T('\u{1F44B} New here?') 若不还原，闸门提取到的 key 是含反斜杠的
  //   字面文本，而运行时 key 是实际字符 '👋 New here?' —— 报的是「缺失」，但按它写进
  //   字典的 key 永远命不中（形状不匹配的第二类：不是标签差异，而是转义未还原）。
  k = k
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(['"\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  if (k) keys.add(k);
}
const keyArr = [...keys].sort();

console.log('== Sinoky i18n \u95f8\u95e8 ==');
console.log('\u5b57\u5178\uff1a' + LANGS.map((l) => l + '(' + Object.keys(packs[l]).length + ')').join('  '));
console.log('index.html \u91cc\u7684 T() \u5b57\u9762\u91cf\uff1a' + keyArr.length + ' \u6761\uff08\u53bb\u91cd\u540e\uff09\n');

// ── A. T() 字面量 ⊆ 每个字典
console.log('A. T() \u5b57\u9762\u91cf \u2286 \u6bcf\u4e2a\u5b57\u5178');
for (const l of LANGS) {
  const missing = keyArr.filter((k) => !Object.prototype.hasOwnProperty.call(packs[l], k));
  if (missing.length) {
    err('langs/' + l + '.json \u7f3a ' + missing.length + ' \u6761\uff1a');
    missing.slice(0, 25).forEach((k) => console.error('        - ' + JSON.stringify(k.slice(0, 90))));
    if (missing.length > 25) console.error('        \u2026\u2026 \u5171 ' + missing.length + ' \u6761');
  } else {
    info(l + '\uff1a\u5168\u90e8\u547d\u4e2d');
  }
}

// ── B. 6 个字典 key 集合一致
console.log('\nB. 6 \u4e2a\u5b57\u5178 key \u96c6\u5408\u4e00\u81f4');
const sets = LANGS.map((l) => new Set(Object.keys(packs[l])));
const base = sets[0];
for (let i = 1; i < LANGS.length; i++) {
  const onlyBase = [...base].filter((k) => !sets[i].has(k));
  const onlyOther = [...sets[i]].filter((k) => !base.has(k));
  if (onlyBase.length || onlyOther.length) {
    err(LANGS[0] + ' \u4e0e ' + LANGS[i] + ' \u5bf9\u9f50\u5dee\u5f02\uff1a' +
        LANGS[0] + ' \u72ec\u6709 ' + onlyBase.length + ' \u6761\uff0c' + LANGS[i] + ' \u72ec\u6709 ' + onlyOther.length + ' \u6761');
    onlyBase.slice(0, 5).forEach((k) => console.error('        ' + LANGS[0] + ' \u72ec\u6709\uff1a' + JSON.stringify(k.slice(0, 80))));
    onlyOther.slice(0, 5).forEach((k) => console.error('        ' + LANGS[i] + ' \u72ec\u6709\uff1a' + JSON.stringify(k.slice(0, 80))));
  } else {
    info(LANGS[0] + ' \u2194 ' + LANGS[i] + '\uff1a\u4e00\u81f4');
  }
}

// ── C. 空值检查
console.log('\nC. \u5b57\u5178\u503c\u4e0d\u5f97\u4e3a\u7a7a');
for (const l of LANGS) {
  const empties = Object.keys(packs[l]).filter((k) => !String(packs[l][k]).trim());
  if (empties.length) {
    err('langs/' + l + '.json \u6709 ' + empties.length + ' \u6761\u7a7a\u8bd1\u6587\uff1a' + empties.slice(0, 5).map((k) => JSON.stringify(k.slice(0, 60))).join('\uff0c'));
  } else {
    info(l + '\uff1a\u65e0\u7a7a\u503c');
  }
}

console.log('\n' + '\u2500'.repeat(46));
if (errors) {
  console.log('i18n \u95f8\u95e8\u672a\u901a\u8fc7\uff1a' + errors + ' \u5904\u95ee\u9898');
  console.log('\u4fee\u6cd5\uff1a\u65b0\u589e\u7684\u82f1\u6587\u539f\u6587\uff08\u542b T() \u5b57\u9762\u91cf\uff09\u5fc5\u987b\u540c\u6b65\u5199\u8fdb langs/ \u4e0b\u7684 6 \u4e2a\u5b57\u5178\u3002');
  console.log('\u2500'.repeat(46));
  process.exit(1);
}
console.log('i18n \u95f8\u95e8\u901a\u8fc7 \u2014 ' + keyArr.length + ' \u6761 T() \u5b57\u9762\u91cf\u5168\u90e8\u547d\u4e2d\uff0c6 \u4e2a\u5b57\u5178\u4e92\u76f8\u5bf9\u9f50');
console.log('\u2500'.repeat(46));
