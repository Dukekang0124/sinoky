# v0.23.18 验收报告 · 大模型渗透收口（场景3/4/5/6 + L4）

> 日期：2026-09-22 ｜ 提交：`b1d0bf6`（本地，未 push）｜ 真源：`Sinoky/sinoky-app/`

## 一、落地的交付

| 场景 | 模式 | 前端钩点（包装，不改旧体） | 后端系统提示 | 成本纪律 |
|---|---|---|---|---|
| 3 情境对话自由接话 | `scene` | `sendScore` → `sceneReply` | `SCENE_SYSTEM` | ≤8/天软上限（`S.sceneReplyCap`） |
| 4 每日一句 AI 生成 | `daily` | `nonoDailyLine` → `dailyGenLine` + 首屏校正 | `DAILY_SYSTEM` | ≤1/天缓存（`S.dailyGen`） |
| 5 字卡 AI 自适应 | `card` | `fcStar` → `cardAiAnchor` | `CARD_SYSTEM` | 每字一次（`S.cardTips`） |
| 6 声调 AI 自适应 | `tone` | `nonoToneTip` → `toneAiExplain` | `TONE_SYSTEM` | 每次判错，追加不覆盖 |
| L4 后端聚合 | — | 新增 `GET /api/agg` + `aggregateAiEffect` | — | 游标分页读 `p:` 镜像，零写 |

- **版本号三处同步**：`index.html APP_VERSION`、`version.json version`、`sw.js CACHE` → `0.23.18`（APK 沿用 0.23.13）。
- **字典**：新增 1 个 key `Nono saved a memory trick for {hz} ✦` ×6 语言（681→682）。
- **修复 i18n 闸门盲区**：`index.html` L6203 `T("...Listening\u2026...")` 的 JS 转义 `\u2026` 不被 `scripts/check-i18n.mjs` 朴素正则解码，导致全 6 字典报"缺 key"、content-gates 失败 → 改为真实字符 `…`。
- **修复 Worker 致命 bug**：v0.23.17 块残留裸 token `_END` 会致 worker 模块加载 `ReferenceError`、所有端点崩溃 → 已移除并加四系统提示。

## 二、自动化闸门（本地，全绿）

- **语法闸门** `_internal/verify_syntax.mjs`：4 内联块 + `sw.js` + `_worker.js`(module) + 4 个 JSON，全部 OK。
- **i18n 闸门** `scripts/check-i18n.mjs`：198 条 T() 字面量全命中，6 字典对齐（682 key），无空值。

## 三、运行时验收（Playwright 真 Chrome，mock /api/chat 按 mode 分派）

| 项 | 结果 |
|---|---|
| 4 包装器就位（sendScore/nonoDailyLine/fcStar/nonoToneTip 体内含对应函数名） | ✅ 全部 true |
| 场景3 `scene` 触发 + `S.sceneReplyCap` 写入 | ✅ sceneCalls=1, cap.n=1 |
| 场景4 `daily` 触发 + `S.dailyGen` 写入（解析 `中文 \| English`） | ✅ dailyCalls=1, hz="今天天气真好" |
| 场景5 `card` 触发 + `S.cardTips[字]` 写入 | ✅ cardCalls=1, tip 已存 |
| 场景6 `tone` 触发 + `#nono-msg` 追加解释 | ✅ toneCalls=1, appended=true |
| `allModes` | `["daily","card","tone","scene"]` |
| 页面错误 | ✅ 0 |

## 四、⚠️ 部署状态（阻塞，与代码无关）

- **CI 自 `a52759f`（9-22）起两个 workflow 均在 "Set up job" 阶段失败**（CF 凭证/action 问题，非代码）。上次成功部署 `f41c2e7`（9-16）。
- **线上 worker 实测忽略 `mode`**：POST `/api/chat` 带 `mode:'scene'` 仍返回通用闲聊回复 → 证明 v0.23.15/16/17/18 后端**从未真正上线**。
- **结论**：代码已完整、已验证、已本地提交（`b1d0bf6`），但**未 push**（push 会触发已坏的 CF 部署，不会生效）。待康哥修复 CF 凭证/secret 后 push → 约 20 分钟边缘传播 → 带 `?cb=` 复取确认 `mode` 生效。

## 五、改动文件（11）

`_worker.js` · `index.html` · `sw.js` · `version.json` · `langs/{zh,es,ru,vi,id,th}.json` · `_internal/llm-audit-2026-09-22/LLM_UPGRADE_PLAN.md`
