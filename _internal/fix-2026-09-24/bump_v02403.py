# -*- coding: utf-8 -*-
"""v0.24.3 bump：代码审计 P2 治理（8 项）。

幂等。四类版本号（web 线）：index.html APP_VERSION / sw.js CACHE
/ version.json 顶层 / download.html 直链 ×2。
version.json 的 apk 段（url/versionCode/md5/size）**不动** —— 由 apk.yml 出包时回写。
"""
import os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IH = os.path.join(ROOT, 'index.html')
SW = os.path.join(ROOT, 'sw.js')
VJ = os.path.join(ROOT, 'version.json')
DH = os.path.join(ROOT, 'download.html')
NEW, PREV = '0.24.3', '0.24.2'

NOTE_ZH = ('v0.24.3：代码审计 P2 治理（8 项）。'
  '（1）云同步深合并：pullProfile 由浅 Object.assign 改为递归深合并，修复多设备同步时另一台设备的练习进度'
  '（phrases/weak/dayDone/guideDone/aiWeak）被整对象覆盖静默丢失。'
  '（2）运营统计 feat/scenes 隔离：recordStat 隔离 feat/scenes 引用，修复功能使用分布 featDist 永不上报的缺陷'
  '（计数 max 幂等，写放大有界，配额无忧）。'
  '（3）统计接口分页上限：summarizeStats 改游标分页并设 5000 硬上限，避免规模化后单次全表 KV 读成本/延迟线性上涨。'
  '（4）KV TTL：fb:/chat: 反馈埋点写入加 180 天 expirationTtl，避免存储无限增长。'
  '（5）z-index 令牌化：.reader/.rpop/#nono-panel.np-head/#nono-invite 四处裸数字改走 --z-* 变量，补齐既有栈序约束。'
  '（6）补 .rd-offline/.rd-skel/.plan-txt 三个此前零 CSS 规则的 class，消除浏览器默认退化。'
  '（7）day-finish-date 旧绿 #0a8f6e 改用语义 --ok 成功色。'
  '（8）新增 _internal/tools/check_sw_assets.cjs 校验 SW 预缓存清单资源存在，移动资产不校验的离线失效风险有闸。'
  '网页与 APK 同版本上线。')

NOTE_EN = ('v0.24.3: code-audit P2 governance (8 items). '
  '(1) Cloud-sync deep merge: pullProfile now recursively deep-merges instead of shallow Object.assign, '
  'fixing silent loss of the other device\'s practice progress (phrases/weak/dayDone/guideDone/aiWeak) on multi-device sync. '
  '(2) Stat feat/scenes isolation: recordStat isolates feat/scenes references, fixing featDist never being reported '
  '(counts are max-idempotent so write amplification is bounded — no quota risk). '
  '(3) Stats pagination cap: summarizeStats now cursor-paginates with a 5000 hard cap, avoiding full-table KV reads at scale. '
  '(4) KV TTL: fb:/chat: feedback writes now set 180-day expirationTtl, preventing unbounded storage growth. '
  '(5) z-index tokenization: .reader/.rpop/#nono-panel.np-head/#nono-invite bare numbers now use --z-* vars. '
  '(6) Added CSS for .rd-offline/.rd-skel/.plan-txt (were rule-less, fell back to browser defaults). '
  '(7) day-finish-date old green #0a8f6e replaced with semantic --ok success color. '
  '(8) Added _internal/tools/check_sw_assets.cjs to validate SW precache manifest. '
  'Web and APK ship together at this version.')

# ---------- ① index.html APP_VERSION ----------
h = open(IH, encoding='utf-8').read()
anchor = "var APP_VERSION = '%s'" % NEW
if anchor in h:
    print('index.html APP_VERSION already %s' % NEW)
else:
    old = "var APP_VERSION = '%s'" % PREV
    c = h.count(old)
    if c != 1:
        print('ABORT index.html APP_VERSION anchor %s count=%d' % (PREV, c)); sys.exit(1)
    h = h.replace(old, anchor, 1)
    open(IH, 'w', encoding='utf-8', newline='').write(h)
    print('index.html APP_VERSION -> %s' % NEW)

# ---------- ② sw.js CACHE ----------
s = open(SW, encoding='utf-8').read()
anchor = "var CACHE = 'sinoky-v%s'" % NEW
if anchor in s:
    print('sw.js already %s' % NEW)
else:
    old = "var CACHE = 'sinoky-v%s'" % PREV
    c = s.count(old)
    if c != 1:
        print('ABORT sw.js CACHE anchor %s count=%d' % (PREV, c)); sys.exit(1)
    s = s.replace(old, anchor, 1)
    open(SW, 'w', encoding='utf-8').write(s)
    print('sw.js CACHE -> sinoky-v%s' % NEW)

# ---------- ③ version.json 顶层 ----------
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW and (vj.get('noteEn') or [''])[0].startswith('v%s:' % NEW):
    print('version.json already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-24'
    vj['note'] = NOTE_ZH
    rest = [x for x in (vj.get('noteEn') or []) if not x.startswith('v%s:' % NEW)]
    vj['noteEn'] = [NOTE_EN] + rest
    json.dump(vj, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('version.json -> %s（noteEn %d 条）' % (NEW, len(vj['noteEn'])))

# ---------- ④ download.html 直链 ×2 ----------
d = open(DH, encoding='utf-8').read()
if 'Sinoky-v%s-release.apk' % NEW in d:
    print('download.html already %s' % NEW)
else:
    old = 'Sinoky-v%s-release.apk' % PREV
    c = d.count(old)
    if c == 0:
        print('ABORT download.html anchor %s not found' % PREV); sys.exit(1)
    d = d.replace(old, 'Sinoky-v%s-release.apk' % NEW)
    open(DH, 'w', encoding='utf-8', newline='').write(d)
    print('download.html -> Sinoky-v%s-release.apk（%d 处）' % (NEW, c))

print('DONE')
