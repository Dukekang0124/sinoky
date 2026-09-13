#!/usr/bin/env node
/**
 * check-tone-corpus.mjs —— 声调音频语料的交付验收（v0.23.8 FIX · #42）
 *
 * 用途：康哥录完新组音频后跑这一条命令，代替人工逐条听。
 * 它用一个**真解码器**（浏览器 Web Audio）量每条音频的时长/峰值/RMS/有声占比，
 * 并检查同组四条**是不是复制粘贴事故**（内容完全相同 = 只有一条真录了）。
 *
 * ⚠️ 为什么不用「看字节型」代替：本轮的教训 —— 我曾据 MP3 主数据区出现大量
 *    0x55/0xAA 判定 3 条音频是静音，实际解码后 4 条全好（那是编码器 priming 的
 *    正常位型）。**字节型启发式不是有效判据，真解码才是。**
 *
 * 命名约定：assets/tones/<音节>-<声调>.mp3  例如 shi-1.mp3 / wan-4.mp3
 *   旧的 tone1..tone4.mp3（ma 那组的内联副本）也一并纳入体检。
 *
 * 用法：node _internal/fix-2026-09-13/check-tone-corpus.mjs [--root <dir>]
 * 退出码：0 = 全部达标；1 = 有问题（该修）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RI = process.argv.indexOf('--root');
const ROOT = RI >= 0 ? path.resolve(process.argv[RI + 1]) : path.resolve(HERE, '..', '..');
const TONEDIR = path.join(ROOT, 'assets', 'tones');

/* ── 门槛（未达标即报错）──────────────────────────────────────────
   取值依据：现有 4 条合格样本 0.432–0.720 s / peak 0.22–0.32 / rms 0.048–0.068。
   门槛设在样本的 1/3 左右，只拦「明显空壳/极轻/极短」，不拿它卡艺术水准。 */
const MIN_DUR = 0.18;      // 秒
const MAX_DUR = 2.5;       // 秒：单音节不该超过 2.5 s
const MIN_PEAK = 0.06;
const MIN_RMS = 0.012;
const MIN_SOUND = 0.15;    // 有声帧占比下限

const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };

function serveMedia() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const fp = path.join(ROOT, u);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

if (!fs.existsSync(TONEDIR)) {
  console.log('目录不存在：' + TONEDIR + '（还没有人录新音频）');
  process.exit(0);
}

const files = fs.readdirSync(TONEDIR).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f)).sort();
if (!files.length) { console.log('assets/tones/ 里没有音频文件'); process.exit(0); }

// 分组：<syl>-<t>.mp3 → syl；tone<N>.mp3 → 归到 legacy 组
const groups = {};
for (const f of files) {
  const m = f.match(/^(.+?)-([1-4])\.(mp3|m4a|wav|ogg)$/i);
  const key = m ? m[1] : 'legacy(ma)';
  (groups[key] = groups[key] || []).push({ f, tone: m ? Number(m[2]) : Number((f.match(/(\d)/) || [0, 1])[1]) });
}

const digest = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(TONEDIR, f))).digest('hex').slice(0, 12);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serveMedia();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.setContent('<html><body></body></html>');

  const measure = (url) => page.evaluate(async (u) => {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await (await fetch(u)).arrayBuffer();
    const ab = await ac.decodeAudioData(buf);
    const ch = ab.getChannelData(0);
    let peak = 0, sum = 0, nz = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
      sum += ch[i] * ch[i];
      if (v > 0.01) nz++;
    }
    return { dur: +ab.duration.toFixed(3), peak: +peak.toFixed(4), rms: +Math.sqrt(sum / ch.length).toFixed(5), sound: +(nz / ch.length).toFixed(3) };
  }, url);

  let problems = 0;
  const names = Object.keys(groups).sort();
  console.log('\n═══ 声调音频语料体检（' + names.length + ' 组 / ' + files.length + ' 条）═══\n');

  for (const g of names) {
    const items = groups[g].sort((a, b) => a.tone - b.tone);
    console.log('▌ ' + g + '  (' + items.length + ' 条)');
    const hashes = new Map();
    for (const it of items) {
      const h = digest(it.f);
      hashes.set(h, (hashes.get(h) || []).concat(it.f));
      let m;
      try { m = await measure('assets/tones/' + it.f); }
      catch (e) { console.log('   ✗ ' + it.f + '  解码失败：' + (e && e.message)); problems++; continue; }
      const bad = [];
      if (m.dur < MIN_DUR) bad.push('太短 ' + m.dur + 's');
      if (m.dur > MAX_DUR) bad.push('太长 ' + m.dur + 's');
      if (m.peak < MIN_PEAK) bad.push('峰值过低 ' + m.peak);
      if (m.rms < MIN_RMS) bad.push('RMS 过低 ' + m.rms);
      if (m.sound < MIN_SOUND) bad.push('有声占比过低 ' + m.sound);
      if (bad.length) problems++;
      console.log('   ' + (bad.length ? '✗' : '✓') + ' t' + it.tone + '  ' + it.f.padEnd(14) +
        '  ' + String(m.dur).padStart(5) + 's  peak ' + String(m.peak).padStart(6) +
        '  rms ' + String(m.rms).padStart(8) + '  有声 ' + String(m.sound).padStart(5) +
        (bad.length ? '   ⟵ ' + bad.join(' / ') : ''));
    }
    // 复制粘贴事故：同组出现完全相同的文件内容
    for (const [h, fs2] of hashes) {
      if (fs2.length > 1) {
        console.log('   ✗ 内容完全相同（复制粘贴事故）：' + fs2.join(' = ') + '  sha1:' + h);
        problems++;
      }
    }
    const tones = items.map((i) => i.tone).sort().join(',');
    if (tones !== '1,2,3,4') { console.log('   ✗ 声调不齐：只有 ' + tones + '（听辨题需要四声齐）'); problems++; }
  }

  await browser.close(); srv.close();
  console.log('\n──────────────────────────────');
  console.log(problems ? ('发现 ' + problems + ' 处问题 —— 修好再提交') : '全部达标：四声齐、无空壳、无重复内容');
  console.log('──────────────────────────────');
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
