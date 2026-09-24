# retired-assets-2026-09-24 —— 从 `assets/` 移出的零引用文件

## 为什么会有这个目录

`scripts/build-web.mjs:13` 的 `DIRS` 含 `assets`，`:50-52` 对整目录 `cp`，**没有逐文件排除机制**
（`.assetsignore` 只对 Pages 直传生效，对 CI 的 `wrangler pages deploy www` 不生效）。

后果：**任何塞进 `assets/` 的文件都会自动公开上线**。2026-09-24 体检线上实测确认：

| 线上路径 | 实测 | 性质 |
|---|---|---|
| `/assets/read/{breakfast,commute,doctor,friends,market,travel}_2x.webp` | 200 HTTP，字节数与本地吻合 | 6 个废弃 2x 备图，全仓零引用，白占 ~914 KB |
| `/assets/scenes/meeting.md` | 200 HTTP，2362 B | **内部内容脚本**：含内部规范库路径 `[[../../../10-内容规范库/…]]`、内部角色名、"AI 初稿未校准"标注 → 内部信息外泄 |

> 判据注记：必须**比字节数**才能区分「真文件」与「SPA 兜底」。
> 本项目的兜底会把任意不存在路径渲染成 `index.html`（200 + 757942 B）。
> 上表两条返回的是真实字节数，故为真实文件。

## 本次移出的 19 个文件（约 1.35 MB）

移出判据：**产品树静态/动态引用均在 0 命中**，且不属于「代码注释明确说明的预留资产」。
核对工具：`_internal/tools/audit_assets_refs.cjs`（可重复跑）。

| 分组 | 文件 | 判据 |
|---|---|---|
| `read/` ×6 | `{breakfast,commute,doctor,friends,market,travel}_2x.webp` | 代码只引无 `_2x` 后缀版（`index.html:1421-1431`）；违红线「2x 备用件不进产品树」 |
| `scenes/` ×1 | `meeting.md` | 内部内容脚本，非产品资源（**红线：内部信息外泄**） |
| `icons/` ×6 | `{cards,home,progress,read,sentences,tones}.png` | v0.24.0 已换同名 `.svg`（代码全用 `.svg`，`sw.js` 只缓存 `.svg`）→ 旧 PNG 残留 |
| `banner/` ×2 | `horizontal.webp`、`vertical.webp` | 代码只引 `banner/square.webp`（`index.html:3530`） |
| `share/` ×3 | `light-square.webp`、`dark-vertical.webp`、`light-vertical.webp` | 代码只引 `share/dark-square.webp`（`index.html:6991`）；`SHARE.FMT` 仅 `'square'`/`'story'`，与 `-vertical` 命名不对应 |
| `brand/` ×1 | `dragon-nono.svg` | 设计阶段未采用的品牌形象；`brand/` 只引 `nono-{hero,share,splash}.webp` |

## 刻意**保留**在 `assets/` 的疑似零引用文件（勿误判为遗漏）

| 文件 | 保留理由 |
|---|---|
| `assets/tones/tone{1,2,3,4}.mp3` | `index.html:6089` 注释明确：「新组可以用 assets/tones/*.mp3 文件（v0.22.0 就在那了，只是没人引用）」→ **有意预留**，非废弃 |
| `assets/cities/thumb_*.webp`（18 个） | **动态拼接**：`index.html:3468,3486` `'assets/cities/thumb_' + sc.id + '.webp'` |
| `assets/scenes/thumbs/intro_1x1_1024.webp` | **动态拼接**：`index.html:5529` `SCENE_THUMB[sc.id]==='intro' ? '1024' : '512'`，而 `SCENE_THUMB`(L1411-1417) 含 `'self-intro':'intro'` |
| `assets/icons/home.svg` | 零引用但体积极小（3 KB），且是 `assets/icons/` 下唯一未被引用的 v0.23.x 图标；未纳入本次清理以控制变更面 |
| `assets/badges/map_master_*.webp` | **不是母版**：`map_master` 是勋章 ID（`index.html:3514`），`':3525'` 动态拼 `assets/badges/' + d.id + '_256.webp'` |

## 回滚方式

全部文件用 `git mv` 移出，历史保留。需要恢复任意一个：

```bash
git mv _internal/retired-assets-2026-09-24/<分组>/<文件名> assets/<分组>/<文件名>
```

## 防复发（红线）

1. **`assets/` 下新增文件必须被 `index.html` / `sw.js` / 产品代码引用**，否则先移出。
2. 提交前跑 `node _internal/tools/audit_assets_refs.cjs`，确认 ZERO 列表为空或已人工判定。
3. 若真要建立"不上线的非产品文件区"，应放在 `_internal/`（已在 `build-web.mjs` 的 `EXCLUDE` 中）。
