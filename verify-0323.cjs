// v0.3.23 security guard static verification
// 验证 _worker.js 已加入 Origin 白名单 + 每IP速率限制，且语法可编译。
const fs = require('fs');
const { execSync } = require('child_process');

const path = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_worker.js';
const src = fs.readFileSync(path, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

// 1) 语法可编译（esbuild bundle 在 Pages 跑，本地用 node --check 验基础语法）
try {
  execSync('"C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" --check "' + path + '"', { stdio: 'pipe' });
  ok('_worker.js 语法可编译 (node --check)', true);
} catch (e) {
  ok('_worker.js 语法可编译 (node --check)', false, String(e.stderr || e).slice(0, 200));
}

// 2) guard 函数与常量就位
ok('定义 guardApi()', /function\s+guardApi\s*\(/.test(src));
ok('定义 rateOk()', /function\s+rateOk\s*\(/.test(src));
ok('定义 clientIp()', /function\s+clientIp\s*\(/.test(src));
ok('ALLOWED_ORIGINS 含生产域', /ALLOWED_ORIGINS\s*=\s*\[[^\]]*sinoky\.pages\.dev/.test(src));
ok('速率窗口常量 RATE_WINDOW', /RATE_WINDOW\s*=\s*60_000/.test(src));
ok('速率上限常量 RATE_MAX', /RATE_MAX\s*=\s*40/.test(src));

// 3) handler 入口调用了 guard（OPTIONS 预检之后、路由分发之前）
const handler = src.slice(src.indexOf('async fetch(req, env)'));
const callIdx = handler.indexOf('await guardApi(req, url, json)');
const ttsIdx = handler.indexOf("/api/tts");
ok('handler 入口调用 guardApi', callIdx > 0);
ok('guard 调用在 /api/tts 路由之前（即对所有 api 兜底）', callIdx > 0 && callIdx < ttsIdx);

// 4) /health 与 feedback GET 读端点被跳过（已有独立鉴权）
ok('guard 跳过 /health', /url\.pathname\s*===\s*'\/health'/.test(src));
ok('guard 跳过 feedback GET（保留原 token 鉴权）', /url\.pathname\s*===\s*'\/api\/feedback'\s*&&\s*req\.method\s*===\s*'GET'/.test(src));

// 5) 跨站拦截逻辑：origin 存在且非同host非白名单 → 403
ok('跨站 origin 返回 403', /origin not allowed['"]?\s*},\s*403/.test(src) || /error:\s*'origin not allowed'.*403/s.test(src));
ok('速率超限返回 429', /rate limited['"]?.*429/s.test(src));

// 6) version.json 已升 0.3.23
const v = JSON.parse(fs.readFileSync('D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/version.json', 'utf8'));
ok('version.json = 0.3.23', v.version === '0.3.23', 'got ' + v.version);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
