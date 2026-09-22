# -*- coding: utf-8 -*-
# v0.23.16 版本 bump（version.json + sw.js CACHE），幂等。
import os, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VJ = os.path.join(ROOT, 'version.json')
SW = os.path.join(ROOT, 'sw.js')
d = json.load(open(VJ, encoding='utf-8'))
if d.get('version') == '0.23.15':
    d['version'] = '0.23.16'
    d['updated'] = '2026-09-22'
    d['note'] = ('v0.23.16：L3 闭环度量（效果可被验证）。新增 S.aiFunnel 漏斗账本——记录诺诺 AI 点评触达次数（hit）、'
                 '离线兜底次数（miss）、被点评后用户回来重练的闭环次数（loop）与闭环率；闭环检测经 nonoGrade 包装覆盖'
                 '跟读/复习/情境对话全部开口场景，不改动旧函数体。漏斗随 buildStat 经由 pushProfile（8s 防抖+脏检查）'
                 '零新增写地上云，Progress 页读时聚合展示「AI 效果自检」卡。仅网页发布，APK 沿用 0.23.13，用户经 SW 更新生效。')
    new_en = ('v0.23.16: L3 closed-loop measurement (effect is now verifiable). New S.aiFunnel ledger records Nono '
              'AI-coaching reach (hit), offline fallback (miss), and the closed-loop count (loop) plus loop rate - how '
              'often a user came back to drill after a tip. Loop detection is woven through a nonoGrade wrapper covering '
              'read-score, review and scenario-dialogue (every speaking moment), without touching the original function '
              'bodies. The funnel ships to the cloud via buildStat inside pushProfile (8s debounce + dirty-check), zero '
              'extra KV writes respecting the 1000/day quota; an "AI effect self-check" card renders on Progress from '
              'local state. Web-only; APK stays 0.23.13, App users get it via SW update.')
    if not d.get('noteEn') or not str(d['noteEn'][0]).startswith('v0.23.16'):
        d['noteEn'].insert(0, new_en)
    json.dump(d, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('VERSION_JSON -> 0.23.16')
else:
    print('VERSION_JSON already', d.get('version'))
src = open(SW, encoding='utf-8').read()
if "var CACHE = 'sinoky-v0.23.15';" in src:
    src = src.replace("var CACHE = 'sinoky-v0.23.15';", "var CACHE = 'sinoky-v0.23.16';", 1)
    open(SW, 'w', encoding='utf-8').write(src)
    print('SW CACHE -> sinoky-v0.23.16')
elif "var CACHE = 'sinoky-v0.23.16';" in src:
    print('SW CACHE already 0.23.16')
else:
    print('SW CACHE WARN not found')
