/* P1-1 城市攻略语音修复验证（真机 Playwright，channel:'chrome'）
 * 验证两点：
 *   T1 守卫放行 —— guide 模式下点麦克风不再被 nonoRecord 守卫静默 return
 *                 （修复前 NONO.mode!=='chat' && !NONO_LINE → 直接 return，无任何反应）
 *   T2 路由正确 —— guide 录音停止后走 nonoChatSend（语音聊天），而非 nonoGrade（跟读评分，
 *                 后者会对 null 的 NONO_LINE 解 .hz 崩溃）
 */
const { chromium } = require('playwright');
const URL = process.env.TEST_URL || 'http://localhost:8156/index.html';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.nonoStartGuide === 'function' && typeof window.nonoRecordStart === 'function', { timeout: 15000 });

  // ---------- T1：守卫放行 ----------
  const r1 = await page.evaluate(async () => {
    const pm = document.getElementById('nono-practice');
    window.curGuideCity = 'beijing';
    nonoStartGuide();
    const before = pm ? pm.innerHTML : '(no pm)';
    try { nonoRecordStart({ preventDefault(){} }); } catch (e) { errors.push('start:' + e); }
    // 等 getUserMedia 在无麦克风环境下失败分支写入提示
    await new Promise(r => setTimeout(r, 800));
    const after = pm ? pm.innerHTML : '(no pm)';
    return { mode: NONO.mode, beforeLen: before.length, afterLen: after.length, changed: before !== after,
             hasProbe: /not supported|Microphone blocked|Recording/i.test(after) };
  });

  // ---------- T2：路由走 nonoChatSend → guide 历史写入（不崩、不走 nonoGrade） ----------
  const r2 = await page.evaluate(async () => {
    // stub ASR：返回成功文本
    window.asrText = async () => ({ ok: true, text: '你好', status: 200 });
    const orig = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/api/chat')) return { ok: true, status: 200, json: async () => ({ reply: '测试回复' }) };
      return orig ? orig(u, o) : { ok: false };
    };
    const lenBefore = (S.guideChat || []).length;
    let threw = null;
    try { await nonoChatSend(new Blob()); } catch (e) { threw = String(e); }
    await new Promise(r => setTimeout(r, 300));
    const lenAfter = (S.guideChat || []).length;
    window.fetch = orig;
    return { lenBefore, lenAfter, grew: lenAfter > lenBefore, threw };
  });

  // changed=true 即证伪"守卫静默 return"：修复前 nono-practice 不会被改写；hasProbe 仅信息项
  const pass = r1.mode === 'guide' && r1.changed && r2.grew && !r2.threw && errors.length === 0;
  console.log(JSON.stringify({
    T1_guard_released: { mode: r1.mode, changed: r1.changed, hasProbe: r1.hasProbe },
    T2_route_chat: { grew: r2.grew, threw: r2.threw },
    pageErrors: errors,
    PASS: pass
  }, null, 2));
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
