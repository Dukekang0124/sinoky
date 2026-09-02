// 静态校验：self-intro "I'm a student / teacher" 已拆成两句独立短语（0.3.21）
const fs = require('fs');
const h = fs.readFileSync('index.html', 'utf8');

// 定位 self-intro 段（截到下一个场景 emergency 之前）
const start = h.indexOf("id:'self-intro'");
const next = h.indexOf("id:'emergency'");
const seg = h.slice(start, next > -1 ? next : start + 5000);

const enCount = (seg.match(/en\s*:/g) || []).length;

const hasStudentIndependent = /I'm a student\./.test(seg) && !/I'm a student \/ teacher\./.test(seg);
const hasTeacher = /I'm a teacher\./.test(seg);
const noCombined = !/student \/ teacher/.test(seg);

// 仅查内容字段（py/hz/en 的引号内容），不查 JS 内部变量
const fieldRe = /(?:py|hz|en)\s*:\s*['"]([^'"]*)['"]/g;
let m, badFields = [];
while ((m = fieldRe.exec(h)) !== null) {
  if (/_{2,}/.test(m[1])) badFields.push(m[1]);
}

const vHtml = (h.match(/APP_VERSION = '([0-9.]+)'/) || [])[1];
const vJson = JSON.parse(fs.readFileSync('version.json', 'utf8')).version;
const vSw = (fs.readFileSync('sw.js', 'utf8').match(/sinoky-v([0-9.]+)/) || [])[1];

console.log('self-intro phrases:', enCount);
console.log('hasStudent(independent):', hasStudentIndependent);
console.log('hasTeacher:', hasTeacher);
console.log('noCombinedSlash:', noCombined);
console.log('badFields(__ in py/hz/en):', badFields.length, badFields.slice(0, 5));
console.log('versions:', vHtml, vJson, vSw);

const ok = enCount === 11 && hasStudentIndependent && hasTeacher && noCombined &&
           badFields.length === 0 && vHtml === '0.3.21' && vJson === '0.3.21' && vSw === '0.3.21';
console.log(ok ? 'SPLIT_VERIFY: PASS' : 'SPLIT_VERIFY: FAIL');
process.exit(ok ? 0 : 1);
