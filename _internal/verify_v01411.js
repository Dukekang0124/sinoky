const { chromium } = require('playwright');
const path = require('path');
const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');
const OLD_RED = 'rgb(230, 57, 70)';
const NEW_RED = 'rgb(194, 54, 43)';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().replace('http://127.0.0.1:8899', '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(({ OLD_RED, NEW_RED }) => {
    const hl = document.querySelector('#v-onboard h1 .hl');
    const cta = document.querySelector('#v-onboard .ob-btn, #v-onboard button');
    const chip = document.querySelector('#v-onboard .ob-chip');
    const segOn = document.querySelector('.seg button.on');
    const items = [hl, cta, chip, segOn].filter(Boolean);
    const colors = items.map(e => getComputedStyle(e).color + ' | ' + getComputedStyle(e).backgroundColor);
    const all = [...document.querySelectorAll('*')].map(e => {
      const cs = getComputedStyle(e);
      return cs.color + ' ' + cs.backgroundColor + ' ' + cs.borderTopColor + ' ' + cs.borderLeftColor;
    }).join(' ');
    return {
      onboard_active: !!document.querySelector('#v-onboard.views.on'),
      hl_color: hl ? getComputedStyle(hl).color : 'n/a',
      cta_radius: cta ? getComputedStyle(cta).borderRadius : 'n/a',
      cta_bg: cta ? getComputedStyle(cta).backgroundColor : 'n/a',
      chip_border: chip ? getComputedStyle(chip).borderColor : 'n/a',
      old_red_nodes: (all.match(/230, 57, 70/g) || []).length,
      new_red_nodes: (all.match(/194, 54, 43/g) || []).length,
      theme_red_var: getComputedStyle(document.documentElement).getPropertyValue('--red').trim(),
      theme_color_meta: (document.querySelector('meta[name=theme-color]') || {}).content,
    };
  }, { OLD_RED, NEW_RED });

  console.log('=== 引导页换肤验收 ===');
  console.log(JSON.stringify(r, null, 1));
  console.log('\n判定:');
  console.log('  引导页 h1 高亮 = 新朱砂?', r.hl_color === NEW_RED ? '✅ PASS' : `❌ FAIL (${r.hl_color})`);
  console.log('  引导页 CTA 胶囊 99px?', r.cta_radius === '99px' ? '✅ PASS' : `❌ FAIL (${r.cta_radius})`);
  console.log('  页面内旧洋红节点数 = 0?', r.old_red_nodes === 0 ? '✅ PASS' : `❌ FAIL (${r.old_red_nodes})`);
  console.log('  theme-color = #161a20?', r.theme_color_meta === '#161a20' ? '✅ PASS' : `❌ FAIL (${r.theme_color_meta})`);
  await page.screenshot({ path: path.join(OUT, 'verify_onboard_newred.png') });

  // 抽检使用旧 rgba tint 的页面
  await page.evaluate(() => { if (typeof go === 'function') go('days'); });
  await page.waitForTimeout(1500);
  const days = await page.evaluate(() => {
    const el = document.querySelector('.daytab.on, .dayrow.exp, .day1');
    const all = [...document.querySelectorAll('#v-days *')].map(e => {
      const cs = getComputedStyle(e); return cs.backgroundColor + ' ' + cs.borderTopColor + ' ' + cs.color;
    }).join(' ');
    return { sample_bg: el ? getComputedStyle(el).backgroundColor : 'n/a',
             old_red: (all.match(/230, 57, 70/g) || []).length,
             new_red: (all.match(/194, 54, 43/g) || []).length };
  });
  console.log('\n=== 天数页 tint 抽检 ===', JSON.stringify(days));
  await page.screenshot({ path: path.join(OUT, 'verify_days_newred.png') });

  console.log('\nfailed requests:', failed.length ? failed : 'none');
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
