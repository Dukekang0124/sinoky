const { chromium } = require('playwright');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  console.log((ok ? '✅ PASS' : '❌ FAIL') + ' ' + n + (extra ? '  ' + extra : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p = await c.newPage();

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);

  // T0 vConsole 加载（之前 v0.3.2 没有，这是 v0.3.3 新增）
  const hasVConsole = await p.evaluate(() => typeof window.VConsole === 'function');
  check('T0 vConsole 加载（康哥在手机端能看 console）', hasVConsole);

  // T1 asrText 真实调用：whisper 仍工作
  const realAsr = await p.evaluate(async () => {
    try {
      // 16kHz 1秒静音
      const sr = 16000, n = sr;
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      v.setUint8(0, 0x52); v.setUint8(1, 0x49); v.setUint8(2, 0x46); v.setUint8(3, 0x46);
      v.setUint32(4, 36 + n * 2, true);
      v.setUint8(8, 0x57); v.setUint8(9, 0x41); v.setUint8(10, 0x56); v.setUint8(11, 0x45);
      v.setUint8(12, 0x66); v.setUint8(13, 0x6d); v.setUint8(14, 0x74); v.setUint8(15, 0x20);
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      v.setUint8(36, 0x64); v.setUint8(37, 0x61); v.setUint8(38, 0x74); v.setUint8(39, 0x61);
      v.setUint32(40, n * 2, true);
      const r = await asrText(buf, '你好');
      return r;
    } catch (e) { return { error: e.message }; }
  });
  console.log('=== 真实 asrText 响应 ===');
  console.log(JSON.stringify(realAsr));
  check('T1 真实 asrText 返回结构化对象（不再是裸 null）', realAsr && typeof realAsr === 'object' && 'ok' in realAsr);
  check('T2 真实 asrText 状态码 200', realAsr && realAsr.status === 200, 'status=' + (realAsr && realAsr.status));

  // T3 关键回归：错误信息透出（之前的 null 吞错行为消失）
  // 通过 /api/asr 走一个 mock 404，看 err 是否包含 'http 404'
  const mockTest = await p.evaluate(async () => {
    const origFetch = window.fetch;
    window.fetch = (u, o) => {
      const url = typeof u === 'string' ? u : (u.url || u.toString());
      if (url.indexOf('api/asr') > -1) {
        return Promise.resolve(new Response('mock 404 body', { status: 404, statusText: 'Not Found' }));
      }
      return origFetch(u, o);
    };
    const r = await asrText(new ArrayBuffer(1000), 'mock test');
    window.fetch = origFetch;
    return r;
  });
  console.log('=== mock 404 响应 ===');
  console.log(JSON.stringify(mockTest));
  check('T3 mock 404 → err 包含 "http 404"（不吞错核心证据）', mockTest && /http 404/.test(mockTest.err || ''));

  // T4 短录音检测存在（用 evaluate 找到 onstop 中的 if(blob.size < 500)）
  const shortGuard = await p.evaluate(async () => {
    // 通过执行实际"录音停止"路径：构造小 blob
    const tiny = new Blob([new Uint8Array(300)], { type: 'audio/webm' });
    // 触发 onstop 不行（onstop 是 closure），改为静态检查源码
    const src = document.documentElement.outerHTML;
    return src.includes('blob.size < 500') && src.includes('No sound captured');
  });
  check('T4 短录音 <500B 检测 + 友好提示存在', shortGuard);

  // T5 零 JS 错误
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.waitForTimeout(500);
  check('T5 零 JS 错误（除 favicon）', errs.filter(e => !/favicon/i.test(e)).length === 0, JSON.stringify(errs.slice(0, 2)));

  console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
