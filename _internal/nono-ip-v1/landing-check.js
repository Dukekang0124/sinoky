const path = require('path');
const { chromium } = require('playwright-core');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const OUT = APP + '/_internal/nono-ip-v1';

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const out = [];
  for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp });
    const errs = [], bad = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('/').slice(-2).join('/')); });
    await p.goto('http://127.0.0.1:8099/landing/index.html', { waitUntil: 'load', timeout: 30000 });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const f = document.querySelector('.nono-hero-fig');
      const box = f ? f.getBoundingClientRect() : null;
      const hz = document.querySelector('.ns-hz');
      const cta = document.querySelector('.cta');
      return {
        hasFig: !!f, nat: f ? f.naturalWidth : 0, natH: f ? f.naturalHeight : 0,
        w: box ? Math.round(box.width) : 0, h: box ? Math.round(box.height) : 0,
        hzText: hz ? hz.textContent.trim() : '',
        pyText: (document.querySelector('.ns-py') || {}).textContent || '',
        over: document.documentElement.scrollWidth - window.innerWidth,
        ctaTop: cta ? Math.round(cta.getBoundingClientRect().top) : 0,
        figBottom: box ? Math.round(box.bottom) : 0,
      };
    });
    out.push([name, r, errs, bad]);
    await p.screenshot({ path: OUT + '/_landing-' + name + '.png' });
    await p.close();
  }
  console.log('\n=== landing 验收 ===');
  let fail = 0;
  for (const [n, r, e, ba] of out) {
    const cases = [
      ['hero 图存在且已解码', r.hasFig && r.nat > 0, r.nat + 'x' + r.natH + ' 渲染 ' + r.w + 'x' + r.h],
      ['零横向溢出', r.over <= 0, 'over=' + r.over],
      ['可跟读中文行正确', r.hzText === '你好' && /nǐ hǎo/.test(r.pyText), r.hzText + ' / ' + r.pyText],
      ['CTA 未被角色挤到首屏外', r.ctaTop > 0 && r.ctaTop < 900, 'ctaTop=' + r.ctaTop + ' figBottom=' + r.figBottom],
      ['无 JS 报错', e.length === 0, e.join('|')],
      ['无 4xx 响应', ba.length === 0, ba.join('|')],
    ];
    for (const [k, v, d] of cases) { if (!v) fail++; console.log('  ' + (v ? 'PASS' : 'FAIL') + ' [' + n + '] ' + k + '  ' + d); }
  }
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
