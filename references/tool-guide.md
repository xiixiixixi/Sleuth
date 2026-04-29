# agent-browser 命令速查

> 本文是 AI Agent 的 agent-browser 关键命令速查，按场景组织。完整文档请用 `agent-browser skills get core --full` 查看。

**核心原则**：snapshot + @ref 是推荐工作流。先用 `snapshot -i` 获取交互元素列表（带 @ref 编号），再通过 @ref 操作页面。`find role/text/label` 作为 fallback。CSS selector 是最后手段。

---

## 连接 Chrome

连接用户的日常 Chrome 以复用登录态和书签。Chrome 必须通过 `--remote-debugging-port` 启动（`chrome://inspect` 复选框方式不兼容）。

```bash
# macOS 手动启动 Chrome（CDP 端口 9222）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 &

# 通过 check-deps 自动检测和重启（推荐）
node check-deps.mjs

# agent-browser 连接
agent-browser connect 9222
```

## 导航

页面跳转和刷新。

```bash
agent-browser open https://example.com
agent-browser back
agent-browser forward
agent-browser reload
```

## 阅读页面

获取页面内容和状态。`snapshot -i` 是最核心命令。

```bash
# 交互元素 + @ref（最常用）
agent-browser snapshot -i

# 紧凑模式（减少 token 消耗）
agent-browser snapshot -i -c

# 包含链接 URL
agent-browser snapshot -i -u

# JSON 输出（程序解析用）
agent-browser snapshot -i --json

# 限定范围（只扫描指定 CSS selector 内）
agent-browser snapshot -s "#main"

# 获取元素信息
agent-browser get text @e1          # 可见文本
agent-browser get html @e1          # innerHTML
agent-browser get attr @e1 href     # 属性值
agent-browser get value @e1         # input 当前值

# 获取页面元信息
agent-browser get title
agent-browser get url
agent-browser get count ".item"     # 元素数量
```

## 交互

通过 @ref 操作页面元素。每次 snapshot 后 @ref 会重新分配，操作前必须重新 snapshot。

```bash
# 点击
agent-browser click @e1
agent-browser click @e1 --new-tab   # 在新 Tab 打开链接

# 双击
agent-browser dblclick @e1

# 悬停
agent-browser hover @e1

# 聚焦
agent-browser focus @e1

# 输入
agent-browser fill @e1 "text"       # 清空后输入
agent-browser type @e1 "text"       # 追加输入

# 按键
agent-browser press Enter
agent-browser press Control+a       # 组合键

# 表单操作
agent-browser check @e1             # 勾选
agent-browser uncheck @e1           # 取消勾选
agent-browser select @e1 "value"    # 下拉选择
agent-browser upload @e1 file.pdf   # 文件上传

# 滚动
agent-browser scroll down 500       # 向下滚动 500px
agent-browser scrollintoview @e1    # 滚动到元素可见

# 拖拽
agent-browser drag @e1 @e2          # 从 @e1 拖到 @e2
```

## 定位器

不用 snapshot 时，通过角色/文本/标签定位元素并操作。适合简单场景或 fallback。

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search" type "query"
agent-browser find testid "submit-btn" click
agent-browser find first ".card" click
agent-browser find nth 2 ".card" hover
```

## 等待

等待页面状态变化，避免固定延时。

```bash
# 等元素出现（推荐）
agent-browser wait @e1

# 等文字出现
agent-browser wait --text "Success"

# 等 URL 匹配
agent-browser wait --url "**/dashboard"

# 等网络空闲（SPA 导航后推荐）
agent-browser wait --load networkidle

# 等 DOM 就绪
agent-browser wait --load domcontentloaded

# 等 JS 条件满足
agent-browser wait --fn "window.ready"

# 固定等待（最后手段，仅在上述方法都失效时使用）
agent-browser wait 2000
```

## 截图

```bash
agent-browser screenshot                # 当前视口
agent-browser screenshot page.png       # 指定路径
agent-browser screenshot --full         # 全页
agent-browser screenshot --annotate     # 标注 @ref 编号（给多模态模型用）
```

## 数据提取

从页面提取结构化数据。

```bash
# 简单表达式
agent-browser eval "document.title"

# 复杂提取（推荐用 heredoc）
agent-browser eval --stdin <<'EOF'
const rows = document.querySelectorAll("table tr");
Array.from(rows).map(r => ({
  name: r.cells[0].innerText,
  price: r.cells[1].innerText,
}));
EOF
```

## Tab 管理

```bash
agent-browser tab                    # 列出所有 Tab
agent-browser tab new <url>          # 打开新 Tab
agent-browser tab 2                  # 切换到 Tab 2
agent-browser tab close 2            # 关闭 Tab 2
```

## Session 管理

Session 隔离不同任务的浏览器状态。

```bash
# 创建隔离 session
agent-browser --session <name> ...

# 自动保存/恢复状态（跨 Agent 调用可用）
agent-browser --session-name <name> ...

# 关闭
agent-browser close                  # 关闭当前 session
agent-browser close --all            # 关闭所有 session
```

## 状态持久化

保存和恢复浏览器状态（cookies、localStorage 等）。

```bash
# 保存当前状态
agent-browser state save ./auth.json

# 启动时加载已保存状态
agent-browser --state ./auth.json ...

# 保存登录凭据
agent-browser auth save <name> ...

# 自动登录
agent-browser auth login <name>
```

## 网络

监控和拦截网络请求。

```bash
# 查看请求列表
agent-browser network requests

# 拦截请求
agent-browser network route "**/api" --abort

# Mock 响应
agent-browser network route "**/api" --body '{"mock": true}'

# HAR 录制
agent-browser network har start
agent-browser network har stop /tmp/trace.har
```
