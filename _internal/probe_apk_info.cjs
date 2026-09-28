#!/usr/bin/env node
/*
 * probe_apk_info.cjs — 从 APK 内**直接读出**真实元信息（不依赖 aapt / apkanalyzer）
 *
 * 用途（两条，都是硬需求）：
 *   ① 官网/下载页要写「系统要求」就必须知道真实 minSdkVersion —— 不能猜。
 *   ② 作为发版验收的一部分：核对 APK **内部** versionCode/versionName 是否与
 *      version.json 声明一致。此前验收只比「文件 md5 + size + PK 魔数」，
 *      这三项都证明不了「包内声明的版本号对不对」。
 *
 * 实现：解 ZIP → 取 AndroidManifest.xml（二进制 AXML）→ 解析字符串池 +
 *       按「属性项 = ns|name|raw|size|res0|type|data」的 20 字节定长结构定位
 *       framework 属性（AXML 全小端）。
 *       不引第三方依赖，纯 Node。
 *
 * 用法：
 *   node _internal/probe_apk_info.cjs [apk 路径]        # 默认 www/apk 下最新包
 *   node _internal/probe_apk_info.cjs --json            # 只输出 JSON（供其它脚本消费）
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* ───────────────────────── ZIP：取出 AndroidManifest.xml ───────────────────────── */

function readZipEntry(buf, wantName) {
  // EOCD：从尾部回扫 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效 ZIP：找不到 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('损坏的中央目录条目 @' + p);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (name === wantName) {
      // 本地头：跳过它自己的 name/extra 长度
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error('不支持的压缩方式 ' + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('APK 内找不到 ' + wantName);
}

/* ───────────────────────── AXML：字符串池 ───────────────────────── */

function parseStringPool(axml, off) {
  const type = axml.readUInt16LE(off);
  if (type !== 0x0001) throw new Error('该偏移不是字符串池 chunk（type=' + type + '）');
  const headerSize = axml.readUInt16LE(off + 2);
  const stringCount = axml.readUInt32LE(off + 8);
  const flags = axml.readUInt32LE(off + 16);
  const stringsStart = axml.readUInt32LE(off + 20);
  const isUtf8 = (flags & 0x100) !== 0;
  const offsetsBase = off + headerSize;
  const dataBase = off + stringsStart;

  const strings = [];
  for (let i = 0; i < stringCount; i++) {
    const so = dataBase + axml.readUInt32LE(offsetsBase + i * 4);
    try {
      if (isUtf8) {
        let q = so;
        let len = axml[q++];
        if (len & 0x80) { len = ((len & 0x7f) << 8) | axml[q++]; }
        let blen = axml[q++];
        if (blen & 0x80) { blen = ((blen & 0x7f) << 8) | axml[q++]; }
        strings.push(axml.toString('utf8', q, q + blen));
      } else {
        let q = so;
        let len = axml.readUInt16LE(q); q += 2;
        if (len & 0x8000) { len = ((len & 0x7fff) << 16) | axml.readUInt16LE(q); q += 2; }
        strings.push(axml.toString('utf16le', q, q + len * 2));
      }
    } catch (e) { strings.push(''); }
  }
  return { strings, isUtf8, size: axml.readUInt32LE(off + 4) };
}

/* ───────────────────────── AXML：按 chunk 正经遍历 ─────────────────────────
   ⚠️ 两个踩过的坑（写死在这里防回归）：
     ① chunk type 常量：0x0100 = START_NAMESPACE，**0x0102 才是 START_ELEMENT**，
        0x0103 = END_ELEMENT。按「0x0100 是元素」解会把命名空间声明当成 manifest 元素。
     ② StartElement 布局：node 头 headerSize=16（type/headerSize/size + lineNumber/comment），
        attrExt 紧接其后 ⇒ ns@+16、name@+20、attributeStart@+24、attributeSize@+26、
        attributeCount@+28；属性数组基址 = off + 16 + attributeStart（**不是 +20**）。
     属性项定长 20 字节：ns(4) name(4) rawValue(4) size(2) res0(1) type(1) data(4)，全小端。
     type: 0x10 = INT_DEC，0x03 = STRING（data 为字符串池下标）。                     */

const RES = {
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  minSdkVersion: 0x0101020c,
  targetSdkVersion: 0x01010270,
  compileSdkVersion: 0x01010572,
};

/* 遍历所有 StartElement，返回 [{tag, attrs:[{name,resId,raw,type,data}]}] */
function walkElements(axml, sp, resMap) {
  const out = [];
  let off = 8 + sp.size;         // 跳过 AXML 头(8) 与字符串池
  while (off + 8 <= axml.length) {
    const type = axml.readUInt16LE(off);
    const size = axml.readUInt32LE(off + 4);
    if (size <= 0) break;
    if (type === 0x0102) {       // START_ELEMENT
      const nameIdx = axml.readUInt32LE(off + 20);
      const attrStart = axml.readUInt16LE(off + 24);
      const attrSize = axml.readUInt16LE(off + 26) || 20;
      const attrCount = axml.readUInt16LE(off + 28);
      const base = off + 16 + attrStart;
      const attrs = [];
      for (let a = 0; a < attrCount; a++) {
        const e = base + a * attrSize;
        if (e + 20 > axml.length) break;
        const nameI = axml.readUInt32LE(e + 4);
        attrs.push({
          name: nameI !== 0xffffffff ? sp.strings[nameI] : null,
          nameIdx: nameI,
          // 框架属性在字符串池里也有名字；同时保留资源 ID（经 resource map）以便兜底
          resId: nameI !== 0xffffffff && nameI < resMap.length ? resMap[nameI] : null,
          raw: axml.readUInt32LE(e + 8),
          type: axml.readUInt8(e + 15),
          data: axml.readUInt32LE(e + 16),
        });
      }
      out.push({ tag: sp.strings[nameIdx] || null, attrs });
    }
    off += size;
  }
  return out;
}

function readResMap(axml, sp) {
  let off = 8 + sp.size;
  while (off + 8 <= axml.length) {
    const type = axml.readUInt16LE(off);
    const size = axml.readUInt32LE(off + 4);
    if (size <= 0) break;
    if (type === 0x0180) {
      const n = (size - 8) / 4;
      const map = [];
      for (let i = 0; i < n; i++) map.push(axml.readUInt32LE(off + 8 + i * 4));
      return map;
    }
    off += size;
  }
  return [];
}

/* 主流程 */

function probe(apkPath) {
  const buf = fs.readFileSync(apkPath);
  const axml = readZipEntry(buf, 'AndroidManifest.xml');
  const sp = parseStringPool(axml, 8); // AXML 头 8 字节后即字符串池
  const resMap = readResMap(axml, sp);
  const els = walkElements(axml, sp, resMap);

  const findEl = (t) => els.find((e) => e.tag === t);
  const attrByRes = (el, resId) => {
    if (!el) return null;
    const a = el.attrs.find((x) => x.resId === resId) || el.attrs.find((x) => {
      // 兜底：按属性名匹配
      const n = Object.keys(RES).find((k) => RES[k] === resId);
      return n && x.name === n;
    });
    return a || null;
  };
  const asString = (a) => (a && a.type === 0x03 && sp.strings[a.data] != null ? sp.strings[a.data]
    : a && a.raw !== 0xffffffff && sp.strings[a.raw] != null ? sp.strings[a.raw] : null);
  const asInt = (a) => (a ? a.data : null);

  const man = findEl('manifest');
  const sdk = findEl('uses-sdk');

  const vc = asInt(attrByRes(man, RES.versionCode));
  const versionName = asString(attrByRes(man, RES.versionName));
  const pkgAttr = man && man.attrs.find((x) => x.name === 'package');
  const minSdk = asInt(attrByRes(sdk, RES.minSdkVersion));
  const tgtSdk = asInt(attrByRes(sdk, RES.targetSdkVersion));
  const compSdk = asInt(attrByRes(man, RES.compileSdkVersion)) || asInt(attrByRes(sdk, RES.compileSdkVersion));

  // package：优先取 manifest 的 package 属性；再用 capacitor.config.json 的 appId 交叉核对
  const pkg = pkgAttr ? asString(pkgAttr) || sp.strings[pkgAttr.data] : null;
  let appId = null;
  try { appId = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8')).appId; } catch (e) {}
  const pkgInPool = appId ? sp.strings.includes(appId) : null;

  return {
    file: path.basename(apkPath),
    bytes: buf.length,
    md5: require('crypto').createHash('md5').update(buf).digest('hex'),
    package: pkg,
    versionCode: vc,
    versionName,
    minSdkVersion: minSdk,
    targetSdkVersion: tgtSdk,
    compileSdkVersion: compSdk,
    androidMin: minSdk != null ? `Android ${androidName(minSdk)} (API ${minSdk})` : null,
    appIdFromConfig: appId,
    appIdInManifest: pkgInPool,
    elementCount: els.length,
    elementTags: els.map((e) => e.tag).filter(Boolean),
    stringPoolSize: sp.strings.length,
    utf8Pool: sp.isUtf8,
  };
}

function androidName(api) {
  const map = { 21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' };
  return map[api] || ('API ' + api);
}

/* ───────────────────────── CLI ───────────────────────── */

if (require.main === module) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  let apk = args.find((a) => !a.startsWith('--'));
  if (!apk) {
    const dir = path.join(ROOT, 'www', 'apk');
    if (!fs.existsSync(dir)) {
      console.error('找不到 www/apk/，请显式传入 APK 路径');
      process.exit(2);
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.apk')).sort();
    if (!files.length) { console.error('www/apk/ 下没有 .apk'); process.exit(2); }
    apk = path.join(dir, files[files.length - 1]);
  }
  let info;
  try {
    info = probe(apk);
  } catch (e) {
    console.error('解析失败：', e.message);
    process.exit(1);
  }
  if (asJson) { console.log(JSON.stringify(info, null, 2)); process.exit(0); }

  console.log('APK 内部元信息（直接解二进制 AndroidManifest.xml，非 aapt）');
  console.log('─'.repeat(58));
  console.log('文件      :', info.file);
  console.log('体积      :', info.bytes, 'B  =', (info.bytes / 1048576).toFixed(2), 'MB');
  console.log('md5       :', info.md5);
  console.log('versionCode:', info.versionCode);
  console.log('versionName:', info.versionName);
  console.log('minSdk    :', info.minSdkVersion, info.androidMin ? '→ ' + info.androidMin : '');
  console.log('targetSdk :', info.targetSdkVersion);
  console.log('compileSdk:', info.compileSdkVersion);
  console.log('appId     :', info.appIdFromConfig, '| 清单字符串池内出现?', info.appIdInManifest);
  console.log('字符串池  :', info.stringPoolSize, '条（UTF-8 =', info.utf8Pool, '）');

  /* 与线上 version.json 交叉核对 —— 这才是这条探针的真正价值 */
  const vj = path.join(ROOT, 'version.json');
  if (fs.existsSync(vj)) {
    const j = JSON.parse(fs.readFileSync(vj, 'utf8'));
    const a = j.apk || {};
    console.log('\n与 version.json 交叉核对：');
    const chk = [
      ['versionCode', info.versionCode, a.versionCode],
      ['version', info.versionName, a.version],
      ['size', info.bytes, a.size],
      ['md5', info.md5, a.md5],
    ];
    let bad = 0;
    chk.forEach(([k, got, want]) => {
      const ok = want == null ? null : String(got) === String(want);
      if (ok === false) bad++;
      console.log(' ', ok === null ? '·' : ok ? '✅' : '❌', k.padEnd(12), 'APK =', got, '| version.json =', want);
    });
    console.log(bad ? `\n❌ ${bad} 项不一致` : '\n✅ 包内声明与 version.json 完全一致');
  }
}

module.exports = { probe, readZipEntry, parseStringPool };
