# -*- coding: utf-8 -*-
"""v0.23.17 bump：version.json (version/note/noteEn) + sw.js CACHE。幂等。"""
import os, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VJ = os.path.join(ROOT, 'version.json')
SW = os.path.join(ROOT, 'sw.js')
NEW = '0.23.17'

# version.json
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW:
    print('version.json already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-22'
    vj['note'] = ('v0.23.17：复习 AI 弱点出题（大模型渗透场景2落地）。当 S.aiWeak 某维度弱点≥2次，'
      '诺诺用免费大模型（/api/chat drill 模式）生成针对该弱点的简短中文练习句，显示在首页复习卡；'
      '用户点「跟我读」复用诺诺练习闭环（coach 点评+aiWeak+checkAiLoop 自动触发）。'
      '当天最多1次 AI 调用（S.revDrill 缓存），尊重 API 红线。仅网页发布，APK 沿用 0.23.13，用户经 SW 更新生效。')
    en = ('v0.23.17: AI review drill (free LLM permeates scenario 2). When a dimension in S.aiWeak '
      'reaches >=2 misses, Nono uses the free LLM (/api/chat drill mode) to generate a short Chinese '
      'practice sentence targeting that weak spot, shown on the Home review card. Tapping "Read after me" '
      'reuses the Nono practice loop (coach comment + aiWeak + checkAiLoop auto-triggered). '
      'At most 1 AI call per day (S.revDrill cache), respecting the API budget. '
      'Web-only; APK stays 0.23.13, App users get it via SW update.')
    vj['noteEn'] = [en] + (vj.get('noteEn') or [])
    json.dump(vj, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('version.json -> %s' % NEW)

# sw.js CACHE
s = open(SW, encoding='utf-8').read()
if "var CACHE = 'sinoky-v%s'" % NEW in s:
    print('sw.js already %s' % NEW)
else:
    c = s.count("var CACHE = 'sinoky-v0.23.16'")
    if c == 0:
        print('ABORT sw.js CACHE anchor 0..23.16 not found (count=%d)' % c); sys.exit(1)
    s = s.replace("var CACHE = 'sinoky-v0.23.16'", "var CACHE = 'sinoky-v%s'" % NEW, 1)
    open(SW, 'w', encoding='utf-8').write(s)
    print('sw.js CACHE -> sinoky-v%s' % NEW)
print('DONE')
