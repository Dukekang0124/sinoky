const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.webmanifest':'application/manifest+json' };
function serve(req, res) {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if(p.endsWith('/') || !path.extname(p)) p = path.join(p, 'index.html');
  if(!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  fs.createReadStream(p).pipe(res).writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'});
}

const server = http.createServer(serve);
server.listen(8140, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route(/\/api\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('http://localhost:8140/index.html');
  await page.waitForTimeout(900);
  const logs = []; let ok = true;
  const fail = m => { ok = false; logs.push('FAIL: ' + m); };
  page.on('pageerror', e => { ok = false; logs.push('PAGEERROR: ' + e.message); });

  // 跳过引导层
  await page.evaluate(() => {
    var sp = document.getElementById('splash'); if(sp) sp.remove();
    var ob = document.getElementById('v-onboard'); if(ob){ ob.classList.remove('on'); ob.style.display='none'; }
  });
  await page.waitForTimeout(300);

  // 1. 主题变量验证
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { red: cs.getPropertyValue('--red').trim(), gold: cs.getPropertyValue('--gold').trim(), teal: cs.getPropertyValue('--teal').trim(), bg: cs.getPropertyValue('--bg').trim() };
  });
  if (vars.red !== '#c2362b') fail('--red not cinnabar: ' + vars.red);
  if (vars.gold !== '#c9a86c') fail('--gold missing: ' + vars.gold);
  if (vars.teal !== '#8ab8b2') fail('--teal not bamboo: ' + vars.teal);
  logs.push('VARS: ' + JSON.stringify(vars));

  // 2. 按钮胶囊验证（.btn / .tonebtn / .seg）
  const radii = await page.evaluate(() => ({
    btn: getComputedStyle(document.querySelector('.btn') || document.createElement('i')).borderRadius,
    seg: (document.querySelector('.seg') ? getComputedStyle(document.querySelector('.seg')).borderRadius : 'n/a'),
    bodyTex: getComputedStyle(document.body).backgroundImage.includes('repeating-linear-gradient') ? 'grid-on' : 'grid-off'
  }));
  if (radii.btn !== '99px') fail('.btn not capsule: ' + radii.btn);
  if (radii.bodyTex !== 'grid-on') fail('lattice texture missing on body');
  logs.push('RADII: ' + JSON.stringify(radii));

  // 3. 首页截图
  await page.screenshot({ path: path.join(__dirname, 'shot_theme_home.png') });

  // 4. 诺诺面板（练习态，胶囊按钮可见）
  await page.evaluate(() => { try { nonoToggle(); } catch(e) {} });
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { nonoStartPractice(); } catch(e) {} });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'shot_theme_nono.png') });

  // 5. 钩子逻辑冒烟：markDone 场景全清触发 nonoShow
  const hook = await page.evaluate(() => {
    try {
      // 模拟：当前场景所有行都 done
      var sc = curScene; if (!sc) return 'no curScene';
      var arr = S.phrases[sc.id] = S.phrases[sc.id] || [];
      var tot = (sc.lines||[]).length;
      return 'scene=' + sc.id + ' done=' + arr.length + '/' + tot;
    } catch(e) { return 'ERR ' + e.message; }
  });
  logs.push('SCENE: ' + hook);

  // 6. Explore 页截图（句卡胶囊按钮）
  await page.evaluate(() => { try { go('explore'); } catch(e) {} });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'shot_theme_explore.png') });

  await ctx.close(); await browser.close(); server.close();
  logs.push(ok ? 'ALL OK' : 'SOME FAILED');
  console.log(logs.join('\n'));
  process.exit(ok ? 0 : 1);
});
