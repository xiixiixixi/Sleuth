# Sleuth

让 AI Agent 在做网络研究时知道该信任什么、怀疑什么、什么时候该亲自去看。

## 解决什么问题

AI Agent 能搜索、能读网页、能操控浏览器，但大多数时候它分不清：

- 搜索摘要和原始来源有什么区别
- reader 抓回来的内容是不是页面真实状态
- 什么时候该用浏览器亲自验证，什么时候搜索就够了

Sleuth 不是又一个搜索工具或浏览器自动化框架。它是一套判断层——帮 Agent 在不同工具之间做出正确的选择，并对拿到的证据保持合理的怀疑。

## 怎么工作

Sleuth 根据任务复杂度分两条路径：

| 路径 | 什么时候用 | 做什么 |
|------|-----------|--------|
| 轻任务 | 1-2 次搜索能答完 | 直接答 + 必要时一次 WebFetch 验证一手来源 |
| 并行调研 | 深度报告 / 多源交叉 / 多个独立子主题 / 跨多日 | 主 Agent 调度，派侦察/搜索/边界/审查 4 种子 Agent，状态写文件 |

所有路径都遵循工具升级原则：**从最轻的工具开始，证据不够再升级。**

- 找不到入口 → 先搜索
- 知道在哪但没读内容 → 先用 reader
- reader 结果不确定是不是真的 → 用浏览器验证原始页面
- 需要登录态、动态交互 → 只能用浏览器

所有研究结论区分可信度：已验证事实 > 高置信推断 > 未确认线索 > 冲突信息 > 覆盖缺口。

## 安装

### 前置依赖

| 依赖 | 用途 |
|------|------|
| **Node.js >= 18** | 运行辅助脚本 |
| **agent-browser** | 浏览器操作 CLI，`npm i -g agent-browser && agent-browser install` |
| **Chrome** | Chrome 144+（chrome://inspect/#remote-debugging 勾选 toggle） |

可选：**sqlite3**（Chrome 历史搜索）、**yt-dlp**（YouTube 字幕）。

### 安装 skill

```bash
# 安装到当前项目（支持 Claude Code、Codex、Gemini CLI 等 50+ Agent）
npx skills add xiixiixixi/Sleuth

# 全局安装
npx skills add xiixiixixi/Sleuth -g

# 只安装到指定 Agent
npx skills add xiixiixixi/Sleuth -a claude-code
```

安装后 sleuth 会自动注册。Agent 收到搜索、浏览、验证类任务时会自动加载。

更新：

```bash
npx skills update sleuth
```

### Chrome 连接

- **Approval mode（全平台）**：连你的日常 Chrome，天然带登录态。一次性操作：`chrome://inspect/#remote-debugging` 勾选 toggle。每次新连接 Chrome 弹窗点 Allow。没开 toggle 就报错，sleuth 不自起 Chrome。

check-deps 检查环境，输出端口和连接变量。

## 安全

- 不提取 cookie、密码或任何敏感凭据
- 不绕过付费墙
- 不对敏感页面截图
- 不执行会产生记录的操作（如提交表单），除非你明确要求
- 所有浏览器操作在你的本地 Chrome 中进行，你始终可见

## 目录结构

```
├── SKILL.md                    主 skill 文件
├── references/
│   ├── scout.md             侦察执行（广度扫描策略 / landscape.json 返回格式）
│   ├── search.md            搜索执行（查询 / 工具 / 失败 / 循环 / JSONL 返回）
│   ├── boundary.md          边界评估（4 固定维度 / terminate_recommended / 输出 schema）
│   ├── review.md            证据链审计（4 项审计 / 分层抽样 / Tier 分级 / 输出 schema）
│   └── tool-guide.md        agent-browser 命令速查 / 反爬降级 / 特殊内容
├── scripts/                    CLI 工具（环境检查 / 子 Agent prompt / 本地 URL 搜索）
│   ├── check-deps.mjs       环境检查
│   ├── spawn-subagent.mjs   子 Agent prompt 生成
│   ├── find-url.mjs         本地 Chrome 历史/书签搜索
│   └── lib/                 核心逻辑（环境检查 / 浏览器发现 / 输出目录）
├── LICENSE
└── README.md
```

## License

MIT
