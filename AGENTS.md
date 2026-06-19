# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-19
**Commit:** b1f2f66
**Branch:** main

## OVERVIEW

sleuth 是 AI Agent 的网络研究判断层 skill——教 agent 在 WebSearch / WebFetch / 浏览器之间做正确选择，对证据保持合理怀疑。不是搜索工具，是判断层。纯 Node.js ESM，零 npm 依赖，通过 `npx skills add xiixiixixi/Sleuth` 分发。

## STRUCTURE

```
sleuth/
├── SKILL.md            概念入口；agent 触发后由 skills 系统自动加载
├── README.md           安装与安全边界
├── LICENSE             MIT
├── references/         agent 按需读的展开文档（4 份，见 references/AGENTS.md）
├── scripts/            CLI 工具（见 scripts/AGENTS.md）
│   ├── lib/
│   └── __tests__/
├── docs/               # gitignored —— 本地决策/测试文档，不入仓
└── test/               # gitignored —— 本地测试残留
```

## WHERE TO LOOK

| 任务 | 位置 | 备注 |
|------|------|------|
| 改 skill 行为规则 | `SKILL.md` | 这是 agent 读的主入口，所有硬规则的根 |
| 加搜索策略 | `references/search-guide.md` | 单次搜索方法论（必搜/必不搜/query 改写） |
| 加深度研究流程 | `references/deep-research.md` | 5 阶段工作流（clarify→plan→research→compress→synthesize） |
| 加多 Agent 协同 | `references/multi-agent.md` | supervisor-researcher 角色分工 |
| 改浏览器命令参考 | `references/tool-guide.md` | agent-browser CLI 用法 |
| 改环境检查 | `scripts/check-deps.mjs` + `scripts/lib/check-deps-core.mjs` | 薄 shim + 核心逻辑 |
| 改子 Agent prompt 模板 | `scripts/spawn-subagent.mjs` | 单文件，无 lib 依赖 |
| 改本地 URL 搜索 | `scripts/find-url.mjs` | 341 行单体脚本（注意：未测试） |
| 加测试 | `scripts/__tests__/<name>.test.mjs` | 用 `node:test`，不要 jest/vitest |
| 设计决策追溯 | `docs/DECISION.md` | gitignored 本地，记录否决方案 |

## CONVENTIONS

### 模块与代码

- **ESM only**：`import` 全部带 `'node:'` 协议头；无 `require`、无 CommonJS
- **Node ≥ 18**：README 声明，用 `node:util/parseArgs`、`node:test`、`fs.mkdirSync({ recursive: true })`
- **零 npm 依赖**：`find . -name package.json` 应该空；scripts/ 全用 `node:*` 内建
- **薄 shim 模式**：CLI 在 `scripts/<name>.mjs`，核心逻辑在 `scripts/lib/<name>-core.mjs`（参考 `check-deps.mjs` 64 行 + `lib/check-deps-core.mjs` 134 行）
- **路径解析**：`fileURLToPath(import.meta.url)` 不要 `__dirname`（ESM 没有它）
- **CLI shebang**：`#!/usr/bin/env node` 在 `scripts/*.mjs` 顶部；`lib/*.mjs` 不加
- **错误处理**：`try { ... } catch { /* fallback */ }` 内联回退 + `console.error(msg)` + `process.exit(1|2)`
- **JSDoc 风格**：模块头用 `/** ... */`，中文注释为主

### 测试

- `node:test` + `node:assert`（**禁止引入 jest/vitest/mocha**）
- 跑测命令：`node --test scripts/__tests__/`
- 两种风格并存：
  - **Unit**（参考 `browser-discovery.test.mjs`）：`import { fn } from '../lib/...'` 直接调用
  - **Integration**（参考 `spawn-subagent.test.mjs`）：`execFileSync('node', [SCRIPT, ...args])` 子进程黑盒
- **必须显式断言不包含已废弃词**：当心 `--sid`、`session-logger`、`deliver`、`--main-sid`、`--role subagent`、`subagent_done` 不能再出现（session 系统已砍）

### 文档

- 中文硬规则用 **必须 / 绝不 / 不要 / 禁止 / 不允许**（不用英文 DO NOT/NEVER）
- 引用纪律：每个核心结论**必须内联 URL** `[结论](https://来源URL)`，单源最多 15 词直引，默认 paraphrase

## ANTI-PATTERNS (THIS PROJECT)

**已砍掉的系统（不要再引入）**：
- `session-logger.mjs` / session ID / start/log/finish 流程 → 已删，commit `0b16d8f`
- `deliver.mjs` / `registry.jsonl` / deliver save → 已删
- `research-index.mjs` / recall 索引 → 已删
- managed browser / fallback Chrome / `--ensure-login` → 已删，commit `bf10414`
- AppleScript bridge / `applescript-bridge.mjs` → 已删，commit `c54d49c`
- 子 Agent 自建 session / `--role subagent` / `subagent_done` 上报 → 已删
- `cleanup-output.mjs` / `validate.mjs` / `auth-verify.mjs` → 已删

**禁止行为**：
- 自起 Chrome（**只走 approval mode**，chrome://inspect toggle，没开就报错）
- 用 `--profile`（与 `--cdp` 互斥）
- 在 `--cdp` 同时传 `ws://` URL（agent-browser 0.27 有 403 bug，必须 0.28+）
- 替用户按状态变更按钮（CHECKPOINT 硬规则）
- 绕付费墙 / 提取 cookie / 对敏感页截图
- 把 WebSearch snippet 当一手事实
- 抹平子 Agent 之间的冲突（必须明示写出）
- 用 bullet list 重现原文章结构（版权问题）
- 派超过 6 个子 Agent（合成阶段爆炸）
- 在 SKILL.md / 代码 / 文档里提别的 skill 名字（如 web-access）——sisyphus 注释问题曾出现，commit `9096a05`

## UNIQUE STYLES

- **3 套参数解析风格并存**（**tech debt**，未统一）：`check-deps.mjs` 手撸 flag、`spawn-subagent.mjs` 用 `util.parseArgs`、`find-url.mjs` 手撸位置参数
- **`${CLAUDE_SKILL_DIR}` 硬绑定 Claude Code**：所有 SKILL.md 命令用此变量；README 宣称支持 50+ agent 但实际需要 Claude Code 兼容的 skill loader
- **`spawn-subagent.mjs` 输出的 prompt 里 `${CLAUDE_SKILL_DIR}` 必须字面量**：由子 Agent 自己展开，主 Agent 不能预先替换（`spawn-subagent.mjs:56` 注释明确）
- **output 目录按日期不按 session**：`~/.sleuth/output/YYYY-MM-DD/`（session 系统砍掉后改的，`lib/output.mjs:5` 注释）
- **`check-deps-core.mjs` 行 128-134 有死 re-export**：`main as ensureCDP` 是旧名遗留，`resolveOutputDir`/`ensureOutputDir` 在 core 之外没消费者

## COMMANDS

```bash
# 跑环境检查（agent 触发 sleuth 后第一件事）
node scripts/check-deps.mjs --check-only

# 跑全部测试
node --test scripts/__tests__/

# 生成子 Agent prompt 文本
node scripts/spawn-subagent.mjs --goal "验证 X 的定价" --must-verify "价格"

# 找本地浏览器历史/书签 URL
node scripts/find-url.mjs "关键词" --since 7d

# 升级 agent-browser（注意必须 ≥ 0.28，0.27 有 ws:// 403 bug）
npm i -g agent-browser@latest
```

## NOTES

- **`docs/TESTING.md` 撒谎**：引用了 `finish-gate.test.mjs` 和"23 条测试"，**该文件不存在**（session 系统砍时一起删了）。要么删这段引用，要么补 test
- **README 目录树与实际脱节**：README 只提 `tool-guide.md` + `search-guide.md`，实际有 4 份 references（多了 `deep-research.md`、`multi-agent.md`）。`scripts/lib/` 和 `scripts/__tests__/` 也未列出
- **测试覆盖盲区**：`find-url.mjs`（341 行）、`check-deps.mjs`、`check-deps-core.mjs`、`output.mjs` 都 0 测试
- **agent-browser 版本敏感**：0.27.1 的 `--cdp <ws-url>` 有 HTTP 预检 403 bug，必须 0.28+
- **chrome://inspect toggle 不持久**：Chrome 重启会重置，用户需重新勾选
- **`extract-subtitles.sh` + `srt_to_transcript.py`** 在 `scripts/` 下，混语言（Node + Bash + Python），无 README 解释边界
