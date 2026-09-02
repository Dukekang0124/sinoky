const fs = require('fs');
const FP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/index.html';
const html = fs.readFileSync(FP, 'utf8');

const m = html.match(/var SCENES = (\[[\s\S]*?\n\];)/);
if (!m) { console.log('FAIL: SCENES not found'); process.exit(1); }
const SCENES = eval(m[1]);

const si = SCENES.find(s => s.id === 'self-intro');
console.log('self-intro phrase count =', si.phrases.length, '(expect 10)');

const issues = [];
si.phrases.forEach((p, i) => {
  ['en', 'py', 'hz'].forEach(f => {
    if (/_{2,}/.test(p[f] || '')) issues.push(`#${i} ${f} has underscore: ${p[f]}`);
    if (!(p[f] || '').trim()) issues.push(`#${i} ${f} EMPTY`);
  });
  const ho = (p.hz.match(/（/g) || []).length;
  const hc = (p.hz.match(/）/g) || []).length;
  if (ho !== hc) issues.push(`#${i} hz bracket mismatch (${ho}/${hc}): ${p.hz}`);
  (p.real || []).forEach((r, j) => {
    if (/_{2,}/.test(r.hz || '')) issues.push(`#${i} real#${j} underscore: ${r.hz}`);
    if (!r.hz || !r.hz.trim()) issues.push(`#${i} real#${j} EMPTY hz`);
  });
});
console.log('placeholder/bracket issues =', issues.length ? issues : 'NONE');

const newP = si.phrases.some(p => /Please speak slowly/.test(p.en)) &&
             si.phrases.some(p => /Can you say that again/.test(p.en));
console.log('NEW phrases present =', newP);

// 全文件：排除 JS 内部变量(window.__*) 后的字面 __
const lit = (html.match(/_{2,}/g) || []).filter(u => !/window\.__/.test(u));
console.log('file literal __ (excl window.__) =', lit.length, lit);

// 版本三处
const vHtml = (html.match(/var APP_VERSION = '([\d.]+)'/) || [])[1];
const vJson = JSON.parse(html.match(/version\.json[\s\S]*?/)? '{}' : '{}'); // placeholder
const swC = (html.match(/sinoky-v([\d.]+)/) || [])[1];
console.log('APP_VERSION =', vHtml);
console.log('RESULT =', (si.phrases.length === 10 && issues.length === 0 && newP && lit.length === 0 && vHtml === '0.3.20') ? 'PASS' : 'CHECK');
