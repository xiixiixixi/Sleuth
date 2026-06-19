# scripts/

CLI 工具集。agent 通过 SKILL.md 调用这些脚本完成环境检查、子 Agent 派发、本地 URL 检索。

## STRUCTURE

```
scripts/
├── check-deps.mjs          薄 CLI shim（64 行）→ lib/check-deps-core.mjs
├── spawn-subagent.mjs      子 Agent prompt 生成器（75 行，单体无 lib）
├── find-url.mjs            本地 Chrome 书签/历史检索（341 行，单体无 lib，未测试）
├── extract-subtitles.sh    YouTube 字幕抓取（bash + yt-dlp）
├── srt_to_transcript.py    SRT → transcript 转换（Python）
├── lib/
│   ├── check-deps-core.mjs  环境检查核心（134 行）
│   ├── browser-discovery.mjs DevToolsActivePort 发现 + ws:// URL 拼接（84 行）
│   └── output.mjs           ~/.sleuth/output/YYYY-MM-DD/ 解析（27 行）
└── __tests__/
    ├── browser-discovery.test.mjs  Unit 风格（直接 import）
    └── spawn-subagent.test.mjs     Integration 风格（execFileSync 子进程）
```

## WHERE TO LOOK

| 任务 | 位置 |
|------|------|
| 改环境检查流程 | `lib/check-deps-core.mjs#main`（也 alias 为 `ensureCDP`） |
| 加新 CLI flag | `check-deps.mjs#parseArgv` + `KNOWN_FLAGS` + `VALUE_FLAGS` 三个常量 |
| 改浏览器发现逻辑 | `lib/browser-discovery.mjs#getWebSocketUrl` |
| 改输出目录路径 | `lib/output.mjs#resolveOutputDir`（只按日期，不按 session） |
| 改子 Agent prompt 模板 | `spawn-subagent.mjs` 里 `contract` 模板字符串（约 L40-75） |
| 改本地 URL 搜索 | `find-url.mjs`（单体，无 lib 拆分） |

## CONVENTIONS

- **3 个独立 CLI 入口**：`check-deps` / `spawn-subagent` / `find-url`，互不依赖
- **`lib/` 只服务 `check-deps.mjs`**：`spawn-subagent.mjs` 和 `find-url.mjs` 是单体脚本，不共享 lib
- **3 套参数解析风格**（tech debt）：
  - `check-deps.mjs`：手撸 flag 解析（`parseArgv` 函数 + `KNOWN_FLAGS` / `VALUE_FLAGS` Set）
  - `spawn-subagent.mjs`：用 `node:util/parseArgs`
  - `find-url.mjs`：手撸位置参数
- **错误退出码**：`process.exit(1)` = 环境错误；`process.exit(2)` = 参数错误
- **子进程错误捕获**：测试里用 `assert.throws(() => execFileSync(...))` 检测非零退出

## ANTI-PATTERNS

- **不要再加 session/deliver/research-index 系统**：已全部砍掉（见根 AGENTS.md）
- **不要在 `lib/` 加新的"模式常量"**：曾经有 `BROWSER_MODE_APPLESCRIPT` / `BROWSER_MODE_MANAGED` / `BROWSER_MODE_APPROVAL`，砍到只剩 approval 一种后所有模式常量都删了
- **`check-deps-core.mjs` 不再支持 managed browser**：toggle 没开就报错，不自起 Chrome
- **`spawn-subagent.mjs` 输出的 prompt 里禁止预先替换 `${CLAUDE_SKILL_DIR}`**：必须字面量输出，子 Agent 自己展开
- **`find-url.mjs` 必须复制 History SQLite 到 /tmp 再查**：Chrome 运行时锁数据库，直接 open 会失败（参见 `find-url.mjs` 的 `copyFile` + `finally` 清理）
- **WebKit 时间戳转换**：Chrome history 用微秒（1601 起算），公式 `unix = (webkit_us - 11644473600000000) / 1000000`
- **禁止删除 `spawn-subagent.test.mjs` 里的 `doesNotMatch` 断言**：这些是防止 session 系统回潮的回归测试

## NOTES

- **`lib/check-deps-core.mjs:128-134` 有死 re-export**：`main as ensureCDP` 是旧名遗留（早先 ensureCDP 是主函数名），`resolveOutputDir`/`ensureOutputDir` 在 core 之外没消费者——可以删但保留向后兼容
- **`find-url.mjs` 是 scripts/ 下最大文件（341 行）且 0 测试**：跨平台路径、SQLite 查询、WebKit 时间戳——任何修改都要手动验证
- **`check-deps.mjs` 的 ROOT 路径写死**：`lib/check-deps-core.mjs:17` `const ROOT = path.resolve(path.dirname(__filename), '../..')` 假定布局永不变
- **agent-browser 0.27.1 bug**：`--cdp "ws://..."` 有 HTTP 预检 403，必须 0.28+；`tool-guide.md` 已写明
- **`extract-subtitles.sh` 和 `srt_to_transcript.py` 是辅助工具**：混语言存在，没有 README 解释何时用哪个——SKILL.md / references/ 里也几乎没引用
