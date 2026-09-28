/* count_corpus.cjs —— 从产品真源**导出**官网/宣传口径要用到的全部数字（唯一出处）
 *
 * 为什么需要它（2026-09-28 建）：
 *   官网/落地页的责任边界是**如实**，不是**好看**。营销文案里的数字最容易在改版中
 *   慢慢变成「无源之数」——写的人换过、源改过、没人再核，最后官网上挂着一个
 *   产品里根本不存在的数字。这类错误比排版错位严重得多（它是对用户的虚假陈述）。
 *
 *   本脚本把「数字」从「文案」里拆出来：所有对外口径的个数一律**现场从 index.html /
 *   data/ / audio/ / langs/ 现算**，不写死。
 *   于是 `check_site.cjs` 可以断言「页面上印的数字 == 源里算出来的数字」，
 *   源一改、页没跟着改 → 当场红。这就是数字的溯源链。
 *
 * 三个刻意的实现选择：
 *   ① **静默解析、不跑产品代码**：只从源码里「切」出数据字面量再在 vm 里求值，
 *      不 require index.html、不碰 DOM。跑产品代码等于引入一堆副作用，
 *      为了数几个数不值得。
 *   ② **括号配平切片，不按 `\nvar ` 切**：早先 dump_scenes.cjs 用「切到下一个 \nvar」
 *      的写法，遇到块内嵌套 var/注释就切错。这里用带字符串/注释感知的配平扫描器。
 *   ③ **CLI 与 require 双用**：`node count_corpus.cjs` 直接打印（给人看），
 *      `require('./count_corpus.cjs')` 返回对象（给闸门用）。同一份逻辑，不会漂。
 *
 * 用法：
 *   node _internal/count_corpus.cjs
 *   node _internal/count_corpus.cjs --json
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..');

/* ── 带字符串/注释感知的括号配平切片 ──────────────────────────────
   从 src[start] 处的 open 字符起，扫到与之配平的 close 字符，返回这一段字面量。
   必须感知字符串与注释，否则 `'}'` 或 `// ]` 会当场把配平搞崩。 */
function sliceBalanced(src, start, open, close) {
  let depth = 0;
  let inStr = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('括号不配平：起始偏移 ' + start);
}

/* 取「var NAME = <字面量>;」里的字面量并求值。找不到就抛，绝不静默返回 undefined ——
   静默返回 undefined 会让上层拿到 NaN 还能过闸门，那是比抛错更坏的结果。 */
function evalDecl(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error('源码里找不到声明：' + decl);
  const openAt = (() => {
    for (let i = at + decl.length; i < src.length; i++) {
      const c = src[i];
      if (c === '[') return { i, open: '[', close: ']' };
      if (c === '{') return { i, open: '{', close: '}' };
    }
    throw new Error('声明后没有字面量：' + decl);
  })();
  const literal = sliceBalanced(src, openAt.i, openAt.open, openAt.close);
  return vm.runInNewContext('(' + literal + ')');
}

function countCorpus() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

  const SCENES = evalDecl(html, 'var SCENES = ');
  const CITY_GUIDES = evalDecl(html, 'var CITY_GUIDES = ');
  const CITY_LIST = evalDecl(html, 'var CITY_LIST = ');
  const SENT_AUDIO = evalDecl(html, 'var SENT_AUDIO=');
  const READ_ITEMS = evalDecl(html, 'var READ_ITEMS = ');
  const TONES = evalDecl(html, 'var TONES = ');
  const DAYS = evalDecl(html, 'var DAYS = ');
  const LANGS = evalDecl(html, 'var LANGS = ');

  /* 字卡：按 data/flashcards.hsk*.json 现算，不认任何硬编码总数 */
  const fcDir = path.join(APP, 'data');
  const fcFiles = fs.readdirSync(fcDir).filter((f) => /^flashcards\.hsk\d+\.json$/.test(f));
  const fcPerLevel = {};
  let flashcards = 0;
  for (const f of fcFiles) {
    const j = JSON.parse(fs.readFileSync(path.join(fcDir, f), 'utf8'));
    const n = Array.isArray(j) ? j.length : (Array.isArray(j.cards) ? j.cards.length : Object.keys(j).length);
    fcPerLevel[f.replace(/^flashcards\.|\.json$/g, '')] = n;
    flashcards += n;
  }

  /* 音频：主句与语气变体分开数（对外口径「137 句必说」指的是主句，不含 rN 变体） */
  const audioDir = path.join(APP, 'audio');
  const mp3 = fs.readdirSync(audioDir).filter((f) => f.endsWith('.mp3'));
  const audioMain = mp3.filter((f) => /_main\.mp3$/.test(f)).length;
  const audioVariant = mp3.filter((f) => /_r\d+\.mp3$/.test(f)).length;
  const audioOverride = mp3.filter((f) => /^tts_override_/.test(f)).length;

  /* 界面语言：LANGS 是权威（en 为基准，另 6 个语言包） */
  const langKeys = Object.keys(LANGS);
  const enIsBase = langKeys[0] === 'en';
  const langFiles = fs.readdirSync(path.join(APP, 'langs')).filter((f) => f.endsWith('.json'));

  /* 城市：CITY_LIST（有场景图的）与 CITY_GUIDES（有完整攻略的）是两个不同口径，
     官网文案必须分开说 —— 混为一谈就是虚高陈述。 */
  return {
    scenes: SCENES.length,
    cities: CITY_LIST.length,
    cityGuides: Object.keys(CITY_GUIDES).length,
    cityGuideIds: Object.keys(CITY_GUIDES),
    sentAudio: Object.keys(SENT_AUDIO).length,
    readItems: READ_ITEMS.length,
    tones: TONES.length,
    days: DAYS.length,
    flashcards,
    flashcardsByLevel: fcPerLevel,
    audioTotal: mp3.length,
    audioMain,
    audioVariant,
    audioOverride,
    languages: langKeys.length,
    languagesInterface: enIsBase ? langKeys.length : langKeys.length,
    langFiles: langFiles.length,
    langKeys,
  };
}

module.exports = { countCorpus };

if (require.main === module) {
  let c;
  try {
    c = countCorpus();
  } catch (e) {
    console.error('✗ 语料计数失败：' + e.message);
    process.exit(1);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(c, null, 2));
  } else {
    console.log('Sinoky 语料口径（真源现算，勿手改）');
    console.log('─'.repeat(46));
    console.log('场景总数            ' + c.scenes + '   （日常话题 + 逐日 + 城市）');
    console.log('城市（有场景图）    ' + c.cities);
    console.log('城市（有完整攻略）  ' + c.cityGuides + '   ' + c.cityGuideIds.join(' / '));
    console.log('录音语句（唯一句）  ' + c.sentAudio + '   总音频 ' + c.audioTotal +
      ' = 主句 ' + c.audioMain + ' + 语气变体 ' + c.audioVariant + ' + 覆盖 ' + c.audioOverride);
    console.log('阅读篇目            ' + c.readItems);
    console.log('声调               ' + c.tones);
    console.log('路径天数            ' + c.days);
    console.log('字卡               ' + c.flashcards + '   ' +
      Object.entries(c.flashcardsByLevel).map(([k, v]) => k + '=' + v).join(' '));
    console.log('界面语言            ' + c.languages + '  （key: ' + c.langKeys.join(', ') + '）');
    console.log('语言包文件          ' + c.langFiles);
    console.log('─'.repeat(46));
    console.log('⚠️ 官网文案里的每一个数字都必须等于上表。改文案请先跑本脚本。');
  }
}
