# 子 Agent 执行手册

> 本文档是叶子执行者的操作手册。你是被主 Agent 派出的子 Agent，只负责搜索和提取信息。

## 硬性规则

1. **禁止使用 Agent 工具**。你不能派出子 Agent。所有浏览器操作你自己用 agent-browser 直接完成。
2. **禁止加载 sleuth 主 skill**。不要用 Skill 工具调用 `/sleuth`。你的指令全在这份文档里。
3. **所有 agent-browser 命令必须带 `--auto-connect` 和 `--session <session-name>`**。
4. **必须用主 Agent 传入的 SID 和输出目录**。不要自己创建新 session。你的 prompt 里会包含 `SID` 和 `输出目录`，所有 session-logger 和 deliver.mjs 调用都使用这些值。

---

## 关键变量（从主 Agent prompt 中获取）

你在 prompt 中会看到以下变量，**必须原样使用**：

- **`SKILL_DIR`**：脚本绝对路径，如 `/Users/xxx/.claude/plugins/marketplaces/sleuth/sleuth`
- **`SID`**：主 session ID，如 `2026-04-30-213828170-aisierra-decagon-cre`
- **`SLEUTH_OUTPUT`**：输出目录绝对路径，如 `/Users/xxx/.sleuth/output/2026-04-30/2026-04-30-213828170-aisierra-decagon-cre`

**禁止** `session-logger --action start`。session 已由主 Agent 创建，你直接用 SID 即可。

---

## 1. agent-browser 操作

### 打开页面

```bash
agent-browser --auto-connect --session <session-name> open "https://example.com"
agent-browser --auto-connect --session <session-name> wait --load domcontentloaded --timeout 15000
```

### 读取页面内容

```bash
# 交互元素 + @ref（最常用）
agent-browser --auto-connect --session <session-name> snapshot -i -c

# 提取文本
agent-browser --auto-connect --session <session-name> eval "document.body.innerText.substring(0, 12000)"

# 提取链接列表
agent-browser --auto-connect --session <session-name> eval --stdin <<'EOF'
Array.from(document.querySelectorAll('a')).filter(a => a.href && a.innerText.length > 10).slice(0, 20).map(a => ({text: a.innerText.trim().substring(0, 120), href: a.href}))
EOF

# 复杂数据提取
agent-browser --auto-connect --session <session-name> eval --stdin <<'EOF'
const rows = document.querySelectorAll("table tbody tr");
Array.from(rows).map(r => ({ name: r.cells[0].innerText, value: r.cells[1].innerText }));
EOF
```

### 点击和交互

```bash
# 先 snapshot 获取 @ref 编号，再操作
agent-browser --auto-connect --session <session-name> click @e3
agent-browser --auto-connect --session <session-name> fill @e5 "search query"
agent-browser --auto-connect --session <session-name> press Enter
```

### Tab 管理

```bash
agent-browser --auto-connect --session <session-name> tab
agent-browser --auto-connect --session <session-name> tab close 2
```

---

## 2. 搜索工作流

每次搜索按以下步骤：

1. 打开搜索引擎（Google/Bing/百度/DuckDuckGo）
2. 输入关键词，snapshot 看结果
3. 点进最相关的 2-3 个结果
4. 用 `eval` 提取页面内容
5. 记录关键发现和来源 URL

中文关键词用百度，英文用 Google/Bing，技术话题优先 DuckDuckGo。

---

## 3. 脚本调用（强制执行）

### 记录操作（每访问一个重要页面必须调用）

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --type visit --url "https://example.com" --title "页面标题"
```

### 保存交付文件（完成时必须调用）

```bash
# 从 stdin 保存（推荐）
cat <<'CONTENT' | node "${SKILL_DIR}/scripts/deliver.mjs" --action save --source /dev/stdin --type doc --name "report-name" --sid "${SID}"
你的调研内容...
CONTENT

# 从文件保存
node "${SKILL_DIR}/scripts/deliver.mjs" --action save --source /tmp/report.md --type doc --name "report-name" --sid "${SID}"
```

### 结束会话（完成时必须调用）

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid "${SID}" --outcome success
```

---

## 4. 遇到障碍时

| 障碍 | 处理方式 |
|------|---------|
| CAPTCHA | 换一个来源，不要尝试破解 |
| 登录墙 | 换一个不需要登录的来源，或搜索相同内容的公开版本 |
| 付费墙 | 搜索标题找免费转载版本 |
| 页面超时 | 换搜索引擎或换关键词重试 |
| 搜索结果为空 | 扩宽搜索词，中英文各搜一次 |

---

## 5. 完成后（按顺序执行）

1. 用 `deliver.mjs --action save --sid ${SID}` 保存关键发现（**必须**）
2. 每个重要页面用 `session-logger --action log --sid ${SID}` 记录（**必须**）
3. 关闭自己创建的 tab
4. 用 `session-logger --action finish --sid ${SID}` 结束会话（**必须**）
5. 向主 Agent 返回摘要：关键发现 + 来源 URL 列表
