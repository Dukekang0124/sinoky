# Sinoky · Cloudflare Pages 部署操作指南（M0）

> 目标：**1 天内让真实用户可访问的 Sinoky v0.1.1**
> 架构：GitHub Pages（前端静态）+ Cloudflare Pages（生产环境）

---

## 0. 当前进度

| 环节 | 状态 | 文件 |
|---|---|---|
| 前端代码（v0.1.1） | ✅ 已完成 | `index.html` |
| 版本文件 | ✅ 已完成 | `version.json` |
| PWA 配置 | ✅ 已完成 | `manifest.webmanifest` / `sw.js` |
| 缓存策略配置 | ✅ 已完成 | `_headers` |
| Cloudflare Pages 配置 | ⏳ 待你操作 | — |
| GitHub 仓库推送 | ⏳ 待你操作 | — |

---

## 1. 前置准备（约 10 分钟）

### 1.1 你需要准备

- ✅ **Cloudflare 账号**：免费计划即可
- ✅ **GitHub 账号**：Dukekang0124（已授权）

### 1.2 已有资源确认

- ✅ GitHub 仓库：`https://github.com/Dukekang0124/sinoky.git`
- ✅ v0.1.1 代码已推送到 main 分支

---

## 2. Step 1：创建 Cloudflare Pages 项目（5 分钟）

### 2.1 打开 Cloudflare Dashboard

访问：`https://dash.cloudflare.com/`

### 2.2 创建 Pages 项目

1. 进入：**Workers & Pages** → **Create application** → **Pages**
2. 点击 **Connect to Git**
3. 选择：**GitHub**
4. 授权：Dukekang0124 账号
5. 选择仓库：`Dukekang0124/sinoky`

### 2.3 配置构建设置

**Build settings**：
- **Build command**: `(留空)` - 不需要构建，纯静态文件
- **Build output directory**: `.` - 根目录

**Environment**：
- **Production**: Enabled

### 2.4 部署

- 点击 **Save and Deploy**
- 等待 1-2 分钟

### 2.5 获取生产 URL

部署成功后，Cloudflare 会分配一个 URL：`https://sinoky.pages.dev`

**记下这个 URL**，后续所有回归验收和分享都基于此 URL。

---

## 3. Step 2：验证缓存策略（5 分钟）

### 3.1 检查 `_headers` 文件

确保 `sinoky-app/_headers` 文件存在且内容正确：

```text
/*
  Cache-Control: public, max-age=300, must-revalidate
  X-Content-Type-Options: nosniff

# SW / 版本文件需即时生效，避免更新滞后
/sw.js
  Cache-Control: no-cache

/version.json
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: public, max-age=3600
```

### 3.2 验证生效

访问 `https://sinoky.pages.dev/_headers`，应该能看到缓存策略配置。

---

## 4. Step 3：线上回归验收（10 分钟）

### 4.1 主流程一遍

1. 访问 `https://sinoky.pages.dev`
2. 首页 → Arrival 场景 4 句（遮挡→揭晓→▶ 发音→慢速→3×自检→完成→streak toast）
3. Tone Gym 答对/答错各一次
4. 进度页日历

### 4.2 重点回归 v0.1.1 修复项

| 检查项 | 验证方法 | 预期结果 |
|--------|----------|----------|
| **TTS 三源降级** | Network 面板检查 `translate.google.com` 请求 | 返回 200 audio，连续点 4 句都能出声 |
| **SW 缓存** | Application → Service Workers → Cache Storage | 只有同源资源，**无** `translate.google.com` / `tts.baidu.com` 缓存 |
| **按钮 nowrap** | 390px 视口下 "I said it 3×" 按钮宽度 | 单行显示，不换行 |
| **UID 键** | Application → localStorage | 恰好两键：`sinoky_uid` 和 `sinoky_state` |
| **版本号** | 页脚显示 | `v0.1.1` |
| **慢速档** | 🐢 slow 点击后发音 | 明显变慢（Google TTS 走 ttsspeed 参数） |

### 4.3 慢速档验证

1. 在 Arrival 场景点击 🐢 slow
2. 点击任意句子的"播放"按钮
3. 对比正常速度和慢速速度
4. **预期**：慢速档发音明显变慢（约 0.5x 速度）

---

## 5. 验证清单（M0 上线标准）

访问 `https://sinoky.pages.dev`，逐项检查：

- [ ] **域名可访问**：浏览器打开显示绿色锁头 + 页面正常渲染
- [ ] **PWA 安装**：浏览器提示"安装 Sinoky"，可以安装到桌面
- [ ] **主流程全通**：首页 → Arrival 4 句 → Tone Gym → 进度页
- [ ] **TTS 正常**：点击"播放"按钮能听到中文朗读（Google 中文优先）
- [ ] **慢速档生效**：🐢 slow 点击后发音明显变慢
- [ ] **3×自检按钮**：390px 下单行显示，不换行
- [ ] **版本号显示**：页脚显示 `v0.1.1`
- [ ] **SW 缓存正确**：无跨域 TTS 音频缓存
- [ ] **localStorage 正确**：恰好两键 `sinoky_uid` 和 `sinoky_state`

---

## 6. 故障排查

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| 域名打不开 | Cloudflare Pages 部署未完成 | 等待 1-2 分钟；刷新页面 |
| TTS 无声音 | Google 中文 TTS 失败，降级到 WebSpeech | 检查 Network 面板，看是否有 `translate.google.com` 请求 |
| SW 缓存污染 | 跨域 TTS 音频被缓存 | 清除浏览器缓存，重新加载 |
| 按钮换行 | 390px 视口下按钮未设置 nowrap | 检查 `index.html` 第 103 行 `white-space:nowrap` |
| 版本号不显示 | version.json 未正确引用 | 检查 `index.html` 第 86 行 `version.json?v=0.1.1` |

---

## 7. 后续版本部署流程（v0.1.2+）

### 7.1 更新版本号

编辑 `version.json`：
```json
{
  "version": "0.1.2",
  "updated": "2026-08-31"
}
```

### 7.2 提交并推送

```bash
cd /d/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app
git add version.json index.html
git commit -m "feat: Sinoky v0.1.2 更新"
git push origin main
```

### 7.3 Cloudflare Pages 自动部署

- 推送到 GitHub 后，Cloudflare Pages 会自动触发部署（1-2 分钟）
- 部署完成后访问 `https://sinoky.pages.dev` 验证

---

## 8. 成本与限制

- **成本**：Cloudflare Pages 免费计划（无限带宽，100k 请求/天）
- **CDN**：Cloudflare 全球 CDN
- **SSL/TLS**：自动签发 Let's Encrypt 证书

---

## 9. 与英语开口练对比

| 维度 | 英语开口练 | Sinoky v0.1.1 |
|------|------------|---------------|
| **部署方式** | 手动部署到 Cloudflare Pages | 手动部署到 Cloudflare Pages |
| **缓存策略** | `_headers` 文件控制 | `_headers` 文件控制 |
| **版本管理** | version.json + 手动更新 | version.json + 手动更新 |
| **TTS 降级** | Google → WebSpeech | Google → Baidu → WebSpeech |
| **SW 缓存** | 同源缓存 | 跨域不缓存 |
| **无后端** | 是 | 是 |

---

**预计总耗时**：10-15 分钟

**总成本**：Cloudflare Pages 免费（无限带宽，100k 请求/天）

**下一步**：
1. 按 Step 1-3 完成部署
2. 部署完成后告诉我 URL
3. 我进行线上回归验收
4. M0 出口达成 → 启动 M1（语音识别评分 + 设备 ID 云备份 + 种子用户内测）
