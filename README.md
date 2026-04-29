# sleuth -- 梦里寻

一个 Claude Code Skill，教 AI Agent 如何像人一样浏览网页。

**agent-browser 负责「怎么操作浏览器」，sleuth 负责「什么时候该用浏览器、该怎么做」。**

---

## 目录

- [为什么做这个](#为什么做这个)
- [目录结构](#目录结构)
- [架构](#架构)
- [安装与配置](#安装与配置)
- [Claude Code 配置详解](#claude-code-配置详解)
- [依赖](#依赖)
- [核心设计](#核心设计)
- [安全性与自学习](#安全性与自学习)

---

## 为什么做这个

| 方案 | 定位 |
|------|------|
| **agent-browser** | 纯操作工具：CDP CLI，提供 open、snapshot、click、fill 等底层操作，不给 Agent 决策框架。Agent 不知道什么时候该搜索、什么时候该 agent-browser、什么时候该 curl。 |
| **WebSearch / WebFetch** | 静态 HTTP 抓取，无法处理反爬、登录态、交互操作。 |
| **sleuth** | 纯 Skill，内置决策框架。Agent 基于它自主判断用什么工具、什么顺序、怎么验证。 |

---

## 目录结构

```
sleuth/                                    项目根目录
├── SKILL.md                               ★ Skill 定义（631 行）：决策框架、工具选择、工作流、规则
├── README.md                              本文件
├── LICENSE                                MIT
├── .gitignore
│
├── .claude-plugin/                        Claude Code 插件注册
│   ├── plugin.json                        插件元数据（名称、版本、作者、标签）
│   └── marketplace.json                   市场注册信息
│
├── scripts/                               辅助工具（Node.js ESM / Bash / Python）
│   ├── lib/
│   │   └── output.mjs                     共享输出工具：路径解析、目录创建、类型映射
│   │
│   ├── check-deps.mjs                     环境检查：agent-browser + Chrome CDP + 可选依赖
│   ├── on-stop.mjs                        Stop hook：关闭 orphan session、记录复杂站点经验、关闭残留 tab
│   ├── session-logger.mjs                 会话生命周期：start / log / finish
│   ├── deliver.mjs                        文件交付：save / list / init
│   ├── cleanup-output.mjs                 过期输出清理（默认 7 天）
│   ├── update-site-stats.mjs              域名可信度自动评分（Bayesian）
│   ├── match-site.mjs                     站点经验匹配：查询域名 → 输出经验内容
│   ├── find-url.mjs                       Chrome 书签 / 历史搜索（SQLite）
│   │
│   ├── download_subtitles.sh              YouTube 字幕下载（yt-dlp）
│   ├── extract-subtitles.sh               通用字幕提取（视频 / 播客）
│   └── srt_to_transcript.py               SRT/VTT 字幕清洗为纯文本
│
├── references/                            参考文档
│   ├── tool-guide.md                      agent-browser 命令速查
│   └── site-patterns/                     站点经验文件（运行时累积，gitignore）
│       └── .gitkeep
│
└── sleuth-output/                         运行时交付文件（gitignore）
    └── YYYY-MM-DD/
        ├── <session-id>/                  每个会话一个子目录
        │   ├── docs/
        │   ├── images/
        │   ├── screenshots/
        │   ├── transcripts/
        │   ├── data/
        │   ├── pages/
        │   ├── traces/
        │   └── recordings/
        └── ...
```

### 文件说明

| 文件 | 行数 | 职责 |
|------|------|------|
| `SKILL.md` | 631 | Skill 核心：问题分诊（简单/复杂）、cache-first 策略、Plan Mode 两阶段调研、子 Agent 并行模板、snapshot-first 工作流、内容提取规则、障碍处理、交付规范、站点经验 |
| `scripts/check-deps.mjs` | 348 | 环境验证：检测 agent-browser、Chrome CDP 端口（含自动重启）、输出目录初始化、site-patterns 列表、可选依赖检查 |
| `scripts/on-stop.mjs` | 179 | Stop hook：finish 未关闭的 session → 为复杂站点（CAPTCHA/登录墙/付费墙/反爬 或 3+ 次访问）创建经验 stub → 关闭残留 tab |
| `scripts/session-logger.mjs` | 230 | 会话管理：`start`（创建带时间戳 ID 的 JSON）、`log`（追加操作记录）、`finish`（标记 outcome） |
| `scripts/deliver.mjs` | 231 | 文件交付：复制源文件到 `sleuth-output/<date>/<session-id>/<type>/`，处理文件名冲突 |
| `scripts/cleanup-output.mjs` | 220 | 清理过期输出：日期目录（7 天）、类型子目录中的旧文件、空目录 |
| `scripts/update-site-stats.mjs` | 427 | 统计聚合：从 session 日志计算域名访问次数、成功率、死链、CAPTCHA 次数、Bayesian 可信度 |
| `scripts/match-site.mjs` | 46 | 经验匹配：输入域名 → 搜索 site-patterns → 输出匹配的经验内容 |
| `scripts/find-url.mjs` | 218 | Chrome 书签/历史搜索：支持关键词、时间窗口、排序、书签/历史分离 |
| `scripts/lib/output.mjs` | 65 | 共享工具：`resolveOutputDir(sid)`、`ensureOutputDir()`、`TYPE_SUBDIR_MAP` |
| `references/tool-guide.md` | 235 | agent-browser 命令速查：导航、阅读、交互、等待、截图、数据提取、Tab/Session 管理 |

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                      sleuth (Skill)                           │
│                                                              │
│  SKILL.md             决策框架 & 工作流                       │
│                        · 问题分诊（简单 vs 复杂）              │
│                        · Cache-first + 时效性分层              │
│                        · Plan Mode（广度 → 深度两阶段）        │
│                        · 子 Agent 并行调研 + prompt 模板       │
│                        · Snapshot-first 工作流                │
│                        · 障碍处理 + 交付规范                   │
│                                                              │
│  scripts/             辅助工具（跨平台）                       │
│    lib/output.mjs        路径解析 & 类型映射                   │
│    check-deps.mjs        环境检查 + Chrome 自动重启            │
│    on-stop.mjs           Stop hook（session/site/tab 清理）   │
│    session-logger.mjs    会话生命周期管理                      │
│    deliver.mjs           文件交付到 sleuth-output/             │
│    cleanup-output.mjs    过期输出清理（7 天）                  │
│    update-site-stats.mjs 域名可信度自动评分                    │
│    match-site.mjs        站点经验匹配                         │
│    find-url.mjs          Chrome 书签/历史搜索                  │
│    download_subtitles.sh YouTube 字幕下载                     │
│    extract-subtitles.sh  播客/视频字幕提取                    │
│    srt_to_transcript.py  字幕清洗脚本                         │
│                                                              │
│  sleuth-output/           运行时交付文件目录                  │
│                                                              │
│  references/          参考文档                                │
│    tool-guide.md      agent-browser 关键命令速查              │
│    site-patterns/     站点经验累积目录（运行时写入）           │
│                                                              │
│  .claude-plugin/      Claude Code 插件注册                    │
└──────────────────────────────────────────────────────────────┘
         │
         │ Agent 通过 Bash 调用
         v
┌──────────────────────────────────────────────────────────────┐
│  agent-browser (CDP CLI)                                     │
│  open · snapshot(@ref) · click · fill · type · press         │
│  eval · screenshot · get text/html/value · wait              │
│  tab · session · network · trace · auth · state              │
└──────────────────────────────────────────────────────────────┘
         │ CDP WebSocket (127.0.0.1:9222)
         v
┌──────────────────────────────────────────────────────────────┐
│  用户日常 Chrome（有登录态、书签、历史、Cookie）              │
└──────────────────────────────────────────────────────────────┘
```

### 运行时数据目录

| 路径 | 用途 |
|------|------|
| `sleuth-output/YYYY-MM-DD/<session-id>/` | 会话交付文件（文档、截图、字幕等） |
| `~/.sleuth/sessions/*.json` | 会话日志（操作记录、域名访问、成功/失败） |
| `~/.sleuth/chrome-debug/` | Chrome CDP 调试 profile（Default 软链接到用户真实 profile） |
| `~/.sleuth/output/` | 备用输出目录（当前目录不可写时回退） |
| `references/site-patterns/*.md` | 站点经验文件（YAML frontmatter + 经验正文 + 自动统计） |

---

## 安装与配置

### 前置依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| **Node.js >= 18** | 运行所有辅助脚本 | 需预先安装 |
| **agent-browser** | CDP 浏览器操作 CLI | `npm i -g agent-browser && agent-browser install` |
| **Chrome** | 用户日常浏览器，带登录态 | 已安装（check-deps 会自动检测并开启 CDP） |
| **sqlite3** | Chrome 历史搜索（可选） | macOS/Linux 预装；Windows: `winget install sqlite.sqlite` |
| **yt-dlp** | YouTube 字幕下载（可选） | `pip install yt-dlp` |
| **Python 3** | 字幕清洗（可选） | macOS/Linux 预装 |

### 快速安装

```bash
# 1. 克隆到任意位置
git clone <repo-url> ~/git/sleuth

# 2. 安装 agent-browser
npm i -g agent-browser && agent-browser install

# 3. 检查环境
node ~/git/sleuth/scripts/check-deps.mjs
```

### Chrome CDP 连接

Chrome 147+ 要求非默认 `--user-data-dir` 才能开启远程调试。`check-deps.mjs` 会自动处理：

1. 检测 CDP 端口（`DevToolsActivePort` 文件 + 常用端口探测）
2. 如不可用，自动：关闭 Chrome → 创建 `~/.sleuth/chrome-debug/`（软链接 Default profile）→ 以 `--remote-debugging-port=9222` 重启
3. 用户无需手动操作

如需手动启动：

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.sleuth/chrome-debug \
  --no-first-run &
```

---

## Claude Code 配置详解

### 配置文件位置

Claude Code 使用两个全局配置文件。如果你用的是默认 profile，路径为 `~/.claude/`；如果用了命名 profile（如 `deepseek`），则为 `~/.claude-<profile>/`：

```
# 默认 profile
~/.claude/settings.json
~/.claude/settings.local.json

# 命名 profile（如 deepseek）
~/.claude-deepseek/settings.json
~/.claude-deepseek/settings.local.json
```

下文示例统一使用 `~/.claude/` 路径，请根据实际 profile 替换。Hook 脚本同理（`~/.claude/hooks/` 或 `~/.claude-deepseek/hooks/`）。

```
~/.claude/                         或 ~/.claude-<profile>/
├── settings.json              全局设置（hooks、模型、插件）
├── settings.local.json        本地权限（allow / deny 规则）
└── hooks/
    ├── block-web-tool-shortcuts.sh    PreToolUse hook 脚本
    └── route-web-requests.sh          UserPromptSubmit hook 脚本
```

### 一、settings.json — 全局设置

需要在 `hooks` 中配置三项：

#### 1. PreToolUse hook — 拦截 Web 工具

阻止 Agent 使用 WebSearch、WebFetch、Fetch 及 MCP web 工具，强制所有联网操作走 sleuth。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebSearch|WebFetch|Fetch|mcp__tavily__tavily_search|mcp__tavily__tavily_extract|mcp__tavily__tavily_crawl|mcp__web_reader__webReader|mcp__web_search_prime__webSearchPrime",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/block-web-tool-shortcuts.sh",
            "statusMessage": "拦截 WebSearch/WebFetch/Fetch 及 MCP web 工具，请用 /sleuth..."
          }
        ]
      }
    ]
  }
}
```

Hook 脚本 `~/.claude/hooks/block-web-tool-shortcuts.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT_JSON=$(cat)
export INPUT_JSON

python3 - <<'PY'
import json, os, sys

payload = json.loads(os.environ["INPUT_JSON"])
tool_name = str(payload.get("tool_name", "") or "")
tool_name_lower = tool_name.lower()

blocked = False
reason = None

blocked_mcp_tools = {
    "mcp__web_search_prime__websearchprime",
    "mcp__web_reader__webreader",
    "mcp__tavily__tavily_search",
    "mcp__tavily__tavily_extract",
    "mcp__tavily__tavily_crawl",
}

if tool_name in {"WebSearch", "WebFetch", "Fetch"}:
    blocked = True
    reason = "Web search/fetch tools blocked. Use `/sleuth` skill."
elif tool_name_lower in blocked_mcp_tools:
    blocked = True
    reason = "MCP web tools blocked. Use `/sleuth` skill."

response = {"continue": True, "suppressOutput": True}
if blocked:
    response["hookSpecificOutput"] = {"hookEventName": "PreToolUse", "permissionDecision": "deny"}
    response["systemMessage"] = reason

json.dump(response, sys.stdout, ensure_ascii=False)
PY
```

#### 2. UserPromptSubmit hook — 搜索意图路由

检测用户 prompt 中的搜索意图，注入提示让 Agent 使用 sleuth skill。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/route-web-requests.sh",
            "statusMessage": "检测搜索意图，路由到 sleuth skill..."
          }
        ]
      }
    ]
  }
}
```

Hook 脚本 `~/.claude/hooks/route-web-requests.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT_JSON=$(cat)
export INPUT_JSON

python3 - <<'PY'
import json, os, re, sys

payload = json.loads(os.environ["INPUT_JSON"])
prompt = payload.get("user_prompt") or payload.get("prompt") or ""
if not isinstance(prompt, str):
    prompt = ""
text = prompt.strip()

search_patterns = [
    r"搜索", r"搜一下", r"查一下", r"查一查", r"帮我查", r"联网搜索",
    r"look\s+up", r"\bsearch\b", r"\bgoogle\b",
    r"\bfind\s+latest\b", r"\blatest\s+(?:news|updates|info|information)\b",
]

system_message = None
if any(re.search(p, text, re.IGNORECASE) for p in search_patterns):
    system_message = "Web search detected. Do not use WebSearch/WebFetch/Fetch. Use `/sleuth` skill."

response = {"continue": True, "suppressOutput": True}
if system_message:
    response["systemMessage"] = system_message

json.dump(response, sys.stdout, ensure_ascii=False)
PY
```

#### 3. Stop hook — 会话清理

对话结束时自动执行：关闭未完成的 session → 为复杂站点创建经验 stub → 关闭残留 tab。

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/sleuth/scripts/on-stop.mjs",
            "statusMessage": "清理未关闭 session、记录复杂站点经验、关闭残留 tab..."
          }
        ]
      }
    ]
  }
}
```

**注意**：`command` 中必须使用 on-stop.mjs 的绝对路径（不能用 `~` 或 `$HOME`）。

#### 完整 settings.json 示例

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebSearch|WebFetch|Fetch|mcp__tavily__tavily_search|mcp__tavily__tavily_extract|mcp__tavily__tavily_crawl|mcp__web_reader__webReader|mcp__web_search_prime__webSearchPrime",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/block-web-tool-shortcuts.sh",
            "statusMessage": "拦截 Web 工具，请用 /sleuth..."
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/route-web-requests.sh",
            "statusMessage": "检测搜索意图，路由到 sleuth..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/you/git/sleuth/scripts/on-stop.mjs",
            "statusMessage": "清理 session、记录经验、关闭 tab..."
          }
        ]
      }
    ]
  }
}
```

### 二、settings.local.json — 权限配置

自动放行 sleuth 相关命令，避免每次操作都弹确认框。

```json
{
  "permissions": {
    "allow": [
      "Bash(agent-browser *)",
      "Bash(node /Users/you/git/sleuth/scripts/*.mjs *)",
      "Bash(curl http://127.0.0.1:9*)",
      "Bash(find /Users/you/git/sleuth/sleuth-output*)"
    ],
    "deny": [
      "Fetch",
      "WebFetch",
      "WebSearch",
      "mcp__tavily__tavily_search",
      "mcp__tavily__tavily_extract",
      "mcp__tavily__tavily_crawl",
      "mcp__web_reader__webReader",
      "mcp__web_search_prime__webSearchPrime"
    ]
  }
}
```

| 规则 | 说明 |
|------|------|
| `Bash(agent-browser *)` | 放行所有 agent-browser 操作 |
| `Bash(node .../scripts/*.mjs *)` | 放行 sleuth 所有脚本 |
| `Bash(curl http://127.0.0.1:9*)` | 放行 CDP 端口检测 |
| `Bash(find .../sleuth-output*)` | 放行输出目录搜索 |
| `deny: WebSearch/WebFetch/Fetch/MCP web tools` | 权限层兜底拦截 Web 工具 |

**注意**：将路径中的 `/Users/you/git/sleuth` 替换为你的实际安装路径。

### 三层防护体系

配置完成后，Web 工具拦截形成三层防护：

| 层级 | 机制 | 文件 |
|------|------|------|
| **意图检测** | UserPromptSubmit hook 扫描 prompt 中的搜索关键词，注入 redirect 消息 | `route-web-requests.sh` |
| **工具拦截** | PreToolUse hook 拒绝 WebSearch/WebFetch/Fetch 及 MCP web 工具的调用 | `block-web-tool-shortcuts.sh` |
| **权限兜底** | settings.local.json 的 deny 列表在权限层阻止 | `settings.local.json` |

### 四、hook 脚本部署

```bash
# 创建 hooks 目录（根据你的 profile 替换路径）
mkdir -p ~/.claude/hooks
# 如果用命名 profile：mkdir -p ~/.claude-deepseek/hooks

# 将上方两个 hook 脚本放到 hooks 目录中
# 文件名：block-web-tool-shortcuts.sh、route-web-requests.sh

# 设置可执行权限
chmod +x ~/.claude/hooks/block-web-tool-shortcuts.sh
chmod +x ~/.claude/hooks/route-web-requests.sh
# 注意：settings.json 中 command 路径要与此处一致
# 如使用命名 profile，command 应写 ~/.claude-deepseek/hooks/xxx.sh
```

### 五、验证配置

```bash
# 1. 验证 JSON 语法
python3 -c "import json; json.load(open('$HOME/.claude/settings.json'))"
python3 -c "import json; json.load(open('$HOME/.claude/settings.local.json'))"

# 2. 验证 hook 脚本可执行
~/.claude/hooks/block-web-tool-shortcuts.sh <<< '{"tool_name":"WebSearch"}'
~/.claude/hooks/route-web-requests.sh <<< '{"user_prompt":"搜索今日汇率"}'

# 3. 验证 on-stop.mjs
node /path/to/sleuth/scripts/on-stop.mjs

# 4. 验证环境
node /path/to/sleuth/scripts/check-deps.mjs

# 5. 验证 skill 加载
# 在 Claude Code 中输入 /sleuth，应能看到 SKILL.md 内容
```

---

## 核心设计

### 浏览哲学

**四阶段决策**：

1. **理解目标** — 定义成功标准：要获取什么信息、执行什么操作、达到什么结果
2. **选择起点** — 根据任务性质选最可能直达的方式：已知反爬平台直接 agent-browser，信息检索先搜索引擎
3. **过程验证** — 每一步结果是证据，不只是成败二元信号。方向错了立即调整
4. **完成判断** — 达标即停，不为了"完整"过度操作

### Snapshot-first 工作流

```
1. agent-browser open <url>         # 打开页面
2. agent-browser snapshot -i        # 获取交互元素 @ref
3. agent-browser click @e3          # 基于 ref 操作
4. agent-browser snapshot -i        # 页面变化后重新快照
5. agent-browser fill @e5 "text"    # 继续操作
```

@ref 每次 snapshot 重新分配，页面变化后立即失效 — 操作前必须重新 snapshot。

### 结构化调研（Plan Mode）

复杂调研（预计 3+ subagent、多源交叉验证）采用两阶段：

1. **广度探索**：多角度并行搜索，每个角度一个 subagent。快速摸清信息地图。
2. **深度定向**：基于阶段 1 发现，对有价值的方向深入，补齐一手来源、交叉验证。

### 子 Agent 并行调研

主 Agent 担任总指挥，分解任务、分发子 Agent、判断结果、整合结论。每个子 Agent 通过 `run_in_background: true` 异步执行，浏览器通过 `--session <name>` 隔离 tab。

### 站点经验系统

按域名存储在 `references/site-patterns/` 下：

```markdown
---
domain: example.com
aliases: [示例]
updated: 2026-04-26
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么

## 自动统计
- 访问次数: 12
- 成功率: 83%
- Bayesian 可信度: 0.79
- 最后访问: 2026-04-28
```

操作前通过 `match-site.mjs` 读取经验，操作后 `update-site-stats.mjs` 更新统计。Stop hook 自动为复杂站点创建 stub。

---

## 安全性与自学习

### 安全原则

- **不出站数据**：skill 运行在本地，不发送 cookie、密码到外部服务
- **最小权限**：仅操作 CDP 端口（本地回环），不需要网络出口权限
- **用户可见**：所有浏览器操作在用户 Chrome 中执行，屏幕操作完全可见

### 自学习

- **会话日志**：每次任务的渠道选择、域名访问、成功/失败自动记录到 `~/.sleuth/sessions/`
- **域名可信度评分**：基于历史数据计算 Bayesian 可信度分 `(success+1)/(visits+2)`
- **复杂站点自动记录**：Stop hook 为触发 CAPTCHA/登录墙/付费墙的站点自动创建经验 stub

---

## 平台支持

| 平台 | 状态 | 备注 |
|------|------|------|
| **macOS** | 完全支持 | 主要开发平台 |
| **Linux** | 完全支持 | Chrome 路径自动适配 |
| **Windows** | 完全支持 | `LOCALAPPDATA` 路径自动适配 |

## 不做的事

| 不做 | 原因 |
|------|------|
| 不封装 CDP 协议 | agent-browser 已经做好了 |
| 不写浏览器自动化代码 | agent-browser 覆盖了所有操作 |
| 不做 MCP 协议兼容 | Skill 通过 Bash 调用 agent-browser |
| 不自己管理浏览器进程 | agent-browser 有 daemon 模式 |
