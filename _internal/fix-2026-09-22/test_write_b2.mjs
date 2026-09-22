// v0.23.20 B2 行为自测：抽取 index.html AI 区块，vm 沙箱验证「语法/写作教练」真的接入。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(process.cwd() + '/index.html', 'utf8');
const aiAnchor = html.indexOf('/* v0.23.15 AI 点评增强');
const scriptOpen = html.lastIndexOf('<script>', aiAnchor) + '<script>'.length;
const closeIdx = html.indexOf('</script>', aiAnchor);
const block = html.slice(scriptOpen, closeIdx);
if (aiAnchor < 0 || closeIdx < 0) { console.log('FAIL: markers not found'); process.exit(1); }
console.log('extracted AI block chars:', block.length);

let captured = [];
let nextReply = { reply: '我喝茶。\n把「喝」改成更自然的说法：我喝茶。' };
let nextOk = true;
const mockFetch = async (url, opt) => {
  captured.push({ url, body: JSON.parse(opt.body) });
  return { ok: nextOk, json: async () => nextReply };
};

// 极简 DOM：可读写的元素池
const els = {};
function el(id) {
  if (!els[id]) els[id] = { id, value: '', innerHTML: '', style: {}, set display(v){ this.style.display = v; }, get display(){ return this.style.display; } };
  return els[id];
}

let speakCalls = [];
const S = {
  aiWeak: { dims: { tone3: 4, initial: 2 } },
  aiErrLog: [{ t: '买', u: '卖' }],
  dayDone: { 1: true, 2: true },
  phrases: { s1: [1, 2], s2: [1, 2] },
  streak: 3, nonoChat: [],
};
const ctx = {
  S,
  CARDS: [{ hanzi: '你', meaning: 'you' }, { hanzi: '好', meaning: 'good' }, { hanzi: '水', meaning: 'water' }, { hanzi: '茶', meaning: 'tea' }],
  API_BASE: '', UID: 'test', fetch: mockFetch, console,
  saveState: () => {}, today: () => '2026-09-22',
  T: (s) => s, escHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  setTimeout: () => {},
  document: { getElementById: (id) => el(id) },
  NONO: { closed: true, pickLine: () => ({ hz: '你好', en: 'hi' }) },
  nonoStartPracticeWith: (line) => { speakCalls.push(line); },
  nonoState: () => {},
  Math, JSON, Object, Array, String, Number, Date, RegExp, Error, Promise,
};
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(block, ctx);

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra || ''); } };

console.log('--- B2-0 门槛与非空题目 ---');
check('writeEligible 有进度=true', ctx.writeEligible() === true);
S.phrases = {}; S.dayDone = {};
check('writeEligible 零进度=false', ctx.writeEligible() === false);
S.phrases = { s1: [1, 2], s2: [1, 2] }; S.dayDone = { 1: true, 2: true };
const task = ctx.writeTaskOfDay();
console.log('    task =', task);
check('writeTaskOfDay 非空', typeof task === 'string' && task.length > 4);

console.log('--- B2-1 卡片 HTML 含题目/输入框/按钮 ---');
const cardHtml = ctx.writeCardHtml();
check('含任务区 wcx-task', /wcx-task/.test(cardHtml));
check('含 textarea#wcx-input', /id="wcx-input"/.test(cardHtml));
check('含检查按钮 Check my Chinese', /Check my Chinese/.test(cardHtml));
check('含 AI 徽章', /badge">AI/.test(cardHtml));

console.log('--- B2-2 writeSubmit 发出 mode=correct + 背景 + 题目 + 我的中文 ---');
S.writeCap = { date: '2026-09-22', n: 0 };
el('wcx-input').value = '我喝茶';
captured = [];
await ctx.writeSubmit();
check('调用 /api/chat', captured.length === 1 && /api\/chat$/.test(captured[0].url));
check('mode=correct', captured[0] && captured[0].body.mode === 'correct');
check('hist 为空（无状态单轮）', captured[0] && Array.isArray(captured[0].body.hist) && captured[0].body.hist.length === 0);
check('正文含【学生背景】', captured[0] && /【学生背景】/.test(captured[0].body.text));
check('正文含题目', captured[0] && /题目：/.test(captured[0].body.text));
check('正文含我的中文', captured[0] && /我的中文：我喝茶/.test(captured[0].body.text));

console.log('--- B2-3 结果解析：首行=改正句、余下=说明 ---');
const wc = ctx.ensureWriteCoach();
console.log('    corrected =', JSON.stringify(wc.corrected), '| feedback =', JSON.stringify(wc.feedback));
check('corrected=首行', wc.corrected === '我喝茶。');
check('feedback=余下', /把/.test(wc.feedback));
check('cap 计数+1', ctx.ensureWriteCap().n === 1);

console.log('--- B2-4 writeReadOut 闭环到开口 ---');
speakCalls = [];
ctx.writeReadOut();
check('调用 nonoStartPracticeWith', speakCalls.length === 1);
check('朗读句=改正句', speakCalls[0] && speakCalls[0].hz === '我喝茶。');
check('打开诺诺面板', ctx.NONO.closed === false);

console.log('--- B2-5 离线回落 ---');
nextOk = false; captured = [];
S.writeCoach.corrected = '';    // 清掉以便观察是否被写入
el('wcx-input').value = '我喜欢猫';
await ctx.writeSubmit();
check('离线时仍发了请求', captured.length === 1);
check('离线不写入 corrected', !ctx.ensureWriteCoach().corrected);

console.log('--- B2-6 每日上限 ≤10 ---');
nextOk = true; captured = [];
S.writeCap = { date: '2026-09-22', n: 10 };
el('wcx-input').value = '再写一句';
await ctx.writeSubmit();
check('超上限不再调 fetch', captured.length === 0);

console.log('--- B2-7 空输入拦截 ---');
captured = [];
S.writeCap = { date: '2026-09-22', n: 0 };
el('wcx-input').value = '   ';
await ctx.writeSubmit();
check('空输入不发请求', captured.length === 0);

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
