# 子 Agent 执行手册

> 本文档是叶子执行者的操作手册。你是被主 Agent 派出的子 Agent，只负责搜索和提取信息。

## 硬性规则

1. **禁止使用 Agent 工具**。你不能派出子 Agent。所有浏览器操作你自己用 agent-browser 直接完成。
2. **禁止加载 sleuth 主 skill**。不要用 Skill 工具调用 `/sleuth`。你的指令全在这份文档里。
3. **所有 agent-browser 命令必须连接用户日常/登录态 Chrome，并带 `--auto-connect --session "${BROWSER_SESSION}"`**。
4. **必须用主 Agent 传入的 SID 和输出目录**。不要自己创建新 session。你的 prompt 里会包含 `SID` 和 `输出目录`，所有 session-logger 和 deliver.mjs 调用都使用这些值。
5. **禁止 finish 主 session**。完成时只记录 `subagent_done`，最终 `finish` 只能由主 Agent 执行。

---

## 关键变量（从主 Agent prompt 中获取）

你在 prompt 中会看到以下变量，**必须原样使用**：

- **`SKILL_DIR`**：脚本绝对路径，如 `/Users/xxx/.claude/plugins/marketplaces/sleuth/sleuth`
- **`SID`**：主 session ID，如 `2026-04-30-213828170-aisierra-decagon-cre`
- **`SLEUTH_OUTPUT`**：输出目录绝对路径，如 `/Users/xxx/.sleuth/output/2026-04-30/2026-04-30-213828170-aisierra-decagon-cre`
- **`BROWSER_SESSION`**：主 Agent 分配的浏览器隔离 session，如 `2026-04-30-213828170-aisierra-decagon-cre-pricing`

**禁止** `session-logger --action start`。session 已由主 Agent 创建，你直接用 SID 即可。
**禁止**自己发明浏览器 session 名。所有 agent-browser 命令都必须原样使用 `${BROWSER_SESSION}`。

---

## 1. agent-browser 操作

### 打开页面

```bash
agent-browser --auto-connect --session "${BROWSER_SESSION}" open "https://example.com"
agent-browser --auto-connect --session "${BROWSER_SESSION}" wait --load domcontentloaded --timeout 15000
```

### 读取页面内容

```bash
# 交互元素 + @ref（最常用）
agent-browser --auto-connect --session "${BROWSER_SESSION}" snapshot -i -c

# 提取文本
agent-browser --auto-connect --session "${BROWSER_SESSION}" eval "document.body.innerText.substring(0, 12000)"

# 提取链接列表
agent-browser --auto-connect --session "${BROWSER_SESSION}" eval --stdin <<'EOF'
Array.from(document.querySelectorAll('a')).filter(a => a.href && a.innerText.length > 10).slice(0, 20).map(a => ({text: a.innerText.trim().substring(0, 120), href: a.href}))
EOF

# 复杂数据提取
agent-browser --auto-connect --session "${BROWSER_SESSION}" eval --stdin <<'EOF'
const rows = document.querySelectorAll("table tbody tr");
Array.from(rows).map(r => ({ name: r.cells[0].innerText, value: r.cells[1].innerText }));
EOF
```

### 点击和交互

```bash
# 先 snapshot 获取 @ref 编号，再操作
agent-browser --auto-connect --session "${BROWSER_SESSION}" click @e3
agent-browser --auto-connect --session "${BROWSER_SESSION}" fill @e5 "search query"
agent-browser --auto-connect --session "${BROWSER_SESSION}" press Enter
```

### Tab 管理

```bash
agent-browser --auto-connect --session "${BROWSER_SESSION}" tab
agent-browser --auto-connect --session "${BROWSER_SESSION}" tab close 2
```

---

## 2. 搜索工作流

### 搜索原则

- **多角度**：至少 4-5 个角度互为补充，读到的关键词作为下一角度的搜索词
- **读全文**：搜索引擎摘要可能过时/截断，必须点进原文用 `eval` 提取
- **Broad → narrow**：先宽搜看量级，太多加限定，太少扩词或中英文各搜
- **探索式循环**：搜索 → 点进 2-3 个链接 → 不够换词重搜 → 够了停止。同一页 3 个链接不理想就换词
- **站内搜索**：找到目标网站后用 `site:域名 关键词` 深挖官网博客、投资人页面、媒体报道
- **读全文后记录**：每读一个重要页面，用 session-logger log 记录来源 URL 和提取结果：
  ```bash
  node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"visit","url":"https://example.com","domain":"example.com","extraction_success":true}'
  ```
  提取失败时 `extraction_success` 改为 `false`

### 搜索引擎选择

| 场景 | 首选 | 补充 |
|------|------|------|
| 英文通用 | Google | — |
| 中文内容 | 百度 | Google 中文 |
| 创始人访谈/产品演示/播客 | **YouTube** | Google `site:youtube.com` |
| 特定网站内容 | `site:域名 关键词` | — |

### YouTube 搜索

YouTube 有大量创始人访谈、产品演示、行业分析视频。搜索时**必须**尝试 YouTube：

```bash
# 直接搜索 YouTube
agent-browser --auto-connect --session "${BROWSER_SESSION}" open "https://www.youtube.com/results?search_query=Sierra+AI+Bret+Taylor+interview"
# 或用 Google 站内搜
agent-browser --auto-connect --session "${BROWSER_SESSION}" open "https://www.google.com/search?q=site:youtube.com+Decagon+AI+founder+interview"
```

找到视频后提取字幕或 shownotes（见内容提取部分）。

---

## 3. 脚本调用（强制执行）

### 记录操作（每访问一个重要页面必须调用）

```bash
# 提取成功
node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"visit","url":"https://example.com","domain":"example.com","extraction_success":true}'
# 提取失败
node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"visit","url":"https://example.com","domain":"example.com","extraction_success":false}'
```

### 保存交付文件（完成时必须调用）

```bash
# 从 stdin 保存（推荐）— --url 传入内容来源的网页 URL
cat <<'CONTENT' | node "${SKILL_DIR}/scripts/deliver.mjs" --action save --source /dev/stdin --type doc --name "report-name" --url "来源页面URL" --sid "${SID}"
你的调研内容...
CONTENT

# 从文件保存
node "${SKILL_DIR}/scripts/deliver.mjs" --action save --source /tmp/report.md --type doc --name "report-name" --url "来源页面URL" --sid "${SID}"
```

### 标记子任务完成（完成时必须调用）

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"subagent_done","name":"'"${BROWSER_SESSION}"'"}'
```

**禁止**执行 `session-logger --action finish`。只有主 Agent 能结束主 session。

---

## 4. 遇到障碍时

| 障碍 | 处理方式 |
|------|---------|
| CAPTCHA | 换一个来源，不要尝试破解 |
| 登录墙 | 换一个不需要登录的来源，或搜索相同内容的公开版本 |
| 付费墙 | 搜索标题找免费转载版本 |
| 页面超时 | 换搜索引擎或换关键词重试 |
| 搜索结果为空 | 扩宽搜索词，中英文各搜一次 |

**遇到障碍时必须记录**（用于站点经验系统）：
```bash
# CAPTCHA
node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"captcha","url":"<URL>","domain":"<域名>"}'
# 登录墙
... --operation '{"type":"login_wall","url":"<URL>","domain":"<域名>"}'
# 付费墙
... --operation '{"type":"paywall","url":"<URL>","domain":"<域名>"}'
# 死链
... --operation '{"type":"dead_link","url":"<URL>","domain":"<域名>"}'
# 反爬
... --operation '{"type":"anti_bot","url":"<URL>","domain":"<域名>"}'
```

---

## 5. 完成后（按顺序执行）

1. 用 `deliver.mjs --action save --sid ${SID}` 保存关键发现（**必须**）
2. 每个重要页面用 session-logger log 记录，包含 domain 和 extraction_success（**必须**）
3. 关闭自己创建的浏览器 session：`agent-browser --auto-connect --session "${BROWSER_SESSION}" close`
4. 记录 `subagent_done`，不要 finish 主 session（**必须**）
5. 向主 Agent 返回摘要：关键发现 + 来源 URL 列表
