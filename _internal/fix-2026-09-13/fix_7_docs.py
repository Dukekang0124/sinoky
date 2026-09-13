# -*- coding: utf-8 -*-
"""
fix_7_docs.py —— 审计 §4「文档与代码认知错位」一次性整改（#44）

审计列了 11 处，本轮实施中又发现 5 处 ⇒ 共 16 处。本脚本处理三类：

  T. 术语统一：frontmatter 项目别名「Sinoky 中文学习平台」→「Sinoky 中文学习工具」
     🔴 必须只改带 Sinoky 前缀的那支 —— 正文里的「全球中文学习平台」（讯飞承建）
        是**竞品真名**，改了就是事实错误。判据用完整串，不用正则裸替。
  F. 具体事实更正（说没做其实做了 / 说做了其实没做）
  B. 规划文档加「本文基准版本」抬头（审计 §4.3 建议的新规矩）

⛔ 设计原则（沿用审计自己给的建议）：
   **规划文档不重写正文**，只在抬头写清基准版本 + 当前版本 + 「本文不代表当前状态」，
   并在错误事实处就地打一条带日期的更正批注。原文保留 —— 那是写作时的判断，是证据。

幂等：所有替换都先判 `new in s`，命中即 skip；锚点必须唯一，命中 0 或 >1 直接 assert 中止。
"""
import io
import os
import sys

ROOT = r'D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky'
APP = os.path.join(ROOT, 'sinoky-app')
TODAY = '2026-09-13'
CUR_VER = 'v0.23.8'

changed = []


def read(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def sub_once(s, old, new, label):
    """★ 幂等判据只判 `new in s`。
       踩坑史：曾写成 `new in s and old not in s` —— 当 new 是 old 的超串
       （在原句后追加批注）时，old 仍是 new 的前缀 ⇒ 判据永假 ⇒ 每跑一轮重复插一次。"""
    if new in s:
        print('    [skip] %s' % label)
        return s
    n = s.count(old)
    assert n == 1, '%s：锚点命中 %d 次（应为 1）\n---\n%s\n---' % (label, n, old[:200])
    print('    [ok]   %s' % label)
    return s.replace(old, new, 1)


def patch(relpath, fn, label):
    p = os.path.join(ROOT, relpath)
    if not os.path.exists(p):
        print('  !! 文件不存在：%s' % relpath)
        return
    s0 = read(p)
    s1 = fn(s0)
    if s1 != s0:
        write(p, s1)
        changed.append(relpath)
        print('  ✔ %s  (%d → %d B)' % (relpath, len(s0.encode('utf-8')), len(s1.encode('utf-8'))))
    else:
        print('  = %s  无变化' % relpath)


# ══════════════════════════════════════════════════════════════════════
# T. 术语统一：Sinoky 中文学习平台 → Sinoky 中文学习工具
# ══════════════════════════════════════════════════════════════════════
OLD_TERM = 'Sinoky 中文学习平台'
NEW_TERM = 'Sinoky 中文学习工具'
# 正文专有句（00-总览里那句「面向外国人的中文学习平台」）
OLD_PROSE = '面向外国人的中文学习平台'
NEW_PROSE = '面向外国人的中文学习工具'

# 显式排除：竞品真名，绝不能动
GUARD = '全球中文学习平台'


def task_T():
    print('T     术语统一：Sinoky 中文学习平台 → Sinoky 中文学习工具')
    hits = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in ('.git', '.zcode', 'node_modules', 'sinoky-app-corrupt-git')]
        for fn in filenames:
            if not fn.endswith(('.md', '.html', '.json')):
                continue
            p = os.path.join(dirpath, fn)
            try:
                s = read(p)
            except (UnicodeDecodeError, OSError):
                continue
            if OLD_TERM not in s and OLD_PROSE not in s:
                continue
            # 自检：精确串替换后，「全球中文学习平台」数量必须一字不变
            g0 = s.count(GUARD)
            s2 = s.replace(OLD_TERM, NEW_TERM).replace(OLD_PROSE, NEW_PROSE)
            g1 = s2.count(GUARD)
            assert g0 == g1, '%s：竞品真名「全球中文学习平台」被误改（%d → %d）' % (p, g0, g1)
            if s2 != s:
                write(p, s2)
                changed.append(os.path.relpath(p, ROOT))
                hits.append((os.path.relpath(p, ROOT), s.count(OLD_TERM), s.count(OLD_PROSE)))
    for h, a, b in hits:
        print('    ✔ %-58s 别名×%d 正文×%d' % (h, a, b))
    print('    共 %d 个文件' % len(hits))
    # 终检：全库不应再有带 Sinoky 前缀的「平台」
    left = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in ('.git', '.zcode', 'node_modules', 'sinoky-app-corrupt-git')]
        for fn in filenames:
            if fn.endswith(('.md', '.html', '.json')):
                p = os.path.join(dirpath, fn)
                try:
                    if OLD_TERM in read(p):
                        left.append(p)
                except (UnicodeDecodeError, OSError):
                    pass
    assert not left, '仍有残留：%r' % left


# ══════════════════════════════════════════════════════════════════════
# F1. 07-验收上线.md —— 说「做了」其实没做（32 项全未勾）+ 路径写错
# ══════════════════════════════════════════════════════════════════════
def task_07(s):
    banner = """> 🔴🔴 **本文件是「上线前的规划清单」，不是「执行记录」**（%s 补注）
>
> 它写于 2026-08-30 的**规划态**，下面 4 组共 16 项**保持 `[ ]` 未勾是原样保留，不代表未完成**。
> 项目实际上线并已迭代到 **%s** —— 真实的上线状态请看：
> - `05-开发进程/版本记录.md`（版本流水）
> - `07-验收上线/2026-09-13-v0237-*.md` 等（逐版交付验收）
> - `00-总览与结论/2026-09-13-Sinoky功能与任务缺口审计.md`（当前缺口真相）
>
> **本文件保留的价值**：它记录了「上线门禁应当长什么样」。要做发布前检查，请照 §2 的项逐条
> **重跑一遍并勾选**，而不是把这份文档当成"已过"的证据。

## 1. 部署架构""" % (TODAY, CUR_VER)
    return sub_once(s, '## 1. 部署架构', banner, '07 §2 前加「规划清单非执行记录」banner')


def task_07b(s):
    # §3 表格里的路径错：05-验收上线/版本记录.md → 05-开发进程/版本记录.md
    # ★ 踩坑：第一版写成 sub_once(s, '`05-验收上线/版本记录.md`', '`05-开发进程/版本记录.md`')
    #   —— 但前一步 task_07 刚插入的 banner 里**已经含** `05-开发进程/版本记录.md`，
    #   于是 `if new in s` 直接把这次替换判成"已完成"并 skip ⇒ §3 的错路径原样留着。
    #   **`new in s` 只在 new 串全局唯一时才是安全的幂等判据。**
    #   这里改用带上下文的长锚点（含前后表格分隔符），使 old/new 都唯一。
    old = '| 版本记录 | `05-验收上线/版本记录.md`（Obsidian 侧），每版一行：版本号/日期/改动/验收人 |'
    new = ('| 版本记录 | `05-开发进程/版本记录.md`（Obsidian 侧），每版一行：版本号/日期/改动/验收人 |'
           '\n| 笔记 | 🔴 更正（%s）：本行原写 `05-验收上线/版本记录.md`，**路径错了** —— 实际在 `05-开发进程/`。'
           '且该文件当时只记到 v0.3.35，现已随每版更新。 |' % TODAY)
    return sub_once(s, old, new, '07 §3 版本记录路径')


# ══════════════════════════════════════════════════════════════════════
# F2. 交付 SOP —— §九 18城「待图」实为已出图；§十 全未勾实为已过
# ══════════════════════════════════════════════════════════════════════
def task_sop(s):
    s = sub_once(s,
                 '# Sinoky 交付 SOP 与防流失手册（v0.3.51）',
                 """# Sinoky 交付 SOP 与防流失手册（v0.3.51）

> ⚠️ **本文基准版本**：v0.3.51（2026-09-04 写作时）｜**当前版本**：%s（%s）
> 本文是**流程文档**，不是状态文档。§九/§十 的状态列与勾选**停留在写作当天**。
> 查当前实际状态 → `00-总览与结论/2026-09-13-Sinoky功能与任务缺口审计.md`""" % (CUR_VER, TODAY),
                 'SOP 抬头加基准版本')

    s = sub_once(s,
                 '| 18 城内容出图 | ⏸ 待图 | 豆包出图 brief 已就绪，图齐改 `CITY_IMG_ON=true`（+144KB） |',
                 """| 18 城内容出图 | ✅ **已上线** | 🔴 **更正（%s 实测）**：本文原标「⏸ 待图」，实际 `var CITY_IMG_ON = true`（`index.html` L3032）、`assets/cities/` **54 个文件**已入库并启用 —— 图早已到齐，开关早开了。 |""" % TODAY,
                 'SOP §九 18城状态更正')

    s = sub_once(s,
                 '## 十、交付检查清单（发布前过一遍）',
                 """## 十、交付检查清单（发布前过一遍）

> 🔴 **更正（%s）**：下面 7 项**保持 `[ ]` 是原样保留**，实际均已做过或被后续流程替代
> （版本三处已升为**六处**：`version.json` 顶层 + `apk` 段 / `index.html APP_VERSION` /
> `sw.js CACHE` / `download.html` 兜底直链 ×2）。
> **发布前请照单重跑并勾选**，不要把这份文档当成"已过"的证据。详见
> `07-验收上线/2026-09-13-*.md` 逐版交付验收。""" % TODAY,
                 'SOP §十 加更正批注')
    return s


# ══════════════════════════════════════════════════════════════════════
# F3. 诺诺 IP 产品内应用方案 —— 素材「未实施」实为已完成；icon 超标实为已修
# ══════════════════════════════════════════════════════════════════════
def task_nono(s):
    s = sub_once(s,
                 '| `icons/` | `icon-512.png` | PNG 512² | **151.5 KB** | ❌ **超标**（PNG 未压缩，应转 WebP/优化） |',
                 """| `icons/` | `icon-512.webp` | WebP 512² | **4,028 B** | ✅ **已达标**（🔴 更正 %s：本文原标 `icon-512.png` 151.5 KB❌超标，实际早已转 WebP，降幅 97.3%%，是当前的权威图标源） |""" % TODAY,
                 '诺诺方案 §1.3 icon-512 更正')

    s = sub_once(s,
                 '| `mascot/` | 4 姿态 | WebP 512² | 66.4 KB | ✅ §0 要求 ≤20KB/张 |',
                 """| `mascot/` | **8 姿态** | WebP 512² | **164 KB** | ✅ 全部 ≤20KB/张（🔴 更正 %s：本文原记 4 姿，实际 `assets/mascot/` 已 8 张到位 —— cheer/like/listen/note/point/sorry/think/wave，正好是 §2 建议的 8 姿，且已绑句使用） |""" % TODAY,
                 '诺诺方案 §1.3 mascot 8 姿更正')

    s = sub_once(s,
                 '现有 4 姿态不够用（`v-scene` 主练习页就没有合适姿态）。建议扩到 **8 姿**，**每姿必须绑一句中文**：',
                 """现有 4 姿态不够用（`v-scene` 主练习页就没有合适姿态）。建议扩到 **8 姿**，**每姿必须绑一句中文**：

> ✅ **已实施（%s 实测）**：下文这 8 姿**全部到位**（`assets/mascot/*.webp`，8 张 / 164 KB），
> 首启引导 5 张也已换成诺诺。下面保留写作时的规划原文。""" % TODAY,
                 '诺诺方案 §2 8 姿「已实施」批注')

    s = sub_once(s,
                 '| D2 | 姿态由 4 扩到 8 | 建议扩（+80KB），`listen` / `point` 两个最急 |',
                 '| D2 | 姿态由 4 扩到 8 | ✅ **已扩**（%s 实测 8 张 / 164 KB，`listen`/`point` 均在） |' % TODAY,
                 '诺诺方案 D2 决策行')
    return s


# ══════════════════════════════════════════════════════════════════════
# B. 规划文档抬头：基准版本 + 当前版本 + 「本文不代表当前状态」
# ══════════════════════════════════════════════════════════════════════
BASE_BLOCK = """
> ⚠️ **本文基准版本**：{base}｜**当前版本**：{cur}（{today}）｜**滞后**：{lag}
> 本文是**规划文档** —— 正文记录写作当天的判断，**不代表当前状态**。
> 按项目约定（见 `00-总览与结论/00-文档写作与版本约定.md`）：发版时**只回头补「已落地」标记，不重写正文**。
> 要查当前实际状态 → `00-总览与结论/2026-09-13-Sinoky功能与任务缺口审计.md`
"""

# (相对路径, 抬头锚点（该行之后插入）, 基准版本, 滞后描述)
PLANS = [
    ('产品规划/01-Sinoky产品升级总纲.md',
     '**配套文档**：《Sinoky 视觉与素材交付规格》（素材清单、豆包话术、验收标准）',
     'v0.3.59', '20 个小版本'),
    ('产品规划/2026-09-04-世界级体验优化方案.md',
     '> 当前版本：v0.3.49（14 天 Daily 四阶段、edify 闭环、Ear check 听辨已落地）',
     'v0.3.49', '20+ 个小版本'),
    ('产品规划/2026-09-05-改进路线-能力短板与选型对比.md',
     '> 版本基准：v0.3.54 | 初版编写：2026-09-05 15:20 | 依据：`2026-09-05-数据规模与用户使用统计.md`',
     'v0.3.54', '20+ 个小版本（但**本文定的「阶段 0 闸门 usersReal」仍是当前有效判据**）'),
    ('产品规划/03-英文输入中文表达教学-需求方案.md',
     '**日期**：2026-09-08 ｜ **版本基准**：v0.3.60 ｜ **触发**：用户洞察 I-018（"I just need to be able to express myself"）',
     'v0.3.60', '20+ 个小版本（P0 已上线，P1+ 待定）'),
    ('产品规划/2026-09-09-信息架构优化与诺诺陪伴设计.md',
     '> 现状盘点基于线上 v0.4.0 代码实查。',
     'v0.4.0', '20+ 个小版本（IA 重构 A1–A11 状态不明，需重盘）'),
    ('06-测试验证/2026-08-31-M2-内测招募计划.md',
     '日期: 2026-08-31',
     'v0.1.x', '23 个小版本（§6 勾选表全空 —— 招募**至今未发出**）'),
]


def task_plans():
    print('B     规划文档抬头：基准版本 + 当前版本')
    for rel, anchor, base, lag in PLANS:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            print('    !! 不存在：%s' % rel)
            continue
        s = read(p)
        marker = '**本文基准版本**'
        if marker in s:
            print('    [skip] %s' % rel)
            continue
        n = s.count(anchor)
        assert n == 1, '%s：抬头锚点命中 %d 次\n%s' % (rel, n, anchor)
        blk = BASE_BLOCK.format(base=base, cur=CUR_VER, today=TODAY, lag=lag)
        s = s.replace(anchor, anchor + '\n' + blk.strip('\n'), 1)
        write(p, s)
        changed.append(rel)
        print('    [ok]   %-52s 基准 %s' % (rel, base))


# ══════════════════════════════════════════════════════════════════════
# 新规矩文档
# ══════════════════════════════════════════════════════════════════════
CONV_DOC = u"""---
标题: 文档写作与版本约定
项目: "[[00-Sinoky总览与结论|Sinoky 中文学习工具]]"
阶段: 00-总览与结论
日期: 2026-09-13
标签: [Sinoky, 约定, 文档规范, 版本管理]
---

# 00-文档写作与版本约定

> **立此文档的原因**：2026-09-13 的缺口审计发现，**文档与代码的认知错位就有 16 处**。
> 它们比「功能缺失」更危险 —— 会**双向出事**：
> **说没做但做了 → 重复劳动**；**说做了但没做 → 假绿**（该做的没做，还以为做完了）。
> 16 处的根因只有一个：**规划文档与代码没有对齐机制**。

---

## 1. 铁律（与 HSK 台账那条同源：改数据同时改台账）

### 1.1 规划文档必写「本文基准版本」

凡**规划 / 方案 / 路线**类文档，抬头必须写三样：

```
> ⚠️ **本文基准版本**：vX.Y.Z（写作日）｜**当前版本**：v0.23.8（当前日）｜**滞后**：N 个小版本
> 本文是**规划文档** —— 正文记录写作当天的判断，**不代表当前状态**。
> 要查当前实际状态 → 缺口审计 / 版本记录
```

### 1.2 发版时**只补「已落地」标记，不重写正文**

写错了的判断**要原地留着**，只在其后追加一条带日期的批注：

```
> 🔴 **更正（2026-09-13 实测）**：本节原文写「XXX」—— **这是错的**。实际 …
```

**为什么保留原文**：写作时的判断是**证据** —— 它能告诉你「当时的认知盲区在哪」。
删掉原文 = 销毁了「为什么会错」的线索，下次还会错。

### 1.3 状态类文档与流程类文档分开

| 类型 | 例子 | 勾选框语义 |
|---|---|---|
| **流程文档** | 交付 SOP、验收上线 | `[ ]` 是**模板**，不是"未完成"。**每次发布前照单重跑并勾选** |
| **状态文档** | 版本记录、缺口审计、交付验收 | `[ ]` 就是**真未做** |

🔴 **最容易出事的写法**：把流程文档的模板勾选框留在那份文档里，几个月后被当成「已过」证据。

### 1.4 计数与版本号必须来自代码，不来自记忆

写进注释 / commit / 文档的**任何数字**（句数、字节数、文件数、版本号），
都必须**当场从代码取**。实测踩过的坑：注释里写「Day1 共 90 句」，真实是 **30 句**
（把注释行和相邻数据一起正则扫了进去）—— 功能没受影响，但注释/commit/文档全错。

### 1.5 术语统一

| 用 | 不用 | 原因 |
|---|---|---|
| **Sinoky 中文学习工具** | ~~Sinoky 中文学习平台~~ | 定位是轻工具，不是平台（frontmatter 项目别名统一） |
| **全球中文学习平台** | —— | 🔴 **竞品真名（讯飞承建），永不替换** |

> 替换时必须用**完整串**（`Sinoky 中文学习平台`），不要用裸正则 —— 否则会连竞品名一起改掉。
> 判据：替换前后 `全球中文学习平台` 的出现次数必须**一字不变**。

---

## 2. 发布时的版本号一共几处？

**六处**（v0.23.2 起，比早期的"三处"多）：

1. `version.json` 顶层 `version` —— **网页版**
2. `version.json` 的 `apk.version` —— **APK 版（独立，允许低于网页版）**
3. `index.html` 的 `APP_VERSION`
4. `sw.js` 的 `CACHE`
5. `download.html` 的兜底 APK 直链 **×2 处**

🔴 出包后**必须回填 main 的 `apk/`**，否则「线上 `version.json` 声明的直链」指向不存在的文件
（返回 `text/html` 兜底 → App 应用内更新**静默失败**，症状延迟到下次 push main 才显形）。

---

## 3. 相关文档

- 当前缺口真相 → [[2026-09-13-Sinoky功能与任务缺口审计]]
- 版本流水 → `05-开发进程/版本记录.md`
- 发版六处版本与五条硬坑 → `sinoky-app/_internal/NOTES-RELEASE-DEPLOY.md`
- 索引 → `NOTES-INDEX.md`
"""


def task_convention():
    print('C     新规矩文档')
    p = os.path.join(ROOT, '00-总览与结论', '00-文档写作与版本约定.md')
    if os.path.exists(p):
        print('    [skip] 已存在')
        return
    write(p, CONV_DOC)
    changed.append('00-总览与结论/00-文档写作与版本约定.md')
    print('    [ok]   00-总览与结论/00-文档写作与版本约定.md')


def main():
    print('ROOT = %s' % ROOT)
    patch('07-验收上线/07-验收上线.md', task_07, '07 banner')
    patch('07-验收上线/07-验收上线.md', task_07b, '07 path')
    patch('产品规划/2026-09-04-交付SOP与防流失手册.md', task_sop, 'SOP')
    patch('05-产品视觉素材/2026-09-12-诺诺IP产品内应用方案.md', task_nono, '诺诺方案')
    task_plans()
    task_convention()
    task_T()
    print('\n本轮改动 %d 个文件' % len(changed))
    for c in changed:
        print('  - %s' % c)


if __name__ == '__main__':
    main()
