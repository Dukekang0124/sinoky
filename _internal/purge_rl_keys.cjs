/* 清理限流器的「自伤残留」：FEEDBACK KV 里的 rl:<ip> 键（一次性维护脚本，可复用）
 *
 * ── 背景（2026-09-28 实测）───────────────────────────────────────────
 * 生产 RL 绑定被部署抹掉后，rateOk 静默回落到 KV 兜底，该兜底**每次请求都写**
 * 一个 `rl:<ip>` 键 ⇒ FEEDBACK namespace 630 键里 426 键是它（68%）。
 * KV 免费额度仅 1000 写/天，这些残留既占空间也说明配额一直被自己吃掉。
 * v0.29.4 已把兜底改为纯内存（不再写 KV），所以**存量可以安全清除**。
 *
 * ── 🔴 安全设计：先自证「新代码已生效」再删 ────────────────────────────
 * 「删掉存量」有一个危险前提：如果线上还是旧代码，删完立刻会被重新写回来，
 * 于是你会以为「清了但还是涨」而去找错方向。所以脚本**强制**先做一次活性探针：
 *   ① 记录当前 rl: 键数 N0
 *   ② 真打 10 次线上 API（无害的 GET /api/profile）
 *   ③ 再记 N1 → 必须 N1 === N0（说明当前代码**不再写** rl:）
 *   ④ 只有 ③ 通过才允许删除；否则直接退出并提示「先确认部署已生效」
 *
 * 用法：
 *   node _internal/purge_rl_keys.cjs                 # 只读：探针 + 报告，不删（默认）
 *   node _internal/purge_rl_keys.cjs --write         # 探针通过后真删
 *   node _internal/purge_rl_keys.cjs --probe-only    # 只做活性探针，连报告都省
 */
const fs = require('fs');
const path = require('path');

const ACC = 'd24caa86ff464fd98e1c95a11c814a61';
const FB_ID = '3e8bfa1dd43c49e1a9b77c336ded54df';
const BASE = 'https://sinoky.pages.dev';
const WRITE = process.argv.indexOf('--write') > -1;
const PROBE_ONLY = process.argv.indexOf('--probe-only') > -1;

const SEC = 'C:/Users/Admin/.sinoky-secrets';
const TOKEN = fs.readFileSync(path.join(SEC, 'CLOUDFLARE_API_TOKEN.txt'), 'utf8').trim();
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

async function cf(method, p, body) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + p, {
    method: method, headers: H, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let j = null; try { j = await r.json(); } catch (e) { j = { success: false, errors: [{ message: 'non-json' }] }; }
  return { status: r.status, j: j };
}

async function listKeys(prefix) {
  let cursor = '', out = [];
  for (let i = 0; i < 30; i++) {
    const u = '/accounts/' + ACC + '/storage/kv/namespaces/' + FB_ID + '/keys?limit=1000'
      + (prefix ? '&prefix=' + encodeURIComponent(prefix) : '')
      + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const r = await cf('GET', u);
    if (!r.j.success) throw new Error('list 失败：' + JSON.stringify(r.j.errors));
    const arr = r.j.result || [];
    out = out.concat(arr.map((k) => k.name));
    cursor = (r.j.result_info && r.j.result_info.cursor) || '';
    if (!cursor || arr.length < 1000) break;
  }
  return out;
}

(async () => {
  console.log('rl: 键清理 · FEEDBACK KV');
  console.log('─'.repeat(58));

  const N0keys = await listKeys('rl:');
  console.log('  当前 rl: 键数 = ' + N0keys.length);

  /* ---- 活性探针：证明「当前线上代码不再写 rl:」---- */
  console.log('\n  [活性探针] 真打 10 次线上 API（GET /api/profile，无副作用写入）…');
  let probeFail = 0;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(BASE + '/api/profile?uid=rlpurge-' + Date.now() + '-' + i, { method: 'GET' });
      if (r.status >= 500) probeFail++;
      await r.text();
    } catch (e) { probeFail++; }
  }
  const N1keys = await listKeys('rl:');
  console.log('  探针后 rl: 键数 = ' + N1keys.length + '（请求失败 ' + probeFail + ' 次）');

  const grew = N1keys.length - N0keys.length;
  if (grew > 0) {
    console.log('\n  ❌ 探针期间 rl: 键**增长了 ' + grew + ' 个** ⇒ 线上仍在写（新代码未生效或未部署）。');
    console.log('     绝不能在此状态下清理 —— 删完会被立刻写回来，只会误导后续判断。');
    console.log('     先确认：① wrangler pages deploy 成功 ② CF API 里 production 有 RL DO 绑定');
    process.exit(1);
  }
  console.log('  ✅ 探针期间零增长 ⇒ 线上已不再写 rl: 键（新代码已生效）');

  if (PROBE_ONLY) { console.log('\n(--probe-only：到此为止)'); return; }

  console.log('\n  待清理 ' + N1keys.length + ' 个键，示例：' + N1keys.slice(0, 3).join(', '));

  if (!WRITE) {
    console.log('\n  (默认只读模式) 确认无误后加 --write 真删。');
    return;
  }

  /* ---- 批量删除：CF bulk 接口一次最多 10000 键，这里分批 500 ---- */
  let deleted = 0;
  for (let i = 0; i < N1keys.length; i += 500) {
    const chunk = N1keys.slice(i, i + 500);
    const r = await cf('DELETE', '/accounts/' + ACC + '/storage/kv/namespaces/' + FB_ID + '/bulk', chunk);
    if (!r.j.success) {
      console.log('  ❌ 第 ' + (i / 500 + 1) + ' 批删除失败：' + JSON.stringify(r.j.errors));
      break;
    }
    deleted += chunk.length;
    console.log('  已删 ' + deleted + '/' + N1keys.length);
  }

  const left = await listKeys('rl:');
  console.log('\n  删除完成：已删 ' + deleted + ' · 残留 rl: 键 = ' + left.length);
  const all = await listKeys('');
  console.log('  FEEDBACK 总键数 = ' + all.length + '（清理前 630，其中 rl: 426）');
  /* 清理后再做一次探针级确认：不应被写回 */
  await fetch(BASE + '/api/profile?uid=rlpurge-final-' + Date.now());
  const after = await listKeys('rl:');
  console.log('  清理后又打 1 次 API → rl: 键 = ' + after.length +
    (after.length === 0 ? '  ✅ 未被写回' : '  ⚠️ 被写回，需复查'));
})().catch((e) => { console.error('异常：' + (e && e.stack || e)); process.exit(1); });
