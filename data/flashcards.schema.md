# Sinoky 字卡库 Schema（F 需求 · 数据地基）

> 本文件定义 `flashcards.hsk1.json` 的数据结构。它是 G（沉浸阅读器）、E（形音义调联动记忆卡）、B（最小对立对发音）、C（声调记忆辅助）四个功能的**公共数据底座**。
> 由 `build-flashcards.mjs` 生成：语义字段人工策展，拼音/声调/声母/韵母由 `pinyin-pro` 本地计算（零手写错误）。

---

## 一、文件结构

```jsonc
{
  "meta": {
    "name": "Sinoky 分级字卡库 · HSK1 核心",
    "version": "0.1.0",
    "source": "人工策展语义 + pinyin-pro 生成拼音/声调/声母/韵母",
    "count": 193,                 // 字卡总数
    "hsk": 1,                     // 当前分级
    "strokeDataNote": "笔顺不入库；前端用 hanzi-writer 按 hanzi 现场拉 CDN",
    "generatedAt": "2026-09-01T...",
    "fields": [ /* 字段清单，见下 */ ],
    "consumers": ["G 沉浸阅读器", "E 形音义调联动记忆卡", "B 最小对立对发音", "C 声调记忆辅助"]
  },
  "cards": [ /* 字卡数组 */ ]
}
```

## 二、单张字卡字段

| 字段 | 类型 | 说明 | 生成方式 | 消费方 |
|---|---|---|---|---|
| `id` | string | `hsk1-001` 稳定主键 | 脚本生成（序号） | 全部 |
| `hanzi` | string | 汉字本体 | 策展 | 全部 |
| `pinyin` | string | 主读音（声调标调，如 `nǐ`） | pinyin-pro | G/E/C |
| `tone` | int | 主读音声调 `1-4`，`0`=轻声 | pinyin-pro | C/E/B |
| `initial` | string\|null | 声母（`zh/ch/sh` 等；零声母为 `null`） | pinyin-pro | B（对立对） |
| `final` | string | 韵母（`i/ang/üe` 等） | pinyin-pro | B（对立对） |
| `pos` | string | 词性缩写（pron./n./v./adj./adv./conj./cls.…） | 策展 | E/G |
| `bushou` | string | 部首 | 策展 | E（形） |
| `meaning` | string | 英译 | 策展 | G/E |
| `hsk` | int | HSK 等级（当前全为 `1`） | 策展 | 检索 |
| `freq` | int | 本库内相对常用度（近似，越小越常用） | 脚本（序号） | 检索/排序 |
| `words` | string[] | 常见词/词组（如 `["你好","你们"]`） | 策展 | G/E/A（连词） |
| `sentence` | object\|undefined | 例句：`{ zh, pinyin, en }` | 策展+拼注 | E/G |
| `strokeData` | string | 固定值 `hanzi-writer`，渲染时按 `hanzi` 拉 CDN | 固定 | E/G（笔顺） |
| `alt` | string[]\|undefined | 多音字其余读音（如 `["háng","hàng","héng"]`） | pinyin-pro | 高级提示 |

### 笔顺（strokes）为什么不入库
笔顺笔画数据体量大（每字含 SVG 路径）。前端用 [hanzi-writer](https://hanziwriter.org/) 按 `hanzi` 从 CDN 实时拉取：
```
https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/{hanzi}.json
```
F 库只存元数据，保持轻量、可机检；离线场景可后续把常用字笔顺预打包进 PWA 缓存（MVP-3 工作项）。

---

## 三、消费方式（给 G/E/B/C 的接入口径）

```js
import data from './flashcards.hsk1.json';
const byHanzi = Object.fromEntries(data.cards.map(c => [c.hanzi, c]));

// G 阅读器：点字查卡
const card = byHanzi['你'];        // → { pinyin:'nǐ', tone:3, meaning:'you', ... }

// C 声调：按 tone 分组
const byTone = {1:[],2:[],3:[],4:[]};
data.cards.forEach(c => byTone[c.tone]?.push(c));

// B 对立对：取声母做 z/zh 等对比（initial 字段直接可用）
const zGroup = data.cards.filter(c => c.initial === 'z');
const zhGroup = data.cards.filter(c => c.initial === 'zh');

// E 记忆卡：四要素联动
//  形 = strokeData(hanzi-writer) | 音 = pinyin+tone | 义 = meaning+sentence | 调 = tone
```

---

## 四、如何扩展到 HSK2 / HSK3

编辑 `build-flashcards.mjs` 的 `RAW` 数组，追加 `[汉字, 英译, 词性, 部首, [词组], [例句zh, 例句en]?]`，改 `meta.hsk` 与文件名，重跑：

```bash
NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" \
C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe build-flashcards.mjs
```

拼音/声调/声母/韵母自动重算，无需手写。建议 HSK2 同法生成 `flashcards.hsk2.json`，由前端按 `hsk` 字段检索合并。
