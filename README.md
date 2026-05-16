# Sleuth — 梦里寻

Agent skill，把网页访问从"会点页面"提升到"会做判断"。

**agent-browser 负责浏览器执行，sleuth 负责研究判断；WebSearch / WebFetch 等工具可以参与，但每种工具都有自己的证据边界。**

---

## 目录

- [为什么做这个](#为什么做这个)
- [目录结构](#目录结构)
- [架构](#架构)
- [安装与配置](#安装与配置)
- [核心设计](#核心设计)
- [安全性与自学习](#安全性与自学习)

---

## 为什么做这个

| 组件 | 角色 | 证据边界 |
|------|------|----------|
| **WebSearch / Search APIs** | 发现候选来源、别名、关键词地图 | 不完整，受排序和 snippet 偏置影响，不能直接充当最终证明 |
| **WebFetch / Jina / Firecrawl / curl-like readers** | 快速读取正文、降 token、批量扫页面 | 不保证布局、交互、登录态、动态内容的真实性 |
| **agent-browser** | 浏览器验证层：DOM、eval、tab、network、state、auth | 成本更高，但适合一手页面、动态页面、登录态和真实交互 |
| **本地历史 / 书签 / site-patterns** | 用户或组织的本地记忆、非索引入口 | 适合作为直达入口，不自动代表事实真实性 |
| **sleuth** | 研究判断层：定义目标、选入口、设证据要求、决定何时停止 | 不把某个工具当真理，也不把固定流程当质量保证 |

Sleuth 的目标不是把所有联网任务都强行改成浏览器任务，而是让 Agent 知道：什么时候该侦察，什么时候该速读，什么时候必须回到浏览器和原始来源做验证。

---

## 目录结构

```
sleuth/
├── SKILL.md                       主 skill：研究判断、工具角色、交付约定
│
├── docs/
│   └── browser-auth-and-channel-intelligence-plan.md  设计文档
│
├── scripts/
│   ├── lib/
│   │   ├── check-deps-core.mjs    环境检查核心逻辑（纯导出，不自动执行）
│   │   ├── output.mjs             共享输出工具：路径解析、目录创建、类型映射
│   │   ├── registry.mjs           跨 session 交付物 registry 与召回评分
│   │   └── validate.mjs           参数校验
│   ├── check-deps.mjs             CLI 入口（薄 shim，解析参数调 core）
│   ├── sleuth-browser.mjs         Managed browser 生命周期 CLI（status/ensure/open-login/stop）
│   ├── on-stop.mjs                session 清理、站点经验沉淀
│   ├── session-logger.mjs         会话生命周期：start / log / finish
│   ├── deliver.mjs                文件交付：save / list / init / merge
│   ├── research-index.mjs         历史召回：index / query / recall / backfill
│   ├── cleanup-output.mjs         过期输出清理（默认 7 天）
│   ├── update-site-stats.mjs      域名可信度自动评分（Bayesian）
│   ├── match-site.mjs             站点经验匹配：查询域名 → 输出经验内容
│   ├── find-url.mjs               Chrome 书签 / 历史搜索（SQLite）
│   ├── extract-subtitles.sh       通用字幕提取（视频 / 播客）
│   └── srt_to_transcript.py       SRT/VTT 字幕清洗为纯文本
│
├── references/
│   ├── tool-guide.md              agent-browser 命令速查 + 观察/交互策略
│   ├── search-guide.md            主 Agent 与子 Agent 共用的搜索判断
│   ├── subagent-guide.md          子 Agent 目标/证据/输出合同
│   ├── search-expansion.md        搜索拓宽盲区（六个常见漏项）
│   ├── review-checklist.md        独立审查参考清单
│   ├── content-extraction.md      内容提取（视频/音频/PDF/图片）
│   └── site-patterns/.gitkeep     占位（实际经验存 ~/.sleuth/site-patterns/）
│
├── README.md
└── LICENSE
```

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                      sleuth (Skill)                           │
│                                                              │
│  SKILL.md            研究判断层                              │
│                      · 目标/完成标准                          │
│                      · 工具角色与证据边界                    │
│                      · 主 Agent / 子 Agent 共用搜索逻辑       │
│                      · 浏览器执行姿势                        │
│                      · 深度研究交付约定                      │
│                                                              │
│  references/         运行时参考文档                           │
│    search-guide.md       共享搜索判断                        │
│    subagent-guide.md     子 Agent 合同                       │
│    review-checklist.md   独立审查标准                        │
│    tool-guide.md         agent-browser 观察/提取/交互手册    │
└──────────────────────────────────────────────────────────────┘
         │
         │ Agent 通过 Bash / 工具调用
         v
┌──────────────────────────────────────────────────────────────┐
│  agent-browser (CDP CLI)                                     │
│  open · eval · snapshot · click · fill · wait               │
│  tab · session · network · auth · state                     │
└──────────────────────────────────────────────────────────────┘
         │ CDP WebSocket (127.0.0.1:$SLEUTH_CDP_PORT)
         v
┌──────────────────────────────────────────────────────────────┐
│  Sleuth Managed Browser（~/.sleuth/cdp-profile/）             │
│  独立 Chrome 实例，持久登录态，永不触碰用户日常 Chrome       │
└──────────────────────────────────────────────────────────────┘
```

### 运行时数据目录

| 路径 | 用途 |
|------|------|
| `~/.sleuth/output/YYYY-MM-DD/<session-id>/` | 会话交付文件（文档、截图、字幕等） |
| `~/.sleuth/output/registry.jsonl` | 跨日期 artifact registry，用于 recall 历史交付物 |
| `~/.sleuth/sessions/*.json` | 会话日志（操作记录、域名访问、成功/失败） |
| `~/.sleuth/knowledge/entities.json` | 从交付文件提取的实体/事实索引 |
| `~/.sleuth/cdp-profile/` | Managed browser profile（CDP 独立实例，持久登录态） |
| `~/.sleuth/cdp-state.json` | Managed browser 运行状态（pid、port、启动时间） |
| `~/.sleuth/site-patterns/*.md` | 站点经验文件（YAML frontmatter + 经验正文 + 自动统计） |

---

## 安装与配置

### 前置依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| **Node.js >= 18** | 运行所有辅助脚本 | 需预先安装 |
| **agent-browser** | CDP 浏览器操作 CLI | `npm i -g agent-browser && agent-browser install` |
| **Chrome** | Managed browser 基础 | 已安装（`check-deps` 会自动启动独立实例） |
| **sqlite3** | Chrome 历史搜索（可选） | macOS/Linux 预装；Windows: `winget install sqlite.sqlite` |
| **yt-dlp** | YouTube 字幕下载（可选） | `pip install yt-dlp` |
| **Python 3** | 字幕清洗（可选） | macOS/Linux 预装 |

### 安装 Skill

```bash
# 一键安装（全局，推荐）
npx skills add xiixiixixi/Sleuth -g

# 安装到当前项目
npx skills add xiixiixixi/Sleuth

# 手动 clone
git clone https://github.com/xiixiixixi/Sleuth.git ~/.agents/skills/sleuth
```

### 权限配置

使用 sleuth 需要以下 allow 规则（添加到 `settings.local.json`）：

```json
{
  "permissions": {
    "allow": [
      "Bash(agent-browser *)",
      "Bash(node <skill-path>/scripts/*.mjs *)"
    ]
  }
}
```

将 `<skill-path>` 替换为实际的 skill 安装路径。`npx skills` 安装后路径通常为：
- 全局：`~/.claude/skills/sleuth/`
- 项目：`./.claude/skills/sleuth/`

### Chrome CDP 连接

Sleuth 使用独立的 managed browser（`~/.sleuth/cdp-profile/`），永不触碰用户日常 Chrome。

`check-deps.mjs` 处理 CDP 连接：

1. 协议级验证已有 CDP 端点（`/json/version` 返回有效 JSON 且含 `webSocketDebuggerUrl`）
2. 如无有效端点，自动启动 managed browser（动态选端口，优先 9222）
3. 输出 `SLEUTH_CDP_PORT=<port>` 供下游 agent-browser 使用
4. 连接后仍须验证目标站点是否处于登录态（CDP 连接 ≠ 站点登录成功）

首次使用需手动登录：

```bash
# 打开 managed browser 窗口，手动登录目标站点
node scripts/sleuth-browser.mjs open-login
```

登录态持久保存在 `~/.sleuth/cdp-profile/`，跨 session 复用直到站点过期。

如需手动启动：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir=$HOME/.sleuth/cdp-profile \
  --no-first-run \
  --no-default-browser-check &
```

---

## 核心设计

### 工具角色，而不是工具崇拜

| 工具/入口 | 适合做什么 | 不适合做什么 |
|-----------|------------|--------------|
| **WebSearch / Search APIs** | 建立来源地图、发现别名、快速扫候选页面 | 最终事实证明 |
| **WebFetch / readers** | 快速读取静态正文、降低 token 成本 | 判断真实布局、交互、登录态、动态行为 |
| **agent-browser** | 验证一手页面、读取 DOM、处理登录/交互/动态内容 | 大范围无差别扫网页 |
| **本地历史 / 书签 / site-patterns** | 找用户曾访问或搜索引擎不易发现的入口 | 替代事实验证 |

### 响应层级

Sleuth 不要求每个任务都跑复杂流程。先用最轻的路径拿到足够证据，不够再升级。

| 层级 | 何时使用 | 常见动作 |
|------|----------|----------|
| **直答** | 已有知识足够、且无明显时效风险 | 直接回复 |
| **快速验证** | 一个权威页面就能确认 | 侦察 + 原始来源验证 |
| **定向研究** | 需要多步查证，但问题仍然聚焦 | 混合搜索、速读、浏览器验证 |
| **深度研究** | 多源交叉、存在冲突、交付物明确 | 建来源地图、必要时并行子 Agent、最后写一份完整报告 |

### 共享搜索判断

主 Agent 和子 Agent 共用 `references/search-guide.md`。核心不是固定顺序，而是一组判断动作：

- 写清目标和 enough 条件。
- 先想来源拓扑，再想关键词。
- 选择当前最可能高产出的入口开局。
- 根据页面反馈改词、改源、改路径。
- 主动怀疑摘要、旧数据、单一来源和错误实体。
- 关键结论必须回到原始来源，并标时间与可信度。
- 目标满足就停；缺口重要才继续。

### 浏览器执行姿势

- **DOM / eval 优先**：需要观察或提取时，先直接读 DOM、文本、结构化数据。
- **snapshot / @ref 用于交互**：需要点、填、选、切页时再拿交互快照。
- **截图只在视觉证据重要时使用**：例如布局、图表、状态异常、视觉差异。
- **tab / session / network / state 按需使用**：比较多个页面、追 API、复用登录态、保留浏览状态时再上这些原语。
- **并行用独立 session**：不同域名或独立子问题用不同 browser session；同一账号后台或可能产生状态变更的流程不并行乱点。

### 深度研究交付

- 对昂贵或易丢失的发现及时 `deliver save`。
- `recall` 只返回历史 artifact 路径；历史内容是线索，不会自动复制到新 session，也不能替代当前验证。
- 独立角度才并行子 Agent；不要为了"看起来完整"而拆探针。
- 审查是为了质疑证据是否够，不是为了过仪式。
- 最终默认在用户当前工作目录交付 **一份** 连贯报告；内部碎片文件只是工作记忆，不是最终产品。
- `~/.sleuth/output/` 只保存中间 artifact 和可召回材料；`deliver merge` 只合并中间 Markdown，方便模型阅读整理，不是最终报告生成器。

### 站点经验系统

站点经验存放在 `~/.sleuth/site-patterns/`：

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

操作前可通过 `match-site.mjs` 读取经验，操作后 `update-site-stats.mjs` 更新统计。

---

## 安全性与自学习

### 安全原则

- **不提取 cookie、密码等敏感凭据**
- **不执行会产生记录的状态变更操作，除非用户明确要求**
- **不绕过付费墙，不对敏感页面截图**
- **所有浏览器操作都在本地 Chrome 中进行，用户可见**

### 自学习

- **会话日志**：任务中的渠道选择、域名访问、成功/失败记录到 `~/.sleuth/sessions/`
- **域名可信度评分**：基于历史数据计算 Bayesian 可信度分 `(success+1)/(visits+2)`
- **站点经验沉淀**：对触发 CAPTCHA / 登录墙 / 付费墙的站点记录经验

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
| 不把搜索 API 当作最终真相 | 检索层适合发现，不适合判案 |
| 不把浏览器步骤写死成唯一工作流 | 研究质量来自判断，不来自仪式 |
| 不自己管理另一套浏览器自动化栈 | agent-browser 已提供执行层 |
