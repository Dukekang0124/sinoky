#!/usr/bin/env node
/* check_sw_assets.cjs —— P2-9：校验 sw.js ASSETS 预缓存清单里每条资源在仓库根存在。
   若任一资源缺失，caches.addAll(ASSETS) 会 reject → SW 永不激活 → 离线完全失效且可能卡旧版。
   建议接入 CI（apk.yml build 步骤前）：node _internal/tools/check_sw_assets.cjs
   退出码：0 = 全部存在 / 1 = 存在缺失。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SW = path.join(ROOT, 'sw.js');

function fail(msg) { console.error('[check_sw_assets] ' + msg); process.exit(1); }
if (!fs.existsSync(SW)) fail('找不到 sw.js：' + SW);

const src = fs.readFileSync(SW, 'utf8');
const m = src.match(/var\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);
if (!m) fail('sw.js 中未找到 ASSETS 数组');

// 去掉块注释，避免 /* ... */ 干扰字符串提取
const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
// 提取所有引号字符串（单/双）
const entries = [];
const re = /'([^']*)'|"([^"]*)"/g;
let mm;
while ((mm = re.exec(body))) entries.push(mm[1] !== undefined ? mm[1] : mm[2]);

if (!entries.length) fail('ASSETS 为空？');

let missing = 0;
for (const e of entries) {
  if (!e) continue;
  const rel = e.replace(/^\.\//, '');          // './x' -> 'x'，'.' -> '.'
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { missing++; console.error('  ✗ 缺失: ' + e + '  (' + fp + ')'); }
}
if (missing) {
  console.error('[check_sw_assets] 失败：' + missing + '/' + entries.length + ' 条资源缺失');
  process.exit(1);
}
console.log('[check_sw_assets] 通过：ASSETS 共 ' + entries.length + ' 条，全部存在');
process.exit(0);
