# scripts/

CLI 工具集。agent 通过 SKILL.md 调用这些脚本完成环境检查、子 Agent 派发、本地 URL 检索。

## STRUCTURE

```
scripts/
├── check-deps.mjs          薄 CLI shim（~78 行）→ lib/check-deps-core.mjs；支持 --task-name
├── spawn-subagent.mjs      子 Agent prompt 生成器（5 种 role：scout/search/boundary/review/synthesize；search 直写 raw/）
├── normalize.mjs           归一化器（v2 核心）：raw/*.jsonl → findings.jsonl + stats-summary.json；14 条测试
├── calc-novelty.mjs        反认知循环计算器：读 findings.jsonl → novelty_ratio + stale_count → 更新 progress.json
├── validate-state.mjs      检查门：7 个 phase 验证（1.5/2/3-raw/3-findings/4/7-pre/7-post）；不通过 exit(1)
├── find-url.mjs            本地 Chrome 书签/历史检索（341 行，单体无 lib，未测试）
├── fix-chrome-debug-permission.mjs  Chrome 144+ 远程调试弹窗修复（跨平台装 RemoteDebuggingAllowed 策略）
├── extract-subtitles.sh    YouTube 字幕抓取（bash + yt-dlp）
├── srt_to_transcript.py    SRT → transcript 转换（Python）
├── lib/
│   ├── check-deps-core.mjs  环境检查核心（~134 行）
│   ├── browser-discovery.mjs DevToolsActivePort 发现 + ws:// URL 拼接（84 行）
│   └── output.mjs           ~/.sleuth/output/<task-name>/ 或 YYYY-MM-DD/ 解析（63 行，带 sanitizeTaskName）
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
| 改环境检查流程 | `lib/check-deps-core.mjs#main`（也 alias 为 `ensureCDP`） |
| 加新 CLI flag | `check-deps.mjs#parseArgv` + `KNOWN_FLAGS` + `VALUE_FLAGS`（VALUE_FLAGS 当前只有 `--task-name`） |
| 改浏览器发现逻辑 | `lib/browser-discovery.mjs#getWebSocketUrl` |
| 改输出目录路径 | `lib/output.mjs#resolveOutputDir`（taskName 优先 → `<task-name>/`；否则按日期）+ `sanitizeTaskName`（拒路径注入） |
| 改子 Agent prompt 模板 | `spawn-subagent.mjs#buildSearchContract` / `buildBoundaryContract` / `buildReviewContract` 三个函数 |
| 改本地 URL 搜索 | `find-url.mjs`（单体，无 lib 拆分） |

## CONVENTIONS

- **7 个独立 CLI 入口**：`check-deps` / `spawn-subagent` / `normalize` / `calc-novelty` / `validate-state` / `find-url` / `fix-chrome-debug-permission`，互不依赖
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

- **`lib/check-deps-core.mjs:128-134` 有死 re-export**：`main as ensureCDP` 是旧名遗留（早先 ensureCDP 是主函数名），`resolveOutputDir`/`ensureOutputDir` 现在在 core 内部被消费（行 94-100），外部 CLI 不直接 import output.mjs
- **`find-url.mjs` 是 scripts/ 下最大文件（341 行）且 0 测试**：跨平台路径、SQLite 查询、WebKit 时间戳——任何修改都要手动验证
- **`check-deps.mjs` 的 ROOT 路径写死**：`lib/check-deps-core.mjs:17` `const ROOT = path.resolve(path.dirname(__filename), '../..')` 假定布局永不变
- **agent-browser 0.27.1 bug**：`--cdp "ws://..."` 有 HTTP 预检 403，必须 0.28+；`tool-guide.md` 已写明
- **`extract-subtitles.sh` 和 `srt_to_transcript.py` 是辅助工具**：混语言存在，没有 README 解释何时用哪个——SKILL.md / references/ 里也几乎没引用
- **`output.mjs` 的 task-name 模式（2026-06-19）**：默认行为不变（按 YYYY-MM-DD，向后兼容）；`--task-name <name>` 模式按任务名创建子目录，用于多 Agent 协作的独立 task 目录。`sanitizeTaskName` 拒绝路径分隔符 / `..` / 特殊字符（只允许 `[a-zA-Z0-9-_.]`），防注入。空字符串视为"已传入但非法"会抛错（`if (taskName !== undefined)` 而不是 truthy 检查）。
- **`spawn-subagent.mjs` 的 5 role 模板**：`scout`（侦察，广度扫描）/ `search`（搜索执行，默认）/ `boundary`（边界评估）/ `review`（证据链审计）/ `synthesize`（合成，写 draft.md）。子 Agent 不读 SKILL.md——prompt 内联安全边界 + 指定要读的 references/X.md（synthesize 例外：合成规则内联在 prompt 模板里，不读 references）。返回格式：scout→landscape.json；search→JSONL（findings/gaps/red_flags/dimensions_seen）；boundary→YAML（terminate_recommended + uncovered_subquestions + uncovered_dimensions + ...）；review→YAML（critical/non_critical + sampled_stats）；synthesize→Markdown（draft.md，直写）。
- **`spawn-subagent.mjs` 6 个新参数**：`--role`、`--deliverable`、`--stop-criteria`、`--task-dir`（boundary/review/synthesize 必填）、`--draft-path`（review 必填）、`--audit-fix`（synthesize 可选，审计后重派改 draft 时传）。原 4 个（goal/must-verify/known-clue/help）保留。
