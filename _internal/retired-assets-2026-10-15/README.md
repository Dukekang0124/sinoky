# retired-assets-2026-10-15 —— 从产品树移出的零引用文件（第二批）

## 为什么会有这个目录

沿用 2026-09-24 建立的机制（见 `_internal/retired-assets-2026-09-24/README.md`）：
`scripts/build-web.mjs` 对 `assets/` 是**整目录 cp**、无逐文件排除 ⇒ **任何塞进 `assets/` 的文件都会自动公开上线**。
故「移出产品树」= 移进本目录（已在 `build-web.mjs` 的 `EXCLUDE` 中），历史保留、可 `git mv` 回滚。

判据：**产品树静态 / 动态引用均在 0 命中**，且**不属于**「代码注释明确说明的预留资产」。
核对工具：`_internal/tools/audit_assets_refs.cjs`（可重复跑）。

## 本次移出 26 个文件（约 775 KB）

| 分组 | 文件 | 判据 |
|---|---|---|
| `badges/` ×15 | `{centurion,explorer,first-speak,first_city,graduate,map_master,perfect,polyglot-path,real-world,reversal-king,streak14,streak3,streak7,survivor,tone-master}_512.webp` | 徽章渲染只拼 `_256.webp`（`index.html` `'assets/badges/'+d.id+'_256.webp'`）；全仓 **0 处** `_512` 引用。违红线「2x 备用件不进产品树」 |
| `scenes/thumbs/` ×2 | `directions_1x1_512.webp`、`phone_1x1_512.webp` | `SCENE_THUMB` 映射值集合 = {hotel,meeting,taxi,restaurant,subway,supermarket,cafe,clinic,airport,intro}，**不含** directions / phone ⇒ 永不渲染 |
| `icons/` ×1 | `home.svg` | 全仓仅引 `nav-home.svg`；`home.svg` 零引用（2026-09-24 曾以「控制变更面」暂留，本次确认仍零引用后移出） |
| `audio/` ×8 | `s01p00_r0`、`s02p05_main`、`s02p05_r0`、`s02p05_r1`、`s02p07_main`、`s02p08_main`、`s02p08_r1`、`s04p01_main`（`.mp3`） | 不在 `SENT_AUDIO`（409 条静态映射）中，音频无动态拼接；其中 7 个的内容与被引用文件**逐字节相同**（纯冗余副本） |

### 工具误报说明（重要）

`audit_assets_refs.cjs` 的「形态」判据按**后缀模式**归类，会把 `_512.webp` / `directions_1x1_512.webp`
误判为 DYN（当作动态引用），从而给出 `ZERO 0` 的**假绿**。本次 15 个 `_512` 徽章与 2 个场景缩略图
正是此类假阴性 —— 需人工按「代码实际能拼出的取值集合」复核，不能只信工具的 ZERO 档。

## 刻意保留（勿误判为遗漏）

| 文件 | 保留理由 |
|---|---|
| `assets/tones/tone{1,2,3,4}.mp3` | 代码注释明确「这样新组可以用 `assets/tones/*.mp3` 文件」→ **有意预留**，非废弃 |
| `assets/cities/<id>_food.webp` 与 `<id>_landmark.webp`（18 组） | **双侧都被引用**：`_food` 走 `phrasePic()` 动态（`sc.pic` 数组含 `'food'`），`_landmark` 走 `phrasePic()` 缺省 + `landing/*.html`。内容虽逐字节相同，但去重需改 `phrasePic` 取值逻辑（属功能改动），本次**不动**，另列内容/美术待办 |
| `voice/kang.wav` | 疑似音色克隆**源采样**，无文本引用但可能用于重新生成 `audio/`；删前需 owner 确认 |
| `apk-icons/` | APK 构建链真实使用（`apk.yml`：`cp -r apk-icons/* android/app/src/main/res/`） |
| `assets/*.svg` 图标 / `vendor/pinyin-pro/**` / `data/strokes/**` | 分别被 `shMask`/CSS、`import()`、`fetch()` 动态消费，非孤儿 |

## 回滚方式

```bash
git mv _internal/retired-assets-2026-10-15/<分组>/<文件名> <原目录>/<文件名>
```
