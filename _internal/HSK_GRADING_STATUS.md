# Sinoky 字卡 HSK 分级 · 状态台账

> 更新：2026-09-12（v0.21.2 发版核对）
> **位置说明**：本文件原名 `data/HSK_GRADING_PENDING.md`。`data/` 是整目录打包进 `www/` 的，会随 APK 与线上站点公开，因此迁到 `_internal/`（`.assetsignore` 已排除，不进包、不上线）。

## 现状（实测，2026-09-12）

| 文件 | 作用 | 字数 | 状态 |
| --- | --- | --- | --- |
| `data/flashcards.hsk1.json` | HSK1 字卡 | 193 | ✅ ready |
| `data/flashcards.hsk2.json` | HSK2 字卡 | 125 | ✅ ready |
| `data/flashcards.hsk3.json` | HSK3 字卡 | 267 | ✅ ready |
| `data/flashcards-levels.json` | 等级总清单（前端据此渲染 tab + 待补充态） | — | 🔁 生成时自动刷新 |
| `data/build-flashcards.mjs` | 构建器 / 一键导入器（`--level 1|2|3 --csv`） | — | ✅ |
| `data/strokes/` | 笔顺数据文件 | 583 | ✅ v0.21.2 补齐 |

> ⚠️ **历史偏差（已纠正）**：本台账在 v0.21.2 之前一直写着「HSK2 / HSK3 占位 0 字、等教材」，实际 v0.21.0（2026-09-11）已上线 125 / 267 字。台账没跟代码同步，导致接手盘点时误判为「未开工」。
> **规矩**：改字卡数据的同时改这份台账，别只改一个。

## 已上线

- [x] HSK1 字卡 193 字（人工策展 + `pinyin-pro` 注音）
- [x] HSK2 字卡 125 字，`ready: true`
- [x] HSK3 字卡 267 字，`ready: true`
- [x] 前端 `initLevels()/selectLevel()/loadCards(level)/showLevelPending()` 按 `ready` 字段渲染等级切换与「待补充」占位；进度按等级存于 `S.cards[level].idx`（legacy 平铺 `{idx}` 自动迁移到 `{1:{idx}}`）
- [x] 笔顺：583 个唯一汉字全覆盖（v0.21.2 修 HanziWriter 不接受 CSS 变量 + 从 CDN 补 390 个字文件，离线可用）

## 待办（未完成项）

- [ ] 抽查 HSK2 / HSK3 各 10~20 张：拼音、声调、声母、韵母是否正确，例句是否通顺（需人工）
- [ ] 真机验收：切 tab 翻卡正常、进度互相独立、徽章 / 生词本联动无串
- [ ] 若扩 HSK4+：按下方流程走

## 字段约定（与 HSK1 一致，便于消费方复用）

`id, hanzi, pinyin, tone, initial, final, pos, bushou, meaning, hsk, freq, words, sentence, strokeData, alt?`

- `tone`：1~4 为四声，0 为轻声
- `strokeData`：恒为 `"hanzi-writer"`（笔顺不入库，按 hanzi 现场取）
- `words`：常见词组数组；`sentence`：`{zh, pinyin, en}`
- `alt`：多音字其余读音（可选）

## 一键补入流程（扩级时用）

1. 教材整理成 CSV，表头 `hanzi,meaning,pos,bushou,pinyin`（`pinyin` 缺省时由 `pinyin-pro` 自动注音）
2. `node data/build-flashcards.mjs --level N --csv data/hskN.csv`
3. 脚本自动刷新 `data/flashcards-levels.json`（该级 → `ready: true`）
4. 前端无需改代码，刷新即生效；走标准发版 SOP（版本号同步 + 部署）
5. 同步更新本台账的「现状」表
