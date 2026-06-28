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
├── references/         agent 按需读的展开文档（4 份：search.md / boundary.md / review.md / tool-guide.md，见 references/AGENTS.md）
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
| 加搜索策略 / 查询规则 / 多模态提取 / 搜索循环 | `references/search.md` | 搜索子 Agent |
| 加边界评估规则 | `references/boundary.md` | 边界子 Agent |
| 加审查 Agent 规则 | `references/review.md` | 审查子 Agent |
| 合成 / 证据分层 / 交付 | `SKILL.md` §7 | 主 Agent |
| 改子 Agent 角色 / 任务分析 / loop / 长程任务行为 | `SKILL.md` 第 1-2 步（任务分析）+ 第 3-7 步（主 Agent loop：搜索/边界/审查）+「状态文件 schema」+「长程任务行为」段 | 4 角色（主/搜索/边界/审查）+ state schema + 零交互 / 就绪即执行 |
| 改 agent-browser 命令参考 / 反爬降级 / 特殊内容类型 | `references/tool-guide.md` | 完整命令速查 |
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
- **薄 shim 模式**：CLI 在 `scripts/<name>.mjs`，核心逻辑在 `scripts/lib/<name>-core.mjs`（参考 `check-deps.mjs` 86 行 + `lib/check-deps-core.mjs` 133 行）
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
- **SKILL.md 全部用相对路径**：`scripts/check-deps.mjs`、`references/search.md`——所有路径从 SKILL.md 所在目录（skill 根目录）解析。Agent 正在读这份文档就知道根目录在哪。子 Agent 的 prompt 由 `spawn-subagent.mjs` 在运行时解析为绝对路径。
- **`spawn-subagent.mjs` 在 Node.js 运行时自感知 skill 根目录**：通过 `import.meta.url` 解析绝对路径，将 `${CLAUDE_SKILL_DIR}` 替换为绝对路径后输出——消除子 Agent 对运行时变量替换的依赖
- **output 目录按 task-name 不按日期**：`~/.sleuth/output/<task-name>/`（多 Agent 协作需独立 task 目录；旧 `lib/output.mjs` 按日期，与新 loop 模式不兼容——见 SKILL.md「状态文件 schema」）
- **`check-deps-core.mjs` 行 128-134 有死 re-export**：`main as ensureCDP` 是旧名遗留；`resolveOutputDir`/`ensureOutputDir` 现在在 core 内部被消费（行 94-100），外部 CLI 不直接 import output.mjs
- **`output.mjs` task-name 模式（2026-06-19）**：`resolveOutputDir(taskName?)` 支持两种模式——传 taskName 则按 `~/.sleuth/output/<task-name>/`（多 Agent 协作需独立 task 目录），不传则按 `YYYY-MM-DD/`（向后兼容）。`sanitizeTaskName` 拒路径分隔符 / `..` / 特殊字符（只允许 `[a-zA-Z0-9-_.]`），防注入。空字符串视为「已传入但非法」会抛错（`if (taskName !== undefined)` 不是 truthy 检查）。check-deps CLI 通过 `--task-name <name>` 传入。
- **`spawn-subagent.mjs` 的 4 role 模板**：`scout`（侦察，广度扫描）/ `search`（搜索执行，默认）/ `boundary`（边界评估，列未覆盖维度）/ `review`（证据链审计）。四个 builder 函数 `buildScoutContract` / `buildSearchContract` / `buildBoundaryContract` / `buildReviewContract` 分别生成不同 prompt。返回格式：scout→landscape.json；search→JSONL（findings/gaps/red_flags/dimensions_seen）；boundary→YAML（terminate_recommended + uncovered_dimensions + ...）；review→YAML（critical/non_critical + sampled_stats）。

## COMMANDS

```bash
# 跑环境检查（agent 触发 sleuth 后第一件事）
node scripts/check-deps.mjs --check-only

# 跑全部测试
node --test scripts/__tests__/

# 生成子 Agent prompt 文本
# 生成子 Agent prompt 文本（默认 search role）
node scripts/spawn-subagent.mjs --goal "验证 X 的定价" --must-verify "价格" --deliverable "定价对比表" --stop-criteria "至少 3 个独立源"

# 生成边界 Agent prompt
node scripts/spawn-subagent.mjs --role boundary --goal "评估覆盖度" --task-dir ~/.sleuth/output/<task-name>/

# 生成审查 Agent prompt
node scripts/spawn-subagent.mjs --role review --goal "审计证据链" --task-dir ~/.sleuth/output/<task-name>/ --draft-path ~/.sleuth/output/<task-name>/draft.md

# 找本地浏览器历史/书签 URL
node scripts/find-url.mjs "关键词" --since 7d

# 升级 agent-browser（注意必须 ≥ 0.28，0.27 有 ws:// 403 bug）
npm i -g agent-browser@latest
```

## NOTES

- **`docs/TESTING.md` 已重写（2026-06-23）**：旧版引用已删的 `finish-gate.test.mjs` / session-logger / deliver 系统；新版按当前架构重写（53 条自动化测试 + 手动 skill 行为测试清单 C1-C16 + 覆盖盲区 + 已知问题）
- **docs/DECISION.md 与 RESEARCH_AUDIT.md 未在 WHERE TO LOOK 列出**：DECISION 是否决方案追溯，RESEARCH_AUDIT 是 2026-06-19 references 重构的依据文档（5 份→ 3 份的 audit）。两者都是 gitignored 本地文档。
- **测试覆盖盲区**：`find-url.mjs`（341 行）、`check-deps.mjs`、`check-deps-core.mjs`、`output.mjs` 都 0 测试
- **agent-browser 版本敏感**：0.27.1 的 `--cdp <ws-url>` 有 HTTP 预检 403 bug，必须 0.28+
- **chrome://inspect toggle 不持久**：Chrome 重启会重置，用户需重新勾选
- **`extract-subtitles.sh` + `srt_to_transcript.py`** 在 `scripts/` 下，混语言（Node + Bash + Python），无 README 解释边界
