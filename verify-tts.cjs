const { chromium } = require('playwright');

const URL = 'https://sinoky.pages.dev/';
let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  console.log((ok ? '✅ PASS' : '❌ FAIL') + ' ' + n + (extra ? '  ' + extra : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  const errs = [];
  const tts = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('response', async r => {
    if (/api\/tts|dictvoice|translate_tts|text2audio/i.test(r.url())) {
      let len = -1; let src = '';
      try { const buf = await r.body(); len = buf.length; } catch (e) {}
      try { src = r.headers()['x-tts-source'] || ''; } catch (e) {}
      tts.push({ url: r.url().slice(0, 60), status: r.status(), bytes: len, src });
    }
  });

  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  // T1 version
  const ver = await p.evaluate(async () => {
    const r = await fetch('version.json?t=' + Date.now());
    const j = await r.json(); return j.version;
  });
  check('T1 线上版本 0.3.2', ver === '0.3.2', 'got ' + ver);

  // 进场景
  await p.click('#home-scenes button');
  await p.waitForTimeout(1200);

  // T2 点播放，验证真的出声（通过 audio duration 判断）
  const audioProof = await p.evaluate(async () => {
    // 直接调用页面的 speak 链路所用的同一端点，验证真实可播放
    const resp = await fetch('api/tts?text=' + encodeURIComponent('你好'));
    if (!resp.ok) return { ok: false, why: 'http ' + resp.status };
    const blob = await resp.blob();
    if (blob.size < 1000) return { ok: false, why: 'too small ' + blob.size };
    const url = URL.createObjectURL(blob);
    return await new Promise(res => {
      const a = new Audio(url);
      const t = setTimeout(() => res({ ok: false, why: 'timeout', size: blob.size }), 12000);
      a.onloadedmetadata = () => { clearTimeout(t); res({ ok: true, duration: +a.duration.toFixed(2), size: blob.size, type: blob.type }); };
      a.onerror = () => { clearTimeout(t); res({ ok: false, why: 'decode error', size: blob.size }); };
      a.load();
    });
  });
  check('T2 /api/tts 返回可播放音频（duration>0）', audioProof.ok === true && audioProof.duration > 0, JSON.stringify(audioProof));

  // T3 点真实播放按钮，观察链路
  await p.click('.spk');
  await p.waitForTimeout(7000);
  check('T3 播放按钮触发了 TTS 请求', tts.length > 0, JSON.stringify(tts.slice(-2)));

  const good = tts.filter(t => t.bytes > 1000);
  check('T4 至少一个音源返回有效音频(>1KB)', good.length > 0, 'good=' + good.length + ' of ' + tts.length);
  if (good.length) check('T5 主音源为 Worker(google/melotts/youdao)', !!good[0].src, 'src=' + good[0].src);

  // T6 慢放可用
  const slowOk = await p.evaluate(async () => {
    const r = await fetch('api/tts?text=' + encodeURIComponent('谢谢'));
    return r.ok && (await r.blob()).size > 1000;
  });
  check('T6 慢放音源可用（同一链路）', slowOk === true);

  // T7 界面零中文残留（学习汉字除外）
  const hasChineseUI = await p.evaluate(() => {
    const bad = ['评分', '识别失败', '麦克风', '评分中', '请允许', '无法启动'];
    const t = document.body.innerText;
    return bad.filter(x => t.includes(x));
  });
  check('T7 界面无中文 UI 残留', hasChineseUI.length === 0, JSON.stringify(hasChineseUI));

  check('T8 零 JS 错误', errs.filter(e => !/favicon/i.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));

  console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
