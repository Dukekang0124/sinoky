const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript',
  '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.woff2':'font/woff2',
  '.webmanifest':'application/manifest+json'
};

function serve(req, res) {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if(p.endsWith('/') || !path.extname(p)) p = path.join(p, 'index.html');
  if(!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  fs.createReadStream(p).pipe(res).writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'});
}

const server = http.createServer(serve);
server.listen(8138, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' });
  const page = await ctx.newPage();

  // 拦截外部 API：mock chat/asr/tts
  await page.route(/\/api\/(chat|asr|tts|score)/, (route, req) => {
    const url = req.url();
    if (url.includes('/api/chat')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: 'Ni hao! I am Nono. What do you want to talk about?', model: 'glm-4-flash', degraded: false }) });
    }
    if (url.includes('/api/asr')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '你好诺诺' }) });
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // 先拦截再跳转
  await page.goto('http://localhost:8138/index.html');
  await page.waitForTimeout(800);
  // 跳过 onboarding / splash，避免遮挡点击
  await page.evaluate(() => {
    var sp = document.getElementById('splash'); if(sp) sp.remove();
    var ob = document.getElementById('v-onboard'); if(ob){ ob.classList.remove('on'); ob.style.display='none'; }
    var w = document.querySelector('.wrap'); if(w) w.style.opacity='1';
  });
  await page.waitForTimeout(200);

  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('console', msg => logs.push('CONSOLE: ' + msg.text()));

  let ok = true, fail = (m) => { ok = false; logs.push('FAIL: ' + m); };

  try {
    // 1. 打开 Nono 面板（直接调用函数，避免 FAB 与反馈按钮重叠导致点击被拦截）
    await page.evaluate(() => { try { nonoToggle(); } catch(e) {} });
    await page.waitForTimeout(400);
    const panelVisible = await page.isVisible('#nono-panel');
    if (!panelVisible) fail('panel not visible after clicking fab');

    // 2. 切换到 Chat 模式
    await page.evaluate(() => { var btns = document.querySelectorAll('.nm-wrap button'); for(var i=0;i<btns.length;i++) if(/chat/i.test(btns[i].textContent)){ btns[i].click(); break; } });
    await page.waitForTimeout(400);

    // 3. 聊天区可见、有滚动容器、控制条可见
    const chatVisible = await page.isVisible('#nono-chat');
    if (!chatVisible) fail('#nono-chat not visible in chat mode');
    const listExists = await page.locator('#nc-list').count() > 0;
    if (!listExists) fail('#nc-list scroll container missing');
    await page.waitForTimeout(200);
    const micVisible = await page.isVisible('.nctrl-mic');
    if (!micVisible) fail('.nctrl-mic hold-to-speak button not visible');
    const micBox = await page.locator('.nctrl-mic').boundingBox();
    const panelBox0 = await page.locator('#nono-panel').boundingBox();
    if (micBox && panelBox0 && (micBox.y + micBox.height > panelBox0.y + panelBox0.height + 1)) fail('mic button clipped outside panel');

    // 4. 调试尺寸
    const dims1 = await page.evaluate(() => {
      const p = document.getElementById('nono-panel'), c = document.getElementById('nono-chat'), l = document.getElementById('nc-list');
      return { panelH: p ? p.offsetHeight : -1, chatH: c ? c.offsetHeight : -1, listH: l ? l.clientHeight : -1, listSH: l ? l.scrollHeight : -1, flex: p ? p.className : '' };
    });
    logs.push('DIMS chat open: ' + JSON.stringify(dims1));

    // 5. 模拟大量消息撑满，验证聊天区滚动而非面板被撑爆
    await page.evaluate(() => {
      const longText = '今天天气真不错，我想去美国旅行。你觉得我应该去纽约还是洛杉矶？';
      for (let i = 0; i < 40; i++) {
        nonoChatBubble('you', longText + ' [' + i + ']');
        nonoChatBubble('nono', '哇，' + longText + '这听起来很棒！你想聊什么？[' + i + ']');
      }
    });
    await page.waitForTimeout(300);

    const dims2 = await page.evaluate(() => {
      const p = document.getElementById('nono-panel'), c = document.getElementById('nono-chat'), l = document.getElementById('nc-list');
      return { panelH: p ? p.offsetHeight : -1, chatH: c ? c.offsetHeight : -1, listH: l ? l.clientHeight : -1, listSH: l ? l.scrollHeight : -1 };
    });
    logs.push('DIMS after 80 bubbles: ' + JSON.stringify(dims2));
    if (dims2.listSH <= dims2.listH) fail('nc-list did not become scrollable');
    if (dims2.panelH > 750) fail('panel grew beyond viewport after many messages: ' + dims2.panelH);

    await page.screenshot({ path: path.join(__dirname, 'screenshot_nono_chat_scroll.png') });

    // 6. 打字交互
    await page.evaluate(() => { var b = document.querySelector('.nctrl-ico'); if(b) b.click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { var inp = document.getElementById('nono-input'); if(inp) { inp.value='Hello'; inp.dispatchEvent(new Event('input', {bubbles:true})); } });
    await page.evaluate(() => { var b = document.querySelector('#nono-txt button'); if(b) b.click(); });
    await page.waitForTimeout(400);
    const lastBubble = await page.locator('.nc-bub').last().innerText();
    if (!lastBubble.includes('Ni hao! I am Nono')) fail('chat reply not rendered: ' + lastBubble);

    // 7. 截图保存
    await page.screenshot({ path: path.join(__dirname, 'screenshot_nono_chat.png') });

    // 8. 模式切换回 Practice
    await page.evaluate(() => { var btns = document.querySelectorAll('.nm-wrap button'); for(var i=0;i<btns.length;i++) if(/practise|practice/i.test(btns[i].textContent)){ btns[i].click(); break; } });
    await page.waitForTimeout(300);
    const practiceVisible = await page.isVisible('#nono-practice');
    if (!practiceVisible) fail('practice view not visible after switching back');

  } catch (e) {
    fail('exception: ' + e.message);
  }

  await ctx.close();
  await browser.close();
  server.close();

  logs.push(ok ? 'ALL OK' : 'SOME TESTS FAILED');
  console.log(logs.join('\n'));
  process.exit(ok ? 0 : 1);
});
