# 诺诺 × GLM-4-Flash 协同互动模式与上线配置规划

> 配套文档：参照《诺诺自由对话-技术调研与设计方案.md》（已定档：主用 GLM-4-Flash 永久免费 + 兜底 Workers AI Qwen，零新密钥面）。
> 本文在其基础上深化为**可执行的协同与上线方案**：角色分工、路由切换、状态流转、上线配置、限流降级、质量监控、验证要点。
> 红线（Edify Gate 最高优先级）：**「说」是主路径**——默认语音输入/输出，文本仅作无障碍兜底。任何偏离都让诺诺退化成「中文阅读器」，直接背离核心目标。

---

## 一、架构说明（分层与模块边界）

整体三层层、六模块，所有 `/api/*` 自动过 `guardApi`（Origin 校验 + 每 IP 60s/40 次限流）。

```
┌──────────────────────────────────────────────────────────────────────┐
│ 端上 · 诺诺层（index.html，已有 + 少量新增）                          │
│  ├─ 浮标 #nono-fab / 面板 #nono-panel（已有）                          │
│  ├─ 姿态机 nonoState (idle/listening/thinking/speaking/cheer/sorry)    │
│  ├─ 录音 nonoRecord → blobToWav(16k)（已有，复用）                    │
│  ├─ 识别 asrText → /api/asr（已有，复用）                            │
│  ├─ 朗读 speak → /api/tts（已有，复用，三源兜底）                    │
│  ├─ 【新增】模式 NONO.mode = 'practice' | 'chat'                      │
│  ├─ 【新增】#nono-chat 气泡区 + 按住说话钮 + 文本兜底输入框          │
│  └─ 【新增】nonoChatSend() / S.nonoChat 历史落盘                       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTPS (API_BASE)
┌───────────────────────────┴──────────────────────────────────────────┐
│ 网络层 · Cloudflare Pages Worker（_worker.js，少量新增）              │
│  ├─ guardApi：Origin + 每 IP 60s/40 次（全局，继承）                  │
│  ├─ 【新增】/api/chat 专属限流（叠加，建议 20/60s/UID）              │
│  └─ 路由：/api/asr /api/tts /api/score /api/feedback /api/profile …  │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────────────┐
│ 模型层（诺诺的「大脑」，仅 /api/chat 触达）                          │
│  ├─ 主用：GLM-4-Flash（智谱，GLM_KEY，永久免费·30并发·128K）         │
│  └─ 兜底：Workers AI @cf/qwen/qwen2.5-7b（env.AI，零密钥·10k neurons/day）│
└──────────────────────────────────────────────────────────────────────┘
```

**模块边界铁律**：
- 诺诺层**永不**直接拼 prompt、永不直连模型——所有语言生成必须经 `/api/chat`。
- 模型层**永不**触达麦克风/扬声器/UI——只收 messages、回 reply 文本。
- Worker 是唯一的「翻译官」：把端上音频链路（ASR/TTS）与模型链路（chat）解耦。

---

## 二、角色分工与协作边界

| 角色 | 负责 | 不负责（边界） |
|---|---|---|
| **诺诺（端上）** | 主持对话、听（ASR）、说（TTS）、表情姿态、开场白、持续引导用户开口、记录历史落盘、降级时念兜底文案 | 不生成语言内容；不决定「回什么」；不调模型 |
| **GLM-4-Flash（主脑）** | 理解用户中文、生成口语化简体中文回复、抛开放问题引导开口、按 persona 控场 | 不直接触达音频/UI；不持有会话状态（状态在端上） |
| **Workers AI Qwen（备脑）** | GLM 失败时的中文兜底生成 | 质量弱于 GLM，仅保底不保优 |
| **Worker /api/chat（翻译官）** | 拼 system prompt、路由双模型、超时/降级、限流、返回 reply | 不做 ASR/TTS（那是别的端点） |

**协作边界的两条硬线**：
1. **内容权归 GLM**：诺诺的每一句「说的话」内容都由 `/api/chat` 返回，诺诺只负责把文字念出来 + 摆姿态。这样 persona/口音/难度全在模型侧统一调，前端零逻辑。
2. **状态权归端上**：`S.nonoChat` 在 localStorage，刷新/重开续聊；模型侧**无状态**（每次请求带 `system + 最近 N 轮`），天然水平扩展、不占 KV 写配额。

---

## 三、用户请求在两者间的路由与切换逻辑

### 3.1 入口与模式路由（触发层）
```
用户点 #nono-fab
  └─ 浮标弹两个入口：🎙️跟读练习 / 💬自由聊天
       ├─ 跟读练习 → NONO.mode='practice' → 走既有 nonoRecord→nonoGrade（不动）
       └─ 自由聊天 → NONO.mode='chat'    → 进聊天态（本文新增）
```
`NONO.mode` 是当前代码**缺失字段**，本方案明确为新增（默认 `'practice'`，保持旧行为不变）。

### 3.2 单轮内路由（一次说话的完整链路）
```
用户按住说话 → nonoState('listening')
  → 松开 → nonoRecord 停止 → blobToWav(16k)
  → asrText() → /api/asr → 汉字文本   [ASR 失败→nonoState('sorry')+重说提示]
  → 渲染用户气泡
  → 【可选】/api/score 轻评（声调提示，加分项）
  → nonoChatSend() → /api/chat（带 S.nonoChat 历史）
       ├─ GLM-4-Flash 成功 → reply
       ├─ GLM 超时/429/报错 → Workers AI Qwen
       └─ 二者皆败 → 降级文案「诺诺有点累了，待会再聊」
  → 渲染诺诺气泡 → nonoState('speaking') → speak(reply，句级切分首句先播)
  → 回到 listening，等待用户下一次按住   ← 循环
```

### 3.3 切换逻辑
| 切换场景 | 触发 | 行为 |
|---|---|---|
| 练习 ↔ 聊天 | 用户在面板点模式 | 设 `NONO.mode`，共用录音/姿态/TTS，互不干扰 |
| 语音 ↔ 文本 | 用户点「键盘」图标 | 默认语音；文本输入框折叠展开，发送走同一 `nonoChatSend` |
| 主脑 ↔ 备脑 | GLM 超时/429/异常 | 自动降级 Workers AI，用户无感（仅 latency 略升） |
| 正常 ↔ 降级文案 | 双模型皆败 | 诺诺念温柔文案，姿态 `sorry`，不阻塞练功 |
| 正常 ↔ 出错 | ASR 失败 / 网络断 | `sorry` 姿态 + 「再大声一点试试？」+ 重试钮 |
| 开 ↔ 关 | 用户关面板 / 离开 | `S.nonoChat` 落盘，诺诺回 `idle` |

---

## 四、交互状态流转（状态机）

诺诺姿态机现有枚举 `idle / listening / thinking / speaking / cheer / sorry`，全部复用，无新增姿态。

```
        [打开面板·选自由聊天]
                 │
                 ▼
   ┌─────────── idle ───────────┐
   │  NONO.mode='chat'           │
   │  诺诺开场白 TTS（speaking） │
   └───────────┬────────────────┘
               │ 用户按住 mic
               ▼
   ┌─────── listening ───────┐   用户松开
   │ pose=think              │──────────┐
   │ "Nono is listening…"    │          │
   └─────────────────────────┘          ▼
                              ┌──── thinking ────┐
                              │ pose=think       │  ASR 中 + 等 /api/chat
                              │ 等识别+生成       │
                              └────────┬─────────┘
                                       │ /api/chat 返回 reply
                                       ▼
   ┌─────── speaking ────────┐   句级 TTS 首句先播
   │ pose=like               │──────────┐
   │ "Nono is speaking…"     │          │ 播完
   └─────────────────────────┘          ▼
                              ┌── 回 listening（循环续聊）──┐
                              │  等待用户下一次按住          │
                              └────────────────────────────┘

   [异常分支]
   thinking 中 ASR 失败 ──► sorry（"没听清，再试试？" + 重试钮）──► listening
   thinking 中 双模型皆败 ─► sorry（"诺诺累了，待会再聊 😴"）────► idle
   用户关闭面板 ───────────► S.nonoChat 落盘 ────────────────► idle
```

**状态语义约定**：`thinking` 一态两用（ASR 转写中 + 等 LLM），前端可在 `thinking` 内细分文案（「在听…」→「在想…」），但姿态图不变，避免新增资源。

---

## 五、上线配置方案（环境配置 + 参数调优）

### 5.1 环境变量与绑定（Cloudflare Pages 项目 Settings）
| 项 | 值 | 说明 |
|---|---|---|
| `GLM_KEY` | 智谱 API Key（Production + Preview 都配） | **新增**，不进仓库（参照 `FEEDBACK_TOKEN`） |
| `env.AI` | 已绑（type=ai, name=AI） | 兜底 Workers AI 用，确认未掉绑定 |
| `FEEDBACK_TOKEN` | 已有 | 看板/反馈读端点鉴权，复用 |
| KV `FEEDBACK` | 已绑 | 监控埋点写这里（见第七节） |
| KV `PROFILES` | 已绑 | 进度云同步，写配额紧（1000/天），**聊天埋点不占它** |

> base_url 铁律：`https://open.bigmodel.cn/api/paas/v4/` **必须带尾斜杠**，否则 404。

### 5.2 /api/chat 参数调优（建议初值，上线后据监控微调）
| 参数 | 初值 | 理由 |
|---|---|---|
| `temperature` | 0.8 | 口语对话要自然、不机械 |
| `top_p` | 0.9 | 控多样性 |
| `max_tokens` | 200 | 限 1~3 句，防模型啰嗦（违背 persona） |
| 超时 | 8000ms（AbortController） | 超时就降级兜底，不卡死用户 |
| 历史轮数 N | 12 | 控 token + 延迟；超长裁剪旧轮 |
| 句级 TTS | 按 。！？ 切分，首句先播 | 降体感延迟 |

### 5.3 限流参数（两层叠加）
- **全局**（已有 `guardApi`）：每 IP 60s/40 次，所有 `/api/*` 共享，不动。
- **聊天专属**（新增）：每 UID/IP 60s/20 次，在 `/api/chat` 分支内复用 `rateOk` 带更小 `max`（独立计数 key 前缀 `chat:`），防聊天高频刷 GLM/Workers AI 额度。

---

## 六、限流降级与容错机制（三层降级 + 边界）

```
请求进入 /api/chat
  │
  ├─[限流] guardApi(全局40) 或 专属(20) 超 → 429 + retry_after  ▶ 前端提示「慢一点～」
  │
  ├─[模型 L1] GLM-4-Flash（GLM_KEY）
  │     └─ 超时/429/非200 → catch
  │           ├─[模型 L2] Workers AI @cf/qwen/qwen2.5-7b（env.AI）
  │           │     └─ neurons 超限/异常 → catch
  │           │           └─[模型 L3] 返回降级 JSON {reply:"诺诺有点累了，待会再聊😴", degraded:true}
  │
  └─ 返回 reply → 前端 speak()
        └─[TTS 兜底] 已有三源（Google→melotts→有道）→ 全败则只显文字气泡不报错
```

**容错边界**：
- ASR 失败：诺诺 `sorry` + 「再大声一点？」+ 重试钮，不进 chat。
- 网络闪断：前端发请求前 `navigator.onLine` 探活 + 一次重试，再败走降级文案。
- 降级文案**绝不阻塞练功**：用户仍可继续按住说话，下一轮自动重试主脑。
- 隐私：聊天埋点只记元数据（uid/ts/model/ms/degraded/cn_ratio），**不记对话全文**；匿名 UID。

---

## 七、交互质量保障与监控指标

### 7.1 监控落地（复用 /api/feedback，零新 KV 绑定）
`/api/chat` 成功响应时异步 `POST /api/feedback` 一条 `{ type:'chat', uid, model, ms, degraded, chars, cn_ratio }`，康哥从 `/api/feedback?token=` 看板读聚合。

### 7.2 指标清单（上线后盯这 8 个）
| 维度 | 指标 | 目标 / 预警 |
|---|---|---|
| **延迟** | ASR 耗时 / LLM 首响 TTFB / TTS 耗时 / 端到端 | 端到端 P95 < 4s；超则优化句级 TTS |
| **质量** | 回复中文占比 `cn_ratio` | > 95%；掉则 tightening system prompt |
| **容量** | GLM 超时/429 率、Workers AI neurons/天 | 429 率 < 2%；neurons 不触顶 |
| **降级** | `degraded` 占比 | < 5%；高则查 GLM_KEY / 主用健康 |
| **互动（Edify Gate 核心）** | 每会话开口轮次、日均 chat 会话数、续聊率 | 开口轮次是北极星，比对「无诺诺聊天」基线 |
| **稳定** | KV 写次数/天（FEEDBACK） | 不触 free-tier daily write limit |
| **满意度** | 可选 👍👎「诺诺聊得怎么样」 | 轻量，不入强制流程 |
| **合规** | 非中文/敏感回复抽检 | 0 容忍，system prompt + 后处理双锁 |

### 7.3 质量保障手段
- system prompt 锁死「简体中文/口语/短句/不跑题/不纠正语法除非被问」。
- 后处理过滤：非中文占比过高 → 触发重生成一次，仍高则降级文案。
- 句长硬截断 `max_tokens=200` + 尾句必须是开放问句（persona 强制）。

---

## 八、上线配置清单（checklist）

**后端（_worker.js）**
- [ ] 在 Pages Settings 新增 `GLM_KEY`（Production + Preview）
- [ ] 确认 `env.AI` 绑定未掉（兜底）
- [ ] 新增 `/api/chat` 分支（在 `/api/score` 后、`env.ASSETS` 前），自动继承 `guardApi`
- [ ] `/api/chat` 内叠加专属限流（20/60s/UID，独立 key）
- [ ] GLM 调用：base_url 带尾斜杠、timeout 8s、temp 0.8、top_p 0.9、max_tokens 200
- [ ] 双模型降级链 + 降级 JSON
- [ ] 聊天空埋点 `POST /api/feedback {type:'chat',…}`

**前端（index.html）**
- [ ] `NONO.mode` 字段（默认 `'practice'`）
- [ ] 浮标双入口：跟读练习 / 自由聊天
- [ ] `#nono-chat` 气泡区 + 按住说话钮 + 文本兜底输入框
- [ ] `nonoChatSend()`：ASR→/api/chat→渲染→句级 TTS
- [ ] `S.nonoChat` 历史落盘（最近 12 轮，刷新续聊）
- [ ] persona system prompt 落地（简体中文口语短句 + 每轮开放问句）
- [ ] 降级/出错态 UI（`sorry` 姿态 + 重试钮）

**发版**
- [ ] 四处版本同步（APP_VERSION / sw CACHE / version.json / download.html）
- [ ] 真机自测（第九节）→ push main → tag → 回填 APK

---

## 九、验证要点

**单元 / 接口（curl + node --check）**
- [ ] `_worker.js` 语法 OK；`/api/chat` 返回 `{reply:'<中文>'}`（mock 验证）
- [ ] GLM 主用返回中文口语；注入错误 key → 自动降级 Workers AI
- [ ] Workers AI 也失败 → 返回降级 JSON `degraded:true`
- [ ] 专属限流：同 UID 21 次/分钟第 21 次返回 429

**真浏览器（Playwright Chrome + 本地 server + mock /api/chat）**
- [ ] 点诺诺 → 选「自由聊天」→ 诺诺开场白 TTS 朗读
- [ ] 按住说话 → listening → thinking → 用户气泡（ASR mock 汉字）→ 诺诺气泡（mock 中文）→ speaking TTS
- [ ] 再按住 → 续聊（历史带入，S.nonoChat 增长）
- [ ] 关面板重开 → S.nonoChat 续接（不丢上下文）
- [ ] ASR mock 失败 → sorry + 重试钮
- [ ] /api/chat mock 降级 → 念「诺诺累了」

**真机（你手动）**
- [ ] 手机/海外链路：端到端延迟体感（重点盯海外用户，GLM 国内服务器多一跳）
- [ ] 中文口语自然度、TTS 三源兜底生效
- [ ] 连续 10 轮不卡死、不爆额度

**A/B（Edify Gate 验收）**
- [ ] 对比「有诺诺聊天」vs「无」的每会话开口轮次，确认聊天真的拉动「多说中文」

---

## 十、四查
- ① 沉淀 ✅ 本文档（`_internal/`，git 外）
- ② 固化 — 实施走通后把「Worker 接 GLM-4-Flash/Workers AI 双源兜底 + 专属限流」固成 skill
- ③ 合并 ✅ 全复用现有 ASR/TTS/guardApi/姿态机/NONO，仅新增 `mode`/聊天入口/`/api/chat`
- ④ 最后一环 — 本文为**规划方案，未实施**；待康哥拍板 MVP（语音主路径 + GLM 主用 + Workers AI 兜底）或含声调联动完整版
