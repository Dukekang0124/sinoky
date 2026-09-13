# v0.23.3 之前（诺诺形象位升级前）的注入层源快照

> 用途：**回滚 v0.23.3 的诺诺形象位升级**，或对比改动前后。
> 建立时间：2026-09-13 · 对应 commit：`e05db2d`（v0.23.3）

## 里面是什么

| 文件 | 说明 | 是否入库 |
|---|---|---|
| `patch.css` | v0.23.3 之前的 CSS 注入源（6,945 B） | ✅ 入库 |
| `patch.js` | v0.23.3 之前的 JS 注入源（25,879 B） | ✅ 入库 |
| `index.html` | v0.23.3 之前的完整单文件页面（572,668 B） | ❌ 见 `.gitignore`（git 历史可精确恢复） |

已核验：`patch.css` / `patch.js` 与 `git show e05db2d^:…` **逐字节一致**；
`index.html` 与 `git show e05db2d^:index.html` **仅 CRLF 差异**（内容一致）。

## 回滚方式（二选一）

**① 整版回滚（推荐，最省事）**

```bash
git revert e05db2d            # 纯注入层追加，无数据迁移、无兼容负担
```

**② 只把注入层源退回旧版**（保留 v0.23.3 的版本号等其他改动）

```bash
cd <repo>
cp _internal/nono-ip-v1/_before-nono-stage/patch.css _internal/nono-ip-v1/patch.css
cp _internal/nono-ip-v1/_before-nono-stage/patch.js  _internal/nono-ip-v1/patch.js
python _internal/nono-ip-v1/_apply-nono-stage.py      # 重新注入进 index.html
python _internal/nono-ip-v1/verify-nono-ip.py         # 断言注入块与源一致
# 若 index.html 快照不在（未入库），先从 git 取回：
# git show e05db2d^:index.html > _internal/nono-ip-v1/_before-nono-stage/index.html
```

**③ 恢复 index.html（本机须注意行尾）**

```bash
git show e05db2d^:index.html > index.html
python -c "import io;p='index.html';b=io.open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n');io.open(p,'wb').write(b)"
# 期望：572,668 B · CRLF 8039 · 裸 LF 0
```
