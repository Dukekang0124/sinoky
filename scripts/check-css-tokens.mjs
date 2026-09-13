#!/usr/bin/env node
/**
 * check-css-tokens.mjs —— CSS 颜色令牌闸门（Sinoky v0.23.9 FIX）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要有这个闸门（防的都是「已经发生过、且在当场所有检查里都静默」的形态）
 * ══════════════════════════════════════════════════════════════════════
 * 2026-09-13 康哥截图报障：Smart review 卡里英文 "My phone is lost." 是**黑的**，
 * 压在深色底上完全看不清（同一张卡的中文是浅青色，正常）。
 * 顺藤摸到两条**同根**的病灶，都属于「深色主题上没写作者样式 ⇒ 落到浏览器默认值」：
 *
 * ① **引用了不存在的 CSS 变量**
 *    `.rv-en{color:var(--fg)}`，而 `--fg` 在 666,983 字节的 index.html 里
 *    **定义 0 次、被引用 5 次**（其余设计变量全部正好定义 1 次）。
 *    `var()` 无 fallback 且变量未定义 ⇒ 声明 **invalid at computed-value time**
 *    ⇒ 属性退化为 `unset` ⇒ `color` 是继承属性 ⇒ 等于 `inherit`
 *    ⇒ 从最近带颜色的祖先继承；`.rv-en` 的祖先链上第一个带颜色的是
 *    `<button class="rv-line">`，而按钮没有作者样式设 color ⇒ 继承 UA 的
 *    `buttontext` ⇒ **黑色**。实测 rgb(0,0,0) on rgb(29,35,44) = **1.33 : 1**。
 *    同根因共 8 处，**只有这 1 处显形**，另外 7 处靠偶然的继承链撞对了颜色。
 *
 * ② **裸 `<a>` 没有作者色**
 *    页脚 `Privacy` / `Share` 两个 `<a>` 没有任何 `a{color}` 规则
 *    ⇒ 用 UA 默认 `#0000EE` ⇒ 在 `--bg(#161a20)` 上 = **1.86 : 1，等于看不见**。
 *    `:visited` 的 UA 默认是紫 `#551A8B`，点过一次之后更难认。
 *
 * 浏览器不会为这两种情况报错、控制台零输出、现有四道闸门（语法/i18n/署名/构建）
 * 也全都看不见 —— 而且它们**看起来很正常**：CSS 写得整整齐齐，
 * `.rv-en{color:var(--fg)}` 语法完全合法。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 三段断言（零允许名单 ⇒ 不需要维护豁免）
 * ══════════════════════════════════════════════════════════════════════
 * A. **变量定义完整**：任何 `var(--x)` 不带 fallback ⇒ `--x` 必须已定义。
 *    带 fallback（`var(--x, …)`）**合法** —— fallback 是 CSS 变量的正当逃生舱，
 *    `var(--accent,var(--red))` 本来就是「有就用、没有就退回」。
 *    作用域：`_internal/nono-ip-v1/patch.{css,js}` 是**片段**，注入后与 index.html
 *    的 `:root` 同域；单独看它们「0 个定义」是假阳性。独立页面（credits/download/stats）
 *    自带 `:root`，自成定义域。
 *
 * B. **死令牌只报数**：定义了却没被任何 `var()` 引用的变量，可能是预留给主题的。
 *
 * C. **链接色必须由作者声明且可读**：页面里只要有 `<a>`，它就必须被
 *    ① 行内 style 的 color、或 ② 它的 class 对应的 color 规则、或
 *    ③ **一条裸 `a` 选择器的兜底 color 规则** 覆盖。
 *    并且当 ③ 的颜色可解析时，算它与页面底色的对比度，要求 ≥ 4.5。
 *    （③ 是硬要求：深色页不许让链接掉到 UA 默认色。若某链接其实由后代选择器覆盖，
 *      也请补一条裸 `a{color}` —— 这条兜底本身就有价值。）
 *
 * 用法：
 *   node scripts/check-css-tokens.mjs                 # 校验仓库
 *   node scripts/check-css-tokens.mjs --root=<dir>    # 校验副本（变异测试用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argRoot = process.argv.find((a) => a.startsWith('--root='));
const ROOT = argRoot ? path.resolve(argRoot.slice(7)) : path.resolve(HERE, '..');

/* 被内联进 index.html 的片段 —— 变量定义域 = index.html 的 */
const FRAGMENTS = ['_internal/nono-ip-v1/patch.css', '_internal/nono-ip-v1/patch.js'];
/* 独立页面 —— 自带 :root，自成定义域 */
const PAGES = ['index.html', 'stats.html', 'download.html', 'credits.html'];
const HOST = 'index.html';

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m) => { fail++; console.log('  ❌ ' + m); };
const info = (m) => console.log('  📊 ' + m);

const DEF_RE = /(--[a-zA-Z0-9_-]+)\s*:/g;
const USE_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g;

const read = (rel) => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
};
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

/* 🔴 扫 CSS 规则前**必须先抹掉注释**：
   闸门第一版没做这步，于是「规则前紧挨着一段 CSS 注释」时，
   选择器捕获 `[^{}]*?` 会把整段注释一起吞进来（注释里没有花括号，正则拦不住），
   选择器变成「注释文本 + 换行 + a」⇒ 判 `a` 的裸选择器失败 ⇒
   **闸门对着一条明明存在的规则报「缺失」**（还好被它自己的输出暴露了：
   4 处锚点全被标红，而其中两处其实由 `.foot details.attr a` 覆盖）。
   用等长空白替换可保持字节偏移不变 ⇒ 行号仍然准确。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const definedIn = (s) => {
  const set = new Set();
  let m;
  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(s))) set.add(m[1]);
  return set;
};

/* ─────────────────────── 颜色解析与对比度 ─────────────────────── */
const hex = (v) => {
  const h = v.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgba = (v) => {
  const m = String(v).match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
};
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

/** 把 `var(--x)` / `#hex` / `rgb()` 解析成 {r,g,b}；解不出返回 null */
function resolveColor(val, defs, depth = 0) {
  if (!val || depth > 3) return null;
  const s = String(val).trim();
  const vm = s.match(/^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,([^)]*))?\)$/);
  if (vm) {
    if (defs.has(vm[1])) return resolveColor(defs.get(vm[1]), defs, depth + 1);
    return vm[2] ? resolveColor(vm[2], defs, depth + 1) : null;
  }
  if (/^#/.test(s)) return hex(s);
  if (/^rgba?\(/.test(s)) return rgba(s);
  return null;
}

/** 变量名 → 原始值字符串 */
function defsMap(src) {
  const map = new Map();
  const s = stripComments(src);
  let m;
  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(s))) {
    const start = m.index + m[0].length;
    const stop = s.slice(start).search(/[;}]\s*(?:--|\}|\n\s*[a-zA-Z.#[*]|\/\*)/);
    const raw = s.slice(start, stop === -1 ? start + 60 : start + stop);
    if (!map.has(m[1])) map.set(m[1], raw.trim());
  }
  return map;
}

/** 页面底色：优先 `--bg`，其次 body{background:…} 里的字面色 */
function pageBg(pageSrc, defs) {
  const v = resolveColor('var(--bg)', defs);
  if (v) return v;
  const b = pageSrc.match(/body\s*\{([^}]*)\}/);
  if (b) {
    const m = b[1].match(/background(?:-color)?\s*:\s*([^;]+)/);
    if (m) { const c = resolveColor(m[1].trim(), defs); if (c) return c; }
  }
  return null;
}

/** 页面里「裸 a 选择器 + color 声明」的规则（C 段判据） */
function bareAnchorColorRule(src) {
  const pageSrc = stripComments(src);
  const re = /(^|[}\s;])([^{}]*?)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(pageSrc))) {
    const sel = m[2].trim();
    if (!sel || sel.startsWith('@') || /^\s*\/\*/.test(sel)) continue;
    const hasBareA = sel.split(',').some((part) => /^a(\s*:[a-z-]+)*$/.test(part.trim()));
    if (!hasBareA) continue;
    const cm = m[3].match(/(?:^|;)\s*color\s*:\s*([^;}]+)/);
    if (cm) return { sel, color: cm[1].trim(), line: lineOf(pageSrc, m.index) };
  }
  return null;
}

/** 某个 class 是否有 color 规则 */
function classHasColorRule(src, cls) {
  const pageSrc = stripComments(src);
  const re = new RegExp('[^{}]*\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(pageSrc))) {
    if (/(?:^|;)\s*color\s*:/.test(m[1])) return true;
  }
  return false;
}

const hostSrc = read(HOST);
const hostDefs = hostSrc ? definedIn(hostSrc) : new Set();
const scopeForFragment = hostDefs;

console.log('CSS 令牌闸门 — root = ' + ROOT);

/* ══════════════ A. 变量定义完整 ══════════════ */
console.log('\n── A. 每个 var() 无 fallback 引用都有定义 ──');
if (!hostSrc) {
  no('找不到 ' + HOST + '，闸门无法成立');
} else {
  info(HOST + ' 定义 ' + hostDefs.size + ' 个变量：' + [...hostDefs].join(' '));

  const check = (rel, src, scope, label) => {
    const out = [];
    let m;
    USE_RE.lastIndex = 0;
    while ((m = USE_RE.exec(src))) {
      if (m[2] === ',') continue;              // 有 fallback：合法
      if (scope.has(m[1])) continue;
      const ln = lineOf(src, m.index);
      out.push({ name: m[1], line: ln, snippet: (src.split('\n')[ln - 1] || '').trim().slice(0, 100) });
    }
    out.length === 0
      ? ok(rel + ' ' + label)
      : out.forEach((v) => no(rel + ' L' + v.line + ' 引用了未定义的 ' + v.name +
          '（无 fallback ⇒ 该声明会静默失效）｜' + v.snippet));
  };

  check(HOST, hostSrc, hostDefs, '无「未定义且无 fallback」的 var()（' + hostDefs.size + ' 个变量全部有定义）');
  for (const rel of FRAGMENTS) {
    const src = read(rel);
    if (src === null) { info(rel + ' 不存在，跳过'); continue; }
    check(rel, src, scopeForFragment, '引用的变量都能在 index.html 找到定义（片段域）');
  }
  for (const rel of PAGES) {
    if (rel === HOST) continue;
    const src = read(rel);
    if (src === null) { info(rel + ' 不存在，跳过'); continue; }
    const d = definedIn(src);
    check(rel, src, d, '自洽（定义 ' + d.size + ' 个变量，引用全部有定义）');
  }
}

/* ══════════════ B. 死令牌（只报数） ══════════════ */
console.log('\n── B. 已定义的变量是否真的被用到（只报数，不作判据） ──');
if (hostSrc) {
  const all = [hostSrc, ...FRAGMENTS.map(read).filter(Boolean)].join('\n');
  const dead = [...hostDefs].filter((n) => !all.includes('var(' + n));
  info(dead.length
    ? '定义但未被任何 var() 引用：' + dead.join(' ') + '（可能是预留给主题/外部，不判失败）'
    : '不存在「定义了却没人用」的变量');
}

/* ══════════════ C. 链接色必须由作者声明且可读 ══════════════ */
console.log('\n── C. 裸 <a> 必须有作者色（深色主题下 AA 默认色等于看不见） ──');
if (hostSrc) {
  for (const rel of PAGES) {
    const src = read(rel);
    if (src === null) continue;
    const anchors = [...src.matchAll(/<a\s[^>]*>/g)].map((m) => ({ tag: m[0], idx: m.index }));
    if (!anchors.length) { info(rel + ' 无 <a>，跳过'); continue; }

    const defs = rel === HOST ? defsMap(src) : defsMap(src);
    const bare = bareAnchorColorRule(src);
    const uncovered = [];
    for (const a of anchors) {
      const tag = a.tag;
      if (/style\s*=\s*"[^"]*\bcolor\s*:/.test(tag)) continue;            // ① 行内色
      const cm = tag.match(/class\s*=\s*"([^"]*)"/);
      if (cm && cm[1].split(/\s+/).some((c) => c && classHasColorRule(src, c))) continue; // ② class 覆盖
      if (bare) continue;                                                // ③ 裸 a 兜底
      uncovered.push({ line: lineOf(src, a.idx), tag: tag.slice(0, 90) });
    }

    if (uncovered.length) {
      uncovered.forEach((u) => no(rel + ' L' + u.line + ' 的 <a> 没有任何作者色 ⇒ 会用 UA 默认 #0000EE（深色底上 1.86:1）｜' + u.tag));
    } else if (!bare) {
      ok(rel + ' 的 <a> 都由行内色或 class 规则覆盖（无裸 a 兜底，但不影响当前渲染）');
    } else {
      const c = resolveColor(bare.color, defs);
      const bg = pageBg(src, defs);
      if (c && bg) {
        const r = Math.round(contrast(c, bg) * 100) / 100;
        r >= 4.5
          ? ok(rel + ' 裸 a 兜底色 ' + bare.color + ' on 页面底色 = ' + r + ':1（≥4.5，' + anchors.length + ' 个 <a> 全覆盖）')
          : no(rel + ' 裸 a 兜底色 ' + bare.color + ' on 页面底色只有 ' + r + ':1（需 ≥4.5）｜规则在 L' + bare.line);
      } else {
        info(rel + ' 裸 a 兜底色 = ' + bare.color + '（颜色或底色含变量外引用，无法静态算对比度；由浏览器层 test_contrast.mjs 兜）');
      }
    }
  }
}

console.log('\n──────────────────────────────────────────────');
if (fail) console.log('CSS 令牌闸门未通过 — ' + pass + ' 通过 / ' + fail + ' 失败');
else console.log('CSS 令牌闸门通过 — ' + pass + ' 项全绿（无「引用了不存在的变量」，无「掉到 UA 默认色的裸链接」）');
console.log('──────────────────────────────────────────────');
process.exit(fail ? 1 : 0);
