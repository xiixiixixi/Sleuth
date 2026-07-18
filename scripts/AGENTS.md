# scripts/

CLI 工具集。agent 通过 SKILL.md 调用这些脚本完成环境检查、子 Agent 派发、本地 URL 检索。

## STRUCTURE

```
scripts/
├── check-deps.mjs          薄 CLI shim（~78 行）→ lib/check-deps-core.mjs；支持 --task-name
├── spawn-subagent.mjs      子 Agent prompt 生成器（5 种 role：scout/search/boundary/review/synthesize；search 直写 raw/）
├── normalize.mjs           从全部 raw 确定性重建 findings.jsonl + stats-summary.json
├── check-depth.mjs         证据结构 + 7 种 task_type 的跨轮关系检查
├── classify-task.mjs       用户问题 → task_type 初判；无信号返回 general
├── calc-novelty.mjs        反认知循环计算器：读 findings.jsonl → novelty_ratio + stale_count → 更新 progress.json
├── validate-state.mjs      严格 JSON 检查门（1.5/2/3/4/7/8）
├── inject-hints.mjs        boundary hints → 下一轮 --known-clue
├── audit-run.mjs           对一个任务目录分阶段执行完整验收
├── find-url.mjs            本地 Chrome 书签/历史检索（341 行，单体无 lib，未测试）
├── fix-chrome-debug-permission.mjs  Chrome 144+ 远程调试弹窗修复（跨平台装 RemoteDebuggingAllowed 策略）
├── extract-subtitles.sh    YouTube 字幕抓取（bash + yt-dlp）
├── srt_to_transcript.py    SRT → transcript 转换（Python）
├── lib/
│   ├── check-deps-core.mjs  环境检查核心（~134 行）
│   ├── browser-discovery.mjs DevToolsActivePort 发现 + ws:// URL 拼接（84 行）
│   └── output.mjs           任务目录解析 + 创建 raw/ 和 screenshots/（带 sanitizeTaskName）
└── __tests__/
    ├── browser-discovery.test.mjs      Unit 风格（直接 import）
    ├── spawn-subagent.test.mjs         Integration 风格（5 种 role + 新参数 + synthesize 测试）
    ├── normalize.test.mjs              Integration 风格（14 条：归一化 + sentinel + stats-summary + parse 错误）
    ├── output.test.mjs                 Unit + Integration（task-name / 路径注入 / CLI flag）
    └── references-structure.test.mjs   防回潮：references/ + SKILL.md 结构
```

## WHERE TO LOOK

| 任务 | 位置 |
|------|------|
| 改环境检查流程 | `lib/check-deps-core.mjs#main` |
| 加新 CLI flag | `check-deps.mjs#parseArgv` + `KNOWN_FLAGS` + `VALUE_FLAGS`（当前 `--task-name` / `--mode`） |
| 改浏览器发现逻辑 | `lib/browser-discovery.mjs#getWebSocketUrl` |
| 改输出目录路径 | `lib/output.mjs#resolveOutputDir`（taskName 优先 → `<task-name>/`；否则按日期）+ `sanitizeTaskName`（拒路径注入） |
| 改子 Agent prompt 模板 | `spawn-subagent.mjs` 的 5 个 builder 函数 |
| 改本地 URL 搜索 | `find-url.mjs`（单体，无 lib 拆分） |

## CONVENTIONS

- 核心 CLI 各自可单独执行；`audit-run.mjs` 负责按固定顺序组合检查
- **`lib/` 只服务 `check-deps.mjs`**：`spawn-subagent.mjs` 和 `find-url.mjs` 是单体脚本，不共享 lib
- **3 套参数解析风格**（tech debt）：
  - `check-deps.mjs`：手撸 flag 解析（`parseArgv` 函数 + `KNOWN_FLAGS` boolean Set + `VALUE_FLAGS` value Set）
  - `spawn-subagent.mjs`：用 `node:util/parseArgs`
  - `find-url.mjs`：手撸位置参数
- **错误退出码**：`process.exit(1)` = 环境错误；`process.exit(2)` = 参数错误
- **子进程错误捕获**：测试里用 `assert.throws(() => execFileSync(...))` 检测非零退出

## ANTI-PATTERNS

- **不要再加 session/deliver/research-index 系统**：已全部砍掉（见根 AGENTS.md）
- **不要在 `lib/` 加新的"模式常量"**：曾经有 `BROWSER_MODE_APPLESCRIPT` / `BROWSER_MODE_MANAGED` / `BROWSER_MODE_APPROVAL`，砍到只剩 approval 一种后所有模式常量都删了
- **`check-deps-core.mjs` 不再支持 managed browser**：toggle 没开就报错，不自起 Chrome
- **`spawn-subagent.mjs` 通过 `import.meta.url` 自感知 skill 根目录**：在输出前将 `${CLAUDE_SKILL_DIR}` 替换为绝对路径——子 Agent 不依赖运行时变量
- **`find-url.mjs` 必须复制 History SQLite 到 /tmp 再查**：Chrome 运行时锁数据库，直接 open 会失败（参见 `find-url.mjs` 的 `copyFile` + `finally` 清理）
- **WebKit 时间戳转换**：Chrome history 用微秒（1601 起算），公式 `unix = (webkit_us - 11644473600000000) / 1000000`
- **禁止删除 `spawn-subagent.test.mjs` 里的 `doesNotMatch` 断言**：这些是防止 session 系统回潮的回归测试
- **`output.mjs` 的 sanitizeTaskName 只允许单层 task-name**：禁止含 `/` 的路径（防 traversal）。如果未来需要多层 task 目录（如 `project/sub-task`），需重新设计安全策略

## NOTES

- **`find-url.mjs` 的真实数据库路径仍需人工测**：参数与无数据路径可自动测，跨平台 SQLite/历史锁行为需真实 Chrome 环境
- **agent-browser 0.27.1 bug**：`--cdp "ws://..."` 有 HTTP 预检 403，必须 0.28+；`tool-guide.md` 已写明
- **`extract-subtitles.sh` 和 `srt_to_transcript.py` 是辅助工具**：混语言存在，没有 README 解释何时用哪个——SKILL.md / references/ 里也几乎没引用
- **`output.mjs` 的 task-name 模式（2026-06-19）**：默认行为不变（按 YYYY-MM-DD，向后兼容）；`--task-name <name>` 模式按任务名创建子目录，用于多 Agent 协作的独立 task 目录。`sanitizeTaskName` 拒绝路径分隔符 / `..` / 特殊字符（只允许 `[a-zA-Z0-9-_.]`），防注入。空字符串视为"已传入但非法"会抛错（`if (taskName !== undefined)` 而不是 truthy 检查）。
- **`spawn-subagent.mjs` 的 5 role 模板**：`scout` / `search` / `boundary` / `review` / `synthesize`。子 Agent 不读 SKILL.md。产出分别直写 landscape.json / raw JSONL / boundary-report.json / audit-report.json / draft.md；边界与审查使用可严格解析的 JSON。
- **search 必须绑定**：`--task-dir`、`--agent-name`、`--round`、`--subquestion-id`；视觉任务再传 `--visual-required`。这保证文件唯一、轮次和子问题归属可审计。
- **finding 与 red_flag 都必须有 `sources[]`**：前者支撑当前结论，后者支撑“为何排除旧版、冲突或不可靠来源”；`validate-state.mjs` 会同时检查。
