# Sleuth

让 AI Agent 在做网络研究时知道该信任什么、怀疑什么、什么时候该亲自去看。

## 解决什么问题

AI Agent 能搜索、能读网页、能操控浏览器，但大多数时候它分不清：

- 搜索摘要和原始来源有什么区别
- reader 抓回来的内容是不是页面真实状态
- 什么时候该用浏览器亲自验证，什么时候搜索就够了

Sleuth 不是又一个搜索工具或浏览器自动化框架。它是一套判断层——帮 Agent 在不同工具之间做出正确的选择，并对拿到的证据保持合理的怀疑。

## 怎么工作

Sleuth 根据任务复杂度分四个层级：

| 层级 | 什么时候用 | 做什么 |
|------|-----------|--------|
| 直答 | Agent 已有知识足够 | 直接回答 |
| 快速验证 | 一两个来源就能确认 | 搜索 + 验证 |
| 定向研究 | 需要多步查证但问题集中 | 混合使用工具，按需升级 |
| 深度研究 | 多源冲突、需要完整报告 | 启动研究 session、派子 Agent 并行调查 |

核心原则：**从最轻的工具开始，证据不够再升级。**

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
| **Chrome** | 驱动一个独立的持久浏览器 profile（与日常 Chrome 隔离；需登录的站点用 `--ensure-login` 登一次即可） |

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

Sleuth **不会复制你的日常 Chrome profile**。它维护一个**独立的持久浏览器 profile**（`~/.sleuth/cdp-profile`），并以远程调试端口启动一个 Chrome，让 agent-browser 通过 `--cdp <port>` 连上去。

- 这个 profile 与你日常用的 Chrome 完全隔离，互不影响。
- 需要登录态的站点：跑一次 `node scripts/check-deps.mjs --ensure-login <url>`，在弹出的窗口登录一次，cookie 会**长期保存在该 profile**，之后所有研究会话共享，无需重复登录。
- 它不是每次复制、也不是一次性快照，而是**建一次、持续复用、自我累积**的真实 profile。

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
│   ├── tool-guide.md           浏览器命令参考
│   ├── search-guide.md         搜索策略
│   └── subagent-guide.md       子 Agent 合同
├── scripts/                    辅助脚本
├── LICENSE
└── README.md
```

## License

MIT
