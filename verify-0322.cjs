// verify-0322.cjs — 静态校验 0.3.22 拆分+扩展结构
const fs = require('fs');
const root = __dirname;
const idx = fs.readFileSync(root + '/index.html', 'utf8');
const ver = fs.readFileSync(root + '/version.json', 'utf8');
const sw  = fs.readFileSync(root + '/sw.js', 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra){ if(cond){ pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra?('  -> '+extra):'')); } }

// 1) 提取 SCENES 区块
const start = idx.indexOf('var SCENES');
const end = idx.indexOf('\n];', start);
const scenes = idx.slice(start, end);

// 2) 按场景切分并统计 en 短语数
const blocks = scenes.split(/id:'/).slice(1); // 第0块是 var SCENES = [ 前的废文本
const count = {};
blocks.forEach(b => {
  const id = b.slice(0, b.indexOf("'"));
  const n = (b.match(/en:/g) || []).length;
  count[id] = n;
});
console.log('场景短语数:', JSON.stringify(count));

// 3) 各场景句数断言
ok('arrival = 5', count.arrival === 5, 'got ' + count.arrival);
ok('self-intro = 11', count['self-intro'] === 11, 'got ' + count['self-intro']);
ok('emergency = 14', count.emergency === 14, 'got ' + count.emergency);
ok('food = 6', count.food === 6, 'got ' + count.food);
ok('meeting = 4', count.meeting === 4, 'got ' + count.meeting);

// 4) 合并残留：phone / wallet 应已拆开
ok('emergency 无 "phone / wallet" 合并残留', !scenes.includes('phone / wallet'));
ok('emergency 无 " / " 合并句', !/My phone \/ wallet/.test(scenes));

// 5) 新增短语就位
ok('arrival 含 洗手间', scenes.includes('洗手间在哪里？'));
ok('food 含 请给我水', scenes.includes('请给我水。'));
ok('food 含 我不吃肉', scenes.includes('我不吃肉。'));
ok('emergency 含 过敏', scenes.includes('过敏'));
ok('emergency 拆出 手机丢了', scenes.includes('我的手机丢了。'));
ok('emergency 拆出 钱包丢了', scenes.includes('我的钱包丢了。'));

// 6) SCENES 区域内无占位符下划线（排除 JS 内部 window.__ 等）
const sceneLines = scenes.split('\n');
const badUnder = sceneLines.filter(l => /_{2,}/.test(l) && !/window\.__/.test(l));
ok('SCENES 内无内容占位符下划线', badUnder.length === 0, badUnder.join(' | '));

// 7) 三处版本一致 0.3.22
const vIdx = (idx.match(/APP_VERSION = '([\d.]+)'/) || [])[1];
const vJson = (ver.match(/"version":\s*"([\d.]+)"/) || [])[1];
const vSw  = (sw.match(/sinoky-v([\d.]+)/) || [])[1];
ok('index.html 版本 0.3.22', vIdx === '0.3.22', vIdx);
ok('version.json 版本 0.3.22', vJson === '0.3.22', vJson);
ok('sw.js 版本 0.3.22', vSw === '0.3.22', vSw);

// 8) 总短语数
const total = Object.values(count).reduce((a,b)=>a+b,0);
ok('总短语数 = 40', total === 40, 'got ' + total);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
