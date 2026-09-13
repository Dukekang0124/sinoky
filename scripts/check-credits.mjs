#!/usr/bin/env node
/**
 * check-credits.mjs —— 第三方素材署名闸门（Sinoky v0.23.8 FIX · 组 4）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要有这个闸门（防的是「已发生过的复发形态」）
 * ══════════════════════════════════════════════════════════════════════
 * v0.23.6 内联了 qrcode-generator（MIT，Kazuhiko Arase）。
 * 源码里那句版权头**保留了**（MIT 义务已履行），但**用户可见的鸣谢清单里没有它**。
 * 也就是说：加一个库 = 一个静默的合规缺口，而每个库的许可证要求各不相同。
 * 人工记两处清单（产品内鸣谢 + credits.html）一定会漏 —— 所以交给闸门。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 三段断言
 * ══════════════════════════════════════════════════════════════════════
 * A. **发现层**：`vendor/` 下每个库文件、以及 index.html 里每个 `/* --- 内联 <名>` 标记，
 *    都必须在 REGISTRY 里有条目。
 *    ⇒ 忘登记新库 ⇒ fail（这是主力断言，逼人登记）
 * B. **产品内层**：REGISTRY 每个 key 都要出现在 index.html 的 `<details class="attr">`
 *    鸣谢块里。⇒ 登记了但没写进产品 ⇒ fail
 * C. **落地页层**：REGISTRY 每个 key 都要出现在 credits.html。
 *    ⇒ 有一个稳定 URL 可引用（合规/商店审核需要）
 *
 * 零依赖，只用 node: 内置。CI 直接 `node scripts/check-credits.mjs`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');

const RI = process.argv.indexOf('--root');
const ROOT = RI >= 0 ? path.resolve(process.argv[RI + 1]) : APP;

/* ────────────────────────────────────────────────────────────────────
   REGISTRY：第三方组件 / 数据 / 服务登记表
   key   = 在产品内鸣谢块与 credits.html 里必须**字面出现**的名字
   src   = 它从哪来（文件路径，或 `inline:` / `runtime:` 说明）
   ──────────────────────────────────────────────────────────────────── */
const REGISTRY = [
  { key: 'Hanzi Writer', src: ['vendor/hanzi-writer.min.js'] },
  { key: 'Make Me a Hanzi', src: ['data/strokes/'] },
  { key: 'Arphic', src: ['ARPHICPL.TXT'] },
  { key: 'pinyin-pro', src: ['vendor/pinyin-pro.bundle.mjs'] },
  { key: 'vConsole', src: ['vendor/vconsole.min.js'] },
  { key: 'qrcode-generator', src: ['inline:index.html'] },
  { key: 'Microsoft Edge', src: ['runtime:/api/tts'] },
];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const no = (m) => { fail++; console.log('  \u2717 ' + m); };

const read = (p) => fs.readFileSync(p, 'utf8');
const idx = read(path.join(ROOT, 'index.html'));
const creditsPath = path.join(ROOT, 'credits.html');
const credits = fs.existsSync(creditsPath) ? read(creditsPath) : null;

/* ── 提取产品内鸣谢块 ── */
const mAttr = idx.match(/<details class="attr">([\s\S]*?)<\/details>/);
const attrBlock = mAttr ? mAttr[1] : '';

/* ────────── A. 发现层：新增库必须登记 ────────── */
console.log('\nA. 发现层 —— vendor/ 与内联库是否都已登记');

const vendDir = path.join(ROOT, 'vendor');
const vendorStems = fs.existsSync(vendDir)
  ? fs.readdirSync(vendDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(m?js)$/.test(e.name))
      .map((e) => e.name.replace(/\.(min\.)?(bundle\.)?m?js$/, ''))
  : [];

const known = REGISTRY.map((r) => norm(r.key));
for (const stem of vendorStems) {
  const n = norm(stem);
  // 允许前缀包含（如 `hanzi-writer` ⊂ `Hanzi Writer`）
  const hit = known.some((k) => k === n || k.includes(n) || n.includes(k));
  hit ? ok('vendor/' + stem + ' 已登记') : no('vendor/' + stem + ' 未登记 —— 请在 REGISTRY 加条目并写入两处鸣谢');
}

// 内联库标记：`/* --- 内联 qrcode-generator v1.4.4 · MIT ...`
const inlineNames = [...idx.matchAll(/内联\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+v?\d/g)].map((m2) => m2[1]);
const uniqInline = [...new Set(inlineNames)];
for (const n0 of uniqInline) {
  const n = norm(n0);
  const hit = known.some((k) => k === n || k.includes(n) || n.includes(k));
  hit ? ok('内联库 ' + n0 + ' 已登记') : no('内联库 ' + n0 + ' 未登记 —— REGISTRY 缺条目');
}
if (!uniqInline.length) console.log('  - 未发现内联库标记（跳过）');

/* ────────── B. 产品内鸣谢块 ────────── */
console.log('\nB. 产品内 —— <details class="attr"> 鸣谢块');
if (!attrBlock) {
  no('index.html 找不到 <details class="attr"> 鸣谢块');
} else {
  for (const r of REGISTRY) {
    attrBlock.includes(r.key) ? ok('鸣谢块含「' + r.key + '」')
                              : no('鸣谢块缺「' + r.key + '」（来源：' + r.src.join(', ') + '）');
  }
}

/* ────────── C. credits.html ────────── */
console.log('\nC. 落地页 —— credits.html');
if (!credits) {
  no('credits.html 不存在（合规需要一个稳定 URL）');
} else {
  for (const r of REGISTRY) {
    credits.includes(r.key) ? ok('credits.html 含「' + r.key + '」')
                            : no('credits.html 缺「' + r.key + '」');
  }
  // 许可全文可链
  credits.includes('ARPHICPL.TXT')
    ? ok('credits.html 链到 ARPHICPL.TXT（APL §1 保留许可文件）')
    : no('credits.html 未链到 ARPHICPL.TXT');
}

console.log('\n──────────────────────────────────────────────');
if (fail) console.log('署名闸门未通过 — ' + pass + ' 通过 / ' + fail + ' 失败');
else console.log('署名闸门通过 — ' + pass + ' 项全绿（' + REGISTRY.length + ' 个第三方条目已覆盖两处清单）');
console.log('──────────────────────────────────────────────');
process.exit(fail ? 1 : 0);
