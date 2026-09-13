/**
 * test_tone_audio.mjs —— 声调音频「到底有没有声音」的客观验收
 *
 * 起因：审计 P1-1 说「听辨题库仅 1 组，目标是 ≥5 组」。
 * 但 LISTEN_Q 是数据驱动的（加一组只要 4 条音频），而它复用 TONES 的 4 条 base64。
 * 解码 TONES 后发现：4 条里 3 条的主数据区大量 `0x55`/`0xAA` —— 这是 MP3 编码
 * **数字静音**的典型位型。也就是说：在讨论「扩到 5 组」之前，先得确认**现有 1 组是好的**。
 *
 * 判据不看字节型（会有误判），直接丢给浏览器的 Web Audio 解码后算 RMS 与峰值：
 *   · duration  < 0.05s        ⇒ 空壳
 *   · peak      < 0.02         ⇒ 近乎无声
 *   · rms       < 0.005        ⇒ 无声
 * 三档同时报数，避免「过/不过」式的单点判据。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
};

function serve(root) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(root, rel);
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serve(APP);
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });

    const rows = await page.evaluate(async () => {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const out = [];
      const items = (window.TONES || []).map((t) => ({ hz: t.hz, py: t.py, t: t.t, audio: t.audio }));
      for (const it of items) {
        const rec = { hz: it.hz, py: it.py, tone: it.t, b64len: (it.audio || '').length };
        try {
          const b64 = it.audio.split('base64,')[1] || '';
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          const ab = await ac.decodeAudioData(buf.buffer);
          const ch = ab.getChannelData(0);
          let peak = 0, sum = 0, nz = 0;
          for (let i = 0; i < ch.length; i++) {
            const v = Math.abs(ch[i]);
            if (v > peak) peak = v;
            sum += ch[i] * ch[i];
            if (v > 0.01) nz++;
          }
          rec.dur = +ab.duration.toFixed(3);
          rec.sr = ab.sampleRate;
          rec.peak = +peak.toFixed(4);
          rec.rms = +Math.sqrt(sum / ch.length).toFixed(5);
          rec.soundingRatio = +(nz / ch.length).toFixed(3);
        } catch (e) {
          rec.err = String(e && e.message);
        }
        out.push(rec);
      }
      return out;
    });

    let bad = 0;
    console.log('\n=== TONES 四条声调音频（Web Audio 真解码）===');
    console.log('  汉字  拼音  时长s   采样率  峰值     RMS      有声占比');
    for (const r of rows) {
      if (r.err) { console.log('  ' + r.hz + ' 解码失败：' + r.err); bad++; continue; }
      const flag = (r.dur < 0.05 || r.peak < 0.02 || r.rms < 0.005) ? '  ⟵ 静音/空壳' : '';
      if (flag) bad++;
      console.log('  %s    %s   %s   %s  %s  %s   %s%s',
        r.hz.padEnd(4), String(r.py).padEnd(5), String(r.dur).padStart(5),
        String(r.sr).padStart(6), String(r.peak).padStart(6), String(r.rms).padStart(8),
        String(r.soundingRatio).padStart(6), flag);
    }

    console.log('\n──────────────────────────────');
    console.log(bad ? ('有 ' + bad + ' 条音频无有效声音 ⇒ 声调练习/听辨的题面是哑的')
                    : '四条音频均有有效声音（时长/峰值/RMS 三项达标）');
    console.log('──────────────────────────────');
    process.exit(0);   // 本脚本是「体检报告」，不设 exit 门槛（结论交给人判断）
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
