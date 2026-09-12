// 功能测试：在 Node 中用桩 DOM + 真实数据文件跑通新增的 HSK 分级逻辑（initLevels/selectLevel/loadCards/showLevelPending/fcState）
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// 抽取新增的 flashcard 块（从 var CARDS 到 showLevelPending 结尾）
const startMark = "var CARDS = [], fcIdx = 0, fcRevealed = false, NW = [], FC_LEVEL = 1, FC_LEVELS = [];";
const start = html.indexOf(startMark);
const end = html.indexOf("  renderNW();\n}", start);
if (start < 0 || end < 0) { console.error('✗ 未找到代码块标记'); process.exit(1); }
const code = html.slice(start, end + "  renderNW();\n}".length);

// ---- 桩 DOM ----
function makeEl() {
  return {
    _children: [], _html: '', _text: '',
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,on){ if(on) this._s.add(c); else this._s.delete(c); }, contains(c){return this._s.has(c);} },
    style: {},
    setAttribute(k,v){ this['_a_'+k]=v; }, getAttribute(k){ return this['_a_'+k]; },
    appendChild(c){ this._children.push(c); },
    set innerHTML(v){ this._html=v; this._children=[]; }, get innerHTML(){ return this._html; },
    set textContent(v){ this._text=v; }, get textContent(){ return this._text; },
    onclick: null,
  };
}
const els = {};
const document = {
  getElementById(id){ return els[id] || (els[id] = makeEl()); },
  createElement(){ return makeEl(); },
  querySelectorAll(sel){ if (sel === '#fc-levels .fc-level-btn') return (els['fc-levels'] ? els['fc-levels']._children : []); return []; },
};
const store = {};
const localStorage = { getItem(k){ return store[k]||null; }, setItem(k,v){ store[k]=String(v); } };
const fetch = async (url) => {
  const rel = String(url).replace(/^\.?\//,'').replace(/^\//,'');
  const txt = fs.readFileSync(path.join(root, rel), 'utf8');
  return { json: async () => JSON.parse(txt) };
};
let renderCardCalls = 0, renderNWCalls = 0;
const S = { cards: {} };
const sandbox = {
  document, localStorage, fetch, S,
  $: (id) => document.getElementById(id),
  renderCard(){ renderCardCalls++; },
  renderNW(){ renderNWCalls++; },
  saveStateLocal(){}, lsSet(){},
  console,
};
const ctx = vm.createContext(sandbox);
new vm.Script(code).runInContext(ctx);

const tick = () => new Promise(r => setTimeout(r, 30));
let fails = 0;
function assert(name, cond){ console.log((cond ? '✓ ' : '✗ ') + name); if(!cond) fails++; }

(async () => {
  // 1) 全新用户：默认进入第一个 ready 等级（HSK1）
  await ctx.initLevels(); await tick();
  assert('FC_LEVELS 有 3 个等级', ctx.FC_LEVELS.length === 3);
  assert('渲染出 3 个等级 tab', els['fc-levels']._children.length === 3);
  assert('HSK1 tab 标 "on"', els['fc-levels']._children[0].classList.contains('on'));
  assert('HSK2 tab 标 "待补充"', /待补充/.test(els['fc-levels']._children[1].innerHTML));
  assert('默认选中 HSK1', ctx.FC_LEVEL === 1);
  assert('HSK1 载入 193 张', ctx.CARDS.length === 193);
  assert('HSK1 调了 renderCard', renderCardCalls > 0);

  // 2) 切到 HSK2（占位）：显示待补充，不翻卡
  renderCardCalls = 0; renderNWCalls = 0;
  await ctx.selectLevel(2); await tick();
  assert('切到 HSK2', ctx.FC_LEVEL === 2);
  assert('HSK2 进度条显示「待补充」', /HSK2 · 待补充/.test(els['fc-prog'].textContent));
  assert('HSK2 卡库为空', ctx.CARDS.length === 0);
  assert('HSK2 不调 renderCard（占位）', renderCardCalls === 0);
  assert('HSK2 仍调 renderNW（生词本）', renderNWCalls > 0);

  // 3) 每切回 HSK1 进度独立
  await ctx.selectLevel(1); await tick();
  assert('切回 HSK1 仍 193 张', ctx.CARDS.length === 193);

  // 4) 每等级进度分离 + legacy 迁移
  S.cards = { idx: 7 }; // 旧版平铺 {idx}
  renderCardCalls = 0;
  await ctx.initLevels(); await tick();
  assert('legacy {idx} 迁移到 {1:{idx}}', S.cards['1'] && S.cards['1'].idx === 7);
  assert('legacy 字段已清除', S.cards.idx === undefined);
  assert('HSK1 游标恢复到 7', ctx.fcIdx === 7);

  // 5) 分别记忆：HSK1 游标 7，HSK3 游标 3
  S.cards = { '1': { idx: 7 }, '3': { idx: 3 } };
  await ctx.selectLevel(3); await tick();
  assert('HSK3 为空（占位）', ctx.CARDS.length === 0);
  await ctx.selectLevel(1); await tick();
  assert('HSK1 游标保持 7（不串到 HSK3）', ctx.fcIdx === 7);

  console.log(`\n功能测试: ${fails === 0 ? '全部通过 ✓' : fails + ' 项失败 ✗'}`);
  process.exit(fails ? 1 : 0);
})();
