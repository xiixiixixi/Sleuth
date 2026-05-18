# Sleuth — 梦里寻

Agent skill，把联网研究从“会搜会点”提升到“会判断、会验证、会停止”。

Sleuth 不是万能爬虫，也不是固定 intent-router。它的核心定位是：

> 搜索判断内核 + 工具边界识别 + 浏览器验证升级机制 + 研究交付约定。

`agent-browser` 负责浏览器执行；Sleuth 负责判断什么时候该搜索、fetch、使用专用工具、请求用户补充材料，或升级到浏览器验证。

---

## 为什么做这个

搜索引擎、网站、社区和内部系统大多是给人类设计的，不是给大模型设计的。Agent 必须知道：

- 搜索摘要只能做线索，不等于事实。
- reader 适合公开静态正文，不保证动态页面和登录态。
- 浏览器是最高保真的页面验证层，但成本高，不该默认使用。
- 专用连接器、MCP、本地历史、用户截图和私有材料都有各自边界。
- 有些渠道只有人类能获取，Agent 应请求用户提供原料，而不是伪造结论。

---

## 核心原则

| 原则 | 含义 |
|---|---|
| 先判断问题，再选择工具 | 不先套关键词，不先默认开浏览器 |
| 先识别来源，再设计 query | 来源拓扑优先于搜索词 |
| 搜索发现不等于事实证明 | 核心结论必须回到原始来源 |
| 浏览器是验证层，不是默认入口 | 动态、登录态、站内搜索、真实交互时再升级 |
| site-patterns 是经验缓存 | 不把它发展成大型 selector 数据库 |
| 不做固定 intent-router | 用搜索哲学和决策问题控制 Agent 自主判断 |
| 不确定性必须显式表达 | 区分事实、观点、推断、线索、缺口 |

---

## 目录结构

```text
sleuth/
├── SKILL.md
├── README.md
├── package.json
├── docs/
│   └── browser-auth-and-channel-intelligence-plan.md
├── references/
│   ├── decision-kernel.md
│   ├── tool-boundary.md
│   ├── search-guide.md
│   ├── subagent-guide.md
│   ├── tool-guide.md
│   ├── content-extraction.md
│   └── site-patterns/.gitkeep
├── scripts/
│   ├── check-deps.mjs
│   ├── sleuth-browser.mjs
│   ├── session-logger.mjs
│   ├── deliver.mjs
│   ├── research-index.mjs
│   ├── find-url.mjs
│   ├── match-site.mjs
│   ├── route-task.mjs
│   └── lib/
└── tests/
    ├── repo-consistency.test.mjs
    └── site-search.test.mjs
```

---

## 运行时参考

| 文件 | 作用 |
|---|---|
| `references/decision-kernel.md` | 搜索决策内核，不是 intent-router |
| `references/tool-boundary.md` | 运行时工具盘点与证据边界 |
| `references/search-guide.md` | 目标、来源拓扑、观察、怀疑、换路、证据、停止 |
| `references/tool-guide.md` | agent-browser 命令与浏览器执行姿势 |
| `references/subagent-guide.md` | 深度研究中的子 Agent 合同 |
| `references/content-extraction.md` | PDF、图片、视频、音频、字幕等提取策略 |

---

## 前置依赖

| 依赖 | 用途 |
|---|---|
| Node.js >= 22 | 运行辅助脚本；需要原生 WebSocket |
| agent-browser | 浏览器 CDP 执行层 |
| Chrome / Chromium | managed browser 基础 |
| sqlite3 | Chrome 历史/书签搜索，可选 |
| yt-dlp | 视频字幕提取，可选 |
| Python 3 | SRT/VTT 字幕清洗，可选 |

安装 agent-browser：

```bash
npm i -g agent-browser
agent-browser install
```

---

## 安装 Skill

```bash
npx skills add xiixiixixi/Sleuth -g
npx skills add xiixiixixi/Sleuth
```

手动 clone：

```bash
git clone https://github.com/xiixiixixi/Sleuth.git ~/.agents/skills/sleuth
```

---

## 浏览器验证

Sleuth 默认使用 managed browser：`~/.sleuth/cdp-profile/`。它是独立 Chrome profile，不触碰用户日常 Chrome。

```bash
node scripts/check-deps.mjs --ensure-cdp
```

所有浏览器动作由 agent-browser 执行，Sleuth 只决定是否需要升级到浏览器验证。

重要：CDP 连接成功不等于站点登录成功。只有页面级验证才算数。

---

## 响应层级

| 层级 | 适用场景 | 常见做法 |
|---|---|---|
| 直答 | 稳定常识、无需当前事实 | 直接回答 |
| 快速验证 | 一两个权威来源可确认 | 搜索/reader/专用工具 + 原始来源 |
| 定向研究 | 需要多步查证但问题集中 | 多来源验证，必要时浏览器 |
| 深度研究 | 多源冲突、范围大、需要交付物 | session、子 Agent、证据账本、最终报告 |

---

## 脚本边界

Sleuth 的脚本只做辅助，不重写完整浏览器自动化框架。

重点脚本：

- 环境检查：`check-deps.mjs`
- 浏览器生命周期：`sleuth-browser.mjs`
- 会话日志：`session-logger.mjs`
- 交付物保存：`deliver.mjs`
- 历史召回：`research-index.mjs`
- 本地历史/书签入口：`find-url.mjs`

可选/实验：

- `route-task.mjs`
- `match-site.mjs`
- `update-site-stats.mjs`
- site-pattern search schema

这些只能作为经验辅助，不能替代 Agent 的判断。

---

## 测试

```bash
npm test
```

当前测试覆盖：

- 仓库一致性：文档和脚本引用是否存在
- Node 版本约束是否与原生 WebSocket 对齐
- site search 纯函数：URL 构造、路由判断、query 扩展
- 安全辅助：常见写操作识别

---

## 不做的事

| 不做 | 原因 |
|---|---|
| 不做固定 intent-router | 需要 Agent 自主判断，而不是套模板 |
| 不把 site-patterns 作为核心能力 | 维护成本高，selector 容易失效 |
| 不把浏览器作为默认入口 | 成本高，且多数静态权威页面不需要浏览器 |
| 不封装完整 CDP 框架 | agent-browser 已是执行层 |
| 不把搜索 API 当事实来源 | 检索层适合发现，不适合判案 |
