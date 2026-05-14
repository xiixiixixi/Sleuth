# agent-browser 命令速查

> 本文是 AI Agent 的 agent-browser 关键命令速查，按场景组织。完整文档请用 `agent-browser skills get core --full` 查看。

**核心原则**：snapshot + @ref 是推荐工作流。先用 `snapshot -i` 获取交互元素列表（带 @ref 编号），再通过 @ref 操作页面。`find role/text/label` 作为 fallback。CSS selector 是最后手段。

**所有命令必须连接用户日常/登录态 Chrome，并带 `--auto-connect --session`**：主 Agent 用 `${SID}-main`，子 Agent 用 `${BROWSER_SESSION}`。不带 `--auto-connect` 会启动独立的 Chrome for Testing，丢失登录态。不带 `--session` 会和用户已有 tab 混在一起。

**禁止降级**：遇到浏览器操作失败时，不能降级到 `curl`、`WebSearch`、`WebFetch` 或其他非浏览器工具绕过登录态页面。必须通过 `check-deps` 修复环境，或换搜索引擎/关键词。

---

## 连接 Chrome（强制）

连接用户日常 Chrome 以复用登录态、Cookie、书签和历史。Chrome 必须在进程启动时带 `--remote-debugging-port=9222`（`chrome://inspect` 复选框方式不兼容）。如果 Chrome 已经在运行，`open -a` 或再次启动时传入的参数会被现有进程忽略；必须先关闭/终止 Chrome，再用正确参数重启。如果连接后不是登录态，不要继续抓取登录态页面，先运行 `check-deps` 或请用户在该 Chrome 中完成登录。

```bash
# 通过 check-deps 自动检测、关闭旧 Chrome、带 CDP 参数重启（推荐）
node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs"

# macOS 手动启动 Chrome（不推荐，check-deps 会自动处理）
# 使用独立目录，不关闭用户正在使用的 Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sleuth/chrome-debug" &

# ✅ 正确：连接用户日常 Chrome
agent-browser --auto-connect --session ${SID}-main open https://example.com

# ❌ 错误：会启动独立的 Chrome for Testing
agent-browser open https://example.com
```

## 障碍处理

| 障碍 | 处理 |
|------|------|
| 登录弹窗 | 先 `eval "document.body.innerText"` 穿透遮罩；拿不到内容再请用户登录 |
| 付费墙 | 提取墙前可见片段，搜索免费转载版本，不尝试绕过 |
| CAPTCHA | 暂停，告知用户，5 分钟无响应换渠道 |
| 限流（429/空响应） | 暂停该域名，换渠道或等 30 秒，重试仍限流则放弃 |
| agent-browser 失败 | 1. `check-deps` 修复 → 2. 重试原命令 → 3. 换搜索引擎/关键词 |
| 页面超时 | 加 timeout；连续失败换方式 |
| snapshot 空但标题正常 | `eval` 检查 `body.innerText.length` |

遇到障碍时记录到 session-logger：
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action log --sid $SID \
  --operation '{"type":"captcha|login_wall|paywall|dead_link|anti_bot","url":"<URL>","domain":"<域名>"}'
```

## 导航

页面跳转和刷新。

```bash
agent-browser --auto-connect --session ${SID}-main open https://example.com
agent-browser --auto-connect --session ${SID}-main back
agent-browser --auto-connect --session ${SID}-main forward
agent-browser --auto-connect --session ${SID}-main reload
```

## 阅读页面

获取页面内容和状态。`snapshot -i` 是最核心命令。

```bash
# 交互元素 + @ref（最常用）
agent-browser --auto-connect --session ${SID}-main snapshot -i

# 紧凑模式（减少 token 消耗）
agent-browser --auto-connect --session ${SID}-main snapshot -i -c

# 包含链接 URL
agent-browser --auto-connect --session ${SID}-main snapshot -i -u

# JSON 输出（程序解析用）
agent-browser --auto-connect --session ${SID}-main snapshot -i --json

# 限定范围（只扫描指定 CSS selector 内）
agent-browser --auto-connect --session ${SID}-main snapshot -s "#main"

# 获取元素信息
agent-browser --auto-connect --session ${SID}-main get text @e1          # 可见文本
agent-browser --auto-connect --session ${SID}-main get html @e1          # innerHTML
agent-browser --auto-connect --session ${SID}-main get attr @e1 href     # 属性值
agent-browser --auto-connect --session ${SID}-main get value @e1         # input 当前值

# 获取页面元信息
agent-browser --auto-connect --session ${SID}-main get title
agent-browser --auto-connect --session ${SID}-main get url
agent-browser --auto-connect --session ${SID}-main get count ".item"     # 元素数量
```

## 交互

通过 @ref 操作页面元素。每次 snapshot 后 @ref 会重新分配，操作前必须重新 snapshot。

```bash
# 点击
agent-browser --auto-connect --session ${SID}-main click @e1
agent-browser --auto-connect --session ${SID}-main click @e1 --new-tab   # 在新 Tab 打开链接

# 双击
agent-browser --auto-connect --session ${SID}-main dblclick @e1

# 悬停
agent-browser --auto-connect --session ${SID}-main hover @e1

# 聚焦
agent-browser --auto-connect --session ${SID}-main focus @e1

# 输入
agent-browser --auto-connect --session ${SID}-main fill @e1 "text"       # 清空后输入
agent-browser --auto-connect --session ${SID}-main type @e1 "text"       # 追加输入

# 按键
agent-browser --auto-connect --session ${SID}-main press Enter
agent-browser --auto-connect --session ${SID}-main press Control+a       # 组合键

# 表单操作
agent-browser --auto-connect --session ${SID}-main check @e1             # 勾选
agent-browser --auto-connect --session ${SID}-main uncheck @e1           # 取消勾选
agent-browser --auto-connect --session ${SID}-main select @e1 "value"    # 下拉选择
agent-browser --auto-connect --session ${SID}-main upload @e1 file.pdf   # 文件上传

# 滚动
agent-browser --auto-connect --session ${SID}-main scroll down 500       # 向下滚动 500px
agent-browser --auto-connect --session ${SID}-main scrollintoview @e1    # 滚动到元素可见

# 拖拽
agent-browser --auto-connect --session ${SID}-main drag @e1 @e2          # 从 @e1 拖到 @e2
```

## 定位器

不用 snapshot 时，通过角色/文本/标签定位元素并操作。适合简单场景或 fallback。

```bash
agent-browser --auto-connect --session ${SID}-main find role button click --name "Submit"
agent-browser --auto-connect --session ${SID}-main find text "Sign In" click
agent-browser --auto-connect --session ${SID}-main find label "Email" fill "user@test.com"
agent-browser --auto-connect --session ${SID}-main find placeholder "Search" type "query"
agent-browser --auto-connect --session ${SID}-main find testid "submit-btn" click
agent-browser --auto-connect --session ${SID}-main find first ".card" click
agent-browser --auto-connect --session ${SID}-main find nth 2 ".card" hover
```

## 等待

等待页面状态变化，避免固定延时。

```bash
# 等元素出现（推荐）
agent-browser --auto-connect --session ${SID}-main wait @e1

# 等文字出现
agent-browser --auto-connect --session ${SID}-main wait --text "Success"

# 等 URL 匹配
agent-browser --auto-connect --session ${SID}-main wait --url "**/dashboard"

# 等网络空闲（SPA 导航后推荐）
agent-browser --auto-connect --session ${SID}-main wait --load networkidle

# 等 DOM 就绪
agent-browser --auto-connect --session ${SID}-main wait --load domcontentloaded

# 等 JS 条件满足
agent-browser --auto-connect --session ${SID}-main wait --fn "window.ready"

# 固定等待（最后手段，仅在上述方法都失效时使用）
agent-browser --auto-connect --session ${SID}-main wait 2000
```

## 截图

```bash
agent-browser --auto-connect --session ${SID}-main screenshot                # 当前视口
agent-browser --auto-connect --session ${SID}-main screenshot page.png       # 指定路径
agent-browser --auto-connect --session ${SID}-main screenshot --full         # 全页
agent-browser --auto-connect --session ${SID}-main screenshot --annotate     # 标注 @ref 编号（给多模态模型用）
```

## 数据提取

从页面提取结构化数据。

```bash
# 简单表达式
agent-browser --auto-connect --session ${SID}-main eval "document.title"

# 复杂提取（推荐用 heredoc）
agent-browser --auto-connect --session ${SID}-main eval --stdin <<'EOF'
const rows = document.querySelectorAll("table tr");
Array.from(rows).map(r => ({
  name: r.cells[0].innerText,
  price: r.cells[1].innerText,
}));
EOF
```

## Tab 管理

```bash
agent-browser --auto-connect --session ${SID}-main tab                    # 列出所有 Tab
agent-browser --auto-connect --session ${SID}-main tab new <url>          # 打开新 Tab
agent-browser --auto-connect --session ${SID}-main tab 2                  # 切换到 Tab 2
agent-browser --auto-connect --session ${SID}-main tab close 2            # 关闭 Tab 2
```

## Session 管理

Session 隔离不同任务的浏览器状态。

```bash
# 创建隔离 session
agent-browser --auto-connect --session ${SID}-main ...

# 子 Agent 使用独立 session
agent-browser --auto-connect --session ${BROWSER_SESSION} ...

# 关闭
agent-browser --auto-connect --session ${SID}-main close                  # 关闭当前 session
agent-browser --auto-connect --session ${SID}-main close --all            # 关闭所有 session
```

## 状态持久化

保存和恢复浏览器状态（cookies、localStorage 等）。

```bash
# 保存当前状态
agent-browser --auto-connect --session ${SID}-main state save ./auth.json

# 启动时加载已保存状态
agent-browser --auto-connect --session ${SID}-main --state ./auth.json ...

# 保存登录凭据
agent-browser --auto-connect --session ${SID}-main auth save <name> ...

# 自动登录
agent-browser --auto-connect --session ${SID}-main auth login <name>
```

## 网络

监控和拦截网络请求。

```bash
# 查看请求列表
agent-browser --auto-connect --session ${SID}-main network requests

# 拦截请求
agent-browser --auto-connect --session ${SID}-main network route "**/api" --abort

# Mock 响应
agent-browser --auto-connect --session ${SID}-main network route "**/api" --body '{"mock": true}'

# HAR 录制
agent-browser --auto-connect --session ${SID}-main network har start
agent-browser --auto-connect --session ${SID}-main network har stop /tmp/trace.har
```
