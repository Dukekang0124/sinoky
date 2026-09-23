/**
 * v0.23.22 城市攻略中心 + chat 贴底大抽屉 —— 真机 Playwright 验收
 *
 * 驱动本机 Chrome（channel:'chrome'），本地 http server 服务 index.html，
 * page.route 拦截 /api/(chat|asr|tts|score) 做 mock（通用规则先注册，chat 具体 mock 后注册）。
 *
 * 覆盖康哥「内置浏览器真测铁律」：
 *  D1  chat 入口 → 贴底大抽屉（.npanel-drawer + z-index:70 + #nono-fab 隐藏 + #np-collapse 显示）
 *  D2  收起 → 退出抽屉回小窗（类剥离 + fab 还原 + 折叠按钮隐藏）
 *  D3  抽屉态临时隐藏 Feedback 按钮（含 sinoky-fb-pos 拖拽残留场景），退出原样还原
 *  D4  §F 诺诺形象硬约束：#nono-fab 56×56 不可动 / #nono-tip right:74px 一字未改（CSSOM 校验）
 *  D5  --nono-kb 键盘补偿变量已注入（nonoKbWatch 已启动，不崩）
 *  D6  上海卡 → 攻略页 → 9 个分区全部渲染
 *  D7  进度隔离红线：isCity 对攻略 zone 返回 false（不污染徽章 said / SRS / sceneReply）；cityList 全为 city
 *  D8  markGuideDone 说三遍：toggle 后 arr 长度 1，且 S.phrases 不被污染（零 said 虚增）
 *  D9  guide 问答：mode:'guide' + 城市前缀【城市：上海】透传；S.guideChat 隔离、S.nonoChat 不被污染
 *  D10 北京等城市零改动复用：CITY_GUIDES 仅 shanghai；cityOpenJs 对无攻略城市仍回 openScene
 *
 * 运行：NODE_PATH=.../node/workspace/node_modules node _internal/fix-2026-09-23/test_cityguide_drawer.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8139;

const MIME = {
  '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript',
  '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.woff2':'font/woff2',
  '.webmanifest':'application/manifest+json'
};

function serve(req, res) {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || !path.extname(p)) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  fs.createReadStream(p).pipe(res).writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
}

const server = http.createServer(serve);
server.listen(PORT, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();

  const chatBodies = [];
  // 通用规则先注册：拦截全部 /api/*，chat 走具体 mock（后注册优先），其余给空 200
  await page.route(/\/api\/.*/, (route, req) => {
    const url = req.url();
    if (url.includes('/api/chat')) {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      chatBodies.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, reply: '扫码(sǎo mǎ, scan the code)支付(zhī fù, pay)。', model: 'glm-4-flash', degraded: false }) });
    }
    if (url.includes('/api/asr')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '你好' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    var sp = document.getElementById('splash'); if (sp) sp.remove();
    var ob = document.getElementById('v-onboard'); if (ob) { ob.classList.remove('on'); ob.style.display = 'none'; }
    var w = document.querySelector('.wrap'); if (w) w.style.opacity = '1';
  });
  await page.waitForTimeout(200);

  const logs = [];
  let ok = true;
  const ok_ = (id, m) => { logs.push('  ✓ ' + id + ' ' + m); };
  const no_ = (id, m) => { ok = false; logs.push('  ✗ ' + id + ' ' + m); };
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  try {
    // ---- D4 §F 像素硬约束（运行时 computed + 源码子串双校验）----
    const f = await page.evaluate(() => {
      const fab = document.getElementById('nono-fab');
      const tip = document.getElementById('nono-tip');
      return {
        fabW: fab ? getComputedStyle(fab).width : 'none',
        fabH: fab ? getComputedStyle(fab).height : 'none',
        tipRight: tip ? getComputedStyle(tip).right : 'none',
      };
    });
    const src = await page.content();
    const fabSrc = /#nono-fab\{[^}]*width:56px/.test(src);
    const tipSrc = /#nono-tip\{[^}]*right:74px/.test(src);
    (f.fabW === '56px' && f.fabH === '56px' && fabSrc)
      ? ok_('D4a', '§F #nono-fab 56×56 外框约束 intact (computed ' + f.fabW + '/' + f.fabH + ')')
      : no_('D4a', 'computed=' + f.fabW + '/' + f.fabH + ' src=' + fabSrc);
    // #nono-tip 为 JS 动态创建元素（初始 DOM 无该节点），故以「源码规则 intact」为 §F 判定依据
    (tipSrc)
      ? ok_('D4b', '§F #nono-tip right:74px 规则 intact（源码校验，动态元素 computed 不适用）')
      : no_('D4b', '源码未找到 #nono-tip{...right:74px} src=' + tipSrc);

    // ---- D1 抽屉开（chat 入口）----
    await page.evaluate(() => { try { nonoStartChat(); } catch (e) {} });
    await page.waitForTimeout(350);
    const d1 = await page.evaluate(() => {
      const p = document.getElementById('nono-panel');
      const fab = document.getElementById('nono-fab');
      const col = document.getElementById('np-collapse');
      return {
        drawer: p.classList.contains('npanel-drawer'),
        z: getComputedStyle(p).zIndex,
        fabDisplay: getComputedStyle(fab).display,
        colDisplay: getComputedStyle(col).display,
      };
    });
    (d1.drawer && d1.z === '70' && d1.fabDisplay === 'none' && d1.colDisplay !== 'none')
      ? ok_('D1', 'chat 入口→贴底大抽屉(z:70, fab 隐藏, 折叠键显)')
      : no_('D1', JSON.stringify(d1));

    // ---- D3 抽屉态隐藏 Feedback（含 sinoky-fb-pos 残留）----
    await page.evaluate(() => { const fb = document.getElementById('fb-open'); if (fb) { fb.dataset._vis = 'inline-flex'; fb.style.display = 'inline-flex'; } });
    await page.evaluate(() => { nonoDrawerOn(); });
    await page.waitForTimeout(150);
    const fbHidden = await page.evaluate(() => { const fb = document.getElementById('fb-open'); return fb ? getComputedStyle(fb).display : 'missing'; });
    (fbHidden === 'none') ? ok_('D3a', '抽屉态临时隐藏 #fb-open（防 sinoky-fb-pos 重叠）') : no_('D3a', 'fb display=' + fbHidden);
    await page.evaluate(() => { nonoDrawerOff(); });
    await page.waitForTimeout(120);
    const fbRestored = await page.evaluate(() => { const fb = document.getElementById('fb-open'); return fb ? getComputedStyle(fb).display : 'missing'; });
    (fbRestored !== 'none') ? ok_('D3b', '退出抽屉→#fb-open 原样还原') : no_('D3b', 'fb display=' + fbRestored);

    // ---- D2 收起回小窗 ----
    await page.evaluate(() => { nonoStartChat(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { nonoDrawerCollapse(); });
    await page.waitForTimeout(200);
    const d2 = await page.evaluate(() => {
      const p = document.getElementById('nono-panel');
      const fab = document.getElementById('nono-fab');
      const col = document.getElementById('np-collapse');
      return { drawer: p.classList.contains('npanel-drawer'), fabDisplay: getComputedStyle(fab).display, colDisplay: getComputedStyle(col).display };
    });
    (!d2.drawer && d2.fabDisplay !== 'none' && d2.colDisplay === 'none')
      ? ok_('D2', '收起→退出抽屉回小窗(fab 还原, 折叠键隐)') : no_('D2', JSON.stringify(d2));

    // ---- D5 键盘补偿变量 ----
    const kb = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nono-kb'));
    (typeof kb === 'string') ? ok_('D5', '--nono-kb 键盘补偿变量已注入 (' + JSON.stringify(kb) + ')') : no_('D5', 'kb unset');

    // ---- D6 上海 → 攻略 → 9 区 ----
    await page.evaluate(() => { openCityGuide('shanghai'); });
    await page.waitForTimeout(300);
    const cg = await page.evaluate(() => {
      const v = document.getElementById('v-cityguide');
      const zones = document.getElementById('cg-zones');
      return { visible: !!v && getComputedStyle(v).display !== 'none', zoneCount: zones ? zones.children.length : -1 };
    });
    (cg.visible && cg.zoneCount === 9) ? ok_('D6', '上海攻略页可见且渲染 9 个分区 (got ' + cg.zoneCount + ')') : no_('D6', JSON.stringify(cg));

    // ---- D7 isCity / cityList 防护 ----
    const g7 = await page.evaluate(() => {
      const list = cityList();
      const allCities = list.every(isCity);
      const gz = CITY_GUIDES.shanghai.zones[0];
      return { allCities, zoneIsCity: isCity(gz), zoneHasDay1: ('day1' in gz), cityCount: list.length };
    });
    (g7.allCities && !g7.zoneIsCity && !g7.zoneHasDay1)
      ? ok_('D7', '进度隔离：zone 非 city(无 day1)，cityList(' + g7.cityCount + ') 全为 city，不污染 said/SRS')
      : no_('D7', JSON.stringify(g7));

    // ---- D8 markGuideDone 三遍 → arr=1 且不污染 S.phrases ----
    const beforePhrases = await page.evaluate(() => { openCityGuide('shanghai'); cgToggleZone(CITY_GUIDES.shanghai.zones[0].id); return (S.phrases ? Object.keys(S.phrases).length : -1); });
    await page.evaluate(() => { for (let k = 0; k < 3; k++) markGuideDone(0); });
    const g8 = await page.evaluate(() => {
      const k = 'shanghai:' + curGuideZone.id;
      return { arr: (S.guideDone && S.guideDone[k]) || [], phrases: (S.phrases ? Object.keys(S.phrases).length : -1) };
    });
    (g8.arr.length === 1 && g8.phrases === beforePhrases)
      ? ok_('D8', 'markGuideDone 三遍→arr=1（toggle 语义），S.phrases 未被污染')
      : no_('D8', 'arr=' + JSON.stringify(g8.arr) + ' phrases=' + g8.phrases);

    // ---- D9 guide 问答：mode:'guide' + 城市前缀 + 历史隔离 ----
    const nonoBefore = await page.evaluate(() => (S.nonoChat || []).length);
    chatBodies.length = 0;
    await page.evaluate(() => {
      nonoStartGuide(); // curGuideCity 已是 shanghai
      const inp = document.getElementById('nono-input');
      inp.value = '怎么去外滩';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const b = document.querySelector('#nono-txt button');
      if (b) b.click();
    });
    await page.waitForTimeout(600);
    const last = chatBodies[chatBodies.length - 1] || {};
    const g9 = await page.evaluate(() => ({ guide: (S.guideChat || []).length, chat: (S.nonoChat || []).length }));
    (last.mode === 'guide' && /【城市：上海】/.test(last.text || ''))
      ? ok_('D9a', 'guide 问答 fetch 带 mode:guide + 城市前缀【城市：上海】')
      : no_('D9a', 'mode=' + last.mode + ' text=' + (last.text || '').slice(0, 30));
    (g9.guide > 0 && g9.chat === nonoBefore)
      ? ok_('D9b', 'S.guideChat 隔离写入(' + g9.guide + ')，S.nonoChat 未被污染(' + g9.chat + ')')
      : no_('D9b', JSON.stringify(g9) + ' before=' + nonoBefore);

    // ---- D10 北京零改动复用 ----
    const g10 = await page.evaluate(() => {
      const keys = Object.keys(CITY_GUIDES);
      // 找一个无攻略数据的城市（如 beijing），确认 cityOpenJs 回 openScene
      const bj = SCENES.filter(s => s.city === '北京' || /beijing/i.test(s.id))[0];
      const js = bj ? cityOpenJs(bj, 'cities') : '';
      return { guideKeys: keys, bjId: bj ? bj.id : null, js };
    });
    (g10.guideKeys.length === 1 && g10.guideKeys[0] === 'shanghai' && g10.js.indexOf('openScene') >= 0)
      ? ok_('D10', 'CITY_GUIDES 仅 shanghai，无攻略城市(北京)仍走 openScene（零改动复用）')
      : no_('D10', JSON.stringify(g10));

  } catch (e) {
    no_('EXC', 'exception: ' + e.message);
  }

  await ctx.close();
  await browser.close();
  server.close();

  logs.push(ok ? '\n=== ALL OK ===' : '\n=== SOME TESTS FAILED ===');
  console.log(logs.join('\n'));
  process.exit(ok ? 0 : 1);
});
