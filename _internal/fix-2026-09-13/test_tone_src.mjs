/**
 * test_tone_src.mjs —— 声调音频「接受哪些 src」的 A/B 验收（v0.23.8 FIX · #42 组 5）
 *
 * 待验命题：修改前 `playToneAudio` 只认 `data:audio` 开头的 src，
 * 于是「新音频用 assets/tones/*.mp3 文件路径」会**静默失效**（播放键毫无反应）。
 * 修改后应同时接受 data URI 与文件路径，且无效 src 仍被挡住。
 *
 * A/B：同一套断言跑两遍 —— A 组当前工作区（已修），B 组基线版 BASE_REF（未修）。
 * B 组必须在「文件路径」这一项上失败，否则说明这个改动是多余的（前提不成立）。
 *
 * 判据取 `window.AUDIO.src`（播放器实际拿到的地址），不看 UI 文案 ——
 * UI 文案受自动播放策略与异步事件影响，不可靠；`src` 是否被赋值是同步确定的事实。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('    \u2705 ' + m); };
const no = (m) => { fail++; console.log('    \u274c ' + m); };
/* 基线必须钉死到「修复前的那个提交」，不能取 git HEAD：
   修复一旦提交，HEAD 就变成新版，A/B 前提当场失效 ——
   脚本会以「旧版竟然已修复」的形式报假缺陷。
   （本项目实测过一次：提交 v0.23.8 后 test_sw / test_tone_src / test_selfsrc
     的 B 组集体变红，而产品侧毫无问题。）
   307764a = v0.23.7，是这几件修复落地前的最后一个提交，永久存在于历史里。
   基线过期时跳过而不是失败 —— 不让它伪装成产品缺陷。 */
const BASE_REF = process.env.SINOKY_BASE_REF || '307764a';
let skip = 0;
const skp = (m) => { skip++; console.log('    ' + String.fromCharCode(0x23ed) + '  ' + m); };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
};

const BASE_INDEX = (() => {
  const r = spawnSync('git', ['show', BASE_REF + ':index.html'], { cwd: APP, encoding: 'utf8' });
  return (r.status === 0 && r.stdout) ? r.stdout : '';
})();
/* 基线是否过期：基线里不该已经出现这次新增的 toneAudioOk() */
const BASE_STALE = !BASE_INDEX || BASE_INDEX.includes('toneAudioOk');

/** idxOverride 非空时用它替换 /index.html 的响应体 */
function serve(idxOverride) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if ((u === '/' || u === '/index.html') && idxOverride !== null) {
        resp.writeHead(200, { 'Content-Type': MIME['.html'] }); return resp.end(idxOverride);
      }
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(APP, rel);
      if (!fp.startsWith(APP) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/** 在页面上依次试 4 种 src，返回每种的「播放器是否真的吃下了」 */
async function probe(page, port) {
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  // 全新 profile 会停在首启引导（v-onboard），听辨卡在 home 视图里 ⇒ 先切过去
  await page.evaluate(() => {
    try { if (typeof window.go === 'function') window.go('home'); } catch (e) {}
    try { if (typeof window.renderHome === 'function') window.renderHome(); } catch (e) {}
  });
  await page.waitForTimeout(150);
  return await page.evaluate(() => {
    const reset = () => { window.AUDIO = null; };
    const trySrc = (src, useEar) => {
      reset();
      try {
        if (useEar) window.playToneAudio({ audio: src }, 'ear-play');
        else window.playToneAudio({ audio: src });
      } catch (e) { return { err: String(e && e.message) }; }
      const a = window.AUDIO;
      return { got: a ? String(a.src) : '' };
    };
    const out = {};
    out.before = String((window.AUDIO && window.AUDIO.src) || '');
    out.hasToneAudioOk = (typeof window.toneAudioOk === 'function');
    out.earBtnText0 = (document.querySelector('#ear-play') || {}).textContent || null;
    out.file = trySrc('assets/tones/tone2.mp3', true);
    out.earBtnTextAfterBad = null;
    out.abs = trySrc('/assets/tones/tone4.mp3', true);
    out.data = trySrc('data:audio/mpeg;base64,//PkxAAAAAAAA', true);
    out.junk = trySrc('not-audio-at-all', true);
    out.earBtnTextAfterJunk = (document.querySelector('#ear-play') || {}).textContent || null;
    return out;
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    // ═══════ A 组：当前工作区（已修） ═══════
    console.log('\n=== A. 当前工作区（已修）===');
    let A;
    {
      const { srv, port } = await serve(null);
      const page = await browser.newPage();
      A = await probe(page, port);
      A.hasToneAudioOk ? ok('A0 toneAudioOk() 已就位') : no('A0 缺 toneAudioOk()');
      /assets\/tones\/tone2\.mp3$/.test(A.file.got)
        ? ok('A1 **相对文件路径被接受** ⇒ ' + A.file.got)
        : no('A1 相对路径未被接受（got="' + (A.file.got || '') + '"）');
      /assets\/tones\/tone4\.mp3$/.test(A.abs.got)
        ? ok('A2 绝对路径被接受')
        : no('A2 绝对路径未被接受（got="' + (A.abs.got || '') + '"）');
      /^data:audio\/mpeg/.test(A.data.got)
        ? ok('A3 data URI 仍被接受（向后兼容 Tone Gym）')
        : no('A3 data URI 反而不认了 —— 回归！');
      A.junk.got === ''
        ? ok('A4 无效 src 仍被挡住（不会去加载垃圾）')
        : no('A4 无效 src 被放行：' + A.junk.got);
      A.earBtnText0 !== null
        ? ok('A5 听辨卡播放键 #ear-play 存在于 DOM')
        : no('A5 找不到 #ear-play（听辨卡未渲染，无法验按钮态）');
      /Tap to retry/.test(A.earBtnTextAfterJunk || '')
        ? ok('A6 无声/坏音频时听辨卡显示「↻ Tap to retry」：' + JSON.stringify(A.earBtnTextAfterJunk))
        : no('A6 听辨卡在坏音频下仍无反馈：' + JSON.stringify(A.earBtnTextAfterJunk));
      await page.close(); srv.close();
    }

    // ═══════ B 组：基线版（按 BASE_REF 取，未修） ═══════
    console.log('\n=== B. 基线版（' + BASE_REF + '，未修）—— 应在「文件路径」上失败 ===');
    if (!BASE_STALE) {
      const { srv, port } = await serve(BASE_INDEX);
      const page = await browser.newPage();
      const B = await probe(page, port);
      !B.hasToneAudioOk ? ok('B0 基线版没有 toneAudioOk()（证明是新增能力）')
                        : no('B0 基线版竟然已有 toneAudioOk() —— A/B 前提不成立');
      B.file.got === ''
        ? ok('B1 **基线版拒绝文件路径**（AUDIO.src 保持空）⇒ 本改动确有必要')
        : no('B1 基线版竟然接受了文件路径：' + B.file.got);
      /^data:audio\/mpeg/.test(B.data.got)
        ? ok('B2 基线版接受 data URI（两组唯一共同点）')
        : no('B2 基线版连 data URI 都不认，A/B 不可比');
      !/Tap to retry/.test(B.earBtnTextAfterJunk || '')
        ? ok('B3 基线版坏音频时听辨卡键无反馈：' + JSON.stringify(B.earBtnTextAfterJunk))
        : no('B3 基线版竟然有反馈');
      await page.close(); srv.close();
    } else {
      skp('B0-B3 基线 ' + BASE_REF + ' 已有 toneAudioOk()（基线过期）⇒ 跳过 A/B；修复：把 BASE_REF 改成更早的提交');
    }
  } finally {
    await browser.close();
  }
  console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' 跳过（A/B 基线过期）' : ''));
  console.log('──────────────────────────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
