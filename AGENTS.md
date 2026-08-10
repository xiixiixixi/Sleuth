# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-18
**Commit:** 当前工作树（以 `git rev-parse HEAD` 为准）
**Branch:** main

## OVERVIEW

sleuth 是 AI Agent 的网络研究判断层 skill——教 agent 在 WebSearch / WebFetch / 浏览器之间做正确选择，对证据保持合理怀疑。不是搜索工具，是判断层。纯 Node.js ESM，零 npm 依赖，通过 `npx skills add xiixiixixi/Sleuth` 分发。

## STRUCTURE

```
sleuth/
├── SKILL.md            概念入口；agent 触发后由 skills 系统自动加载
├── README.md           安装与安全边界
├── LICENSE             MIT
├── references/         agent 按需读的展开文档（5 份：scout.md / search.md / boundary.md / review.md / tool-guide.md，见 references/AGENTS.md）
├── scripts/            CLI 工具（见 scripts/AGENTS.md）
│   ├── lib/
│   └── __tests__/
├── docs/               # 随仓维护的当前设计、问题、测试和状态文档；仅 docs/local/ 被忽略
└── test/               # gitignored —— 本地测试残留
```

> 注：`launch-chrome.mjs`（339 行）放在 `scripts/` 根，不在 `lib/`——它是用户调用的 Chrome 启动器，不是被 import 的库。

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
| 用户主动启动带 CDP 调试的 Chrome | `scripts/launch-chrome.mjs` | 仅用户明确选择并传 `--confirm-close-browser`；主流程禁止自动运行 |
| 检查或设置 Chrome 远程调试许可 | `scripts/fix-chrome-debug-permission.mjs` | 可选人工环境工具；不承诺免确认。macOS 改 Local State，Linux/Windows 设置策略；支持 `--check` / `--uninstall` |
| 改环境检查 | `scripts/check-deps.mjs` + `scripts/lib/check-deps-core.mjs` | 薄 shim + 核心逻辑 |
| 改子 Agent prompt 模板 | `scripts/spawn-subagent.mjs` | 单文件，无 lib 依赖；5 role：scout/search/boundary/review/synthesize |
| 改任务类型初判 | `scripts/classify-task.mjs` | 规则只处理明确措辞；无信号返回 general 给主 Agent 判断 |
| 改归一化器（raw/ → findings.jsonl + stats-summary.json） | `scripts/normalize.mjs` | v2 核心脚本；测试数量以实时命令为准 |
| 改反认知循环计算 | `scripts/calc-novelty.mjs` | 算 novelty_ratio + stale_count → 更新 progress.json |
| 改检查门 | `scripts/validate-state.mjs` | 7 个 phase 检查；不通过 exit(1) |
| 改本地 URL 搜索 | `scripts/find-url.mjs` | 341 行单体脚本（注意：未测试） |
| 加测试 | `scripts/__tests__/<name>.test.mjs` | 用 `node:test`，不要 jest/vitest |
| 当前架构与决策 | `docs/DESIGN-v3.md` + `docs/STATUS.md` | 只写当前事实；历史问题在 TEST-ISSUES.md |
| 测试步骤与检查命令 | `docs/TESTING.md` | 怎么测：case 要求 + 检查清单 |
| 测试问题追踪 | `docs/TEST-ISSUES.md` | 测出了什么：问题清单 + 解决状态 |

## CONVENTIONS

### 模块与代码

- **ESM only**：`import` 全部带 `'node:'` 协议头；无 `require`、无 CommonJS
- **基础流程 Node ≥ 18；浏览器兜底 Node ≥ 24**：`agent-browser` ≥ 0.28 的官方 `engines` 要求 Node.js ≥ 24。full 检查必须先验 Node 版本，再决定是否自动安装 CLI
- **零 npm 依赖**：`find . -name package.json` 应该空；scripts/ 全用 `node:*` 内建
- **薄 shim 模式**：CLI 在 `scripts/<name>.mjs`，核心逻辑在 `scripts/lib/<name>-core.mjs`（参考 `check-deps.mjs` 86 行 + `lib/check-deps-core.mjs` 133 行）
- **路径解析**：`fileURLToPath(import.meta.url)` 不要 `__dirname`（ESM 没有它）
- **CLI shebang**：`#!/usr/bin/env node` 在 `scripts/*.mjs` 顶部；`lib/*.mjs` 不加
- **错误处理**：`try { ... } catch { /* fallback */ }` 内联回退 + `console.error(msg)` + `process.exit(1|2)`
- **JSDoc 风格**：模块头用 `/** ... */`，中文注释为主

### 测试

- `node:test` + `node:assert`（**禁止引入 jest/vitest/mocha**）
- 跑测命令：`node --test scripts/__tests__/*.mjs`
- 两种风格并存：
  - **Unit**（参考 `browser-discovery.test.mjs`）：`import { fn } from '../lib/...'` 直接调用
  - **Integration**（参考 `spawn-subagent.test.mjs`）：`execFileSync('node', [SCRIPT, ...args])` 子进程黑盒
- **必须显式断言不包含已废弃词**：当心 `--sid`、`session-logger`、`deliver`、`--main-sid`、`--role subagent`、`subagent_done` 不能再出现（session 系统已砍）
- **视觉证据必须真实走完整链路**：默认逐页扫描已采用来源，`agent_done.visual_scan.pages[]` 留痕；有用图写 `visuals[]`；草稿全部内嵌，Review 逐张审查。测试必须覆盖漏扫、漏图、孤儿图和漏审。

### 文档

- 中文硬规则用 **必须 / 绝不 / 不要 / 禁止 / 不允许**（不用英文 DO NOT/NEVER）
- 引用纪律：每个核心结论**必须内联 URL** `[结论](https://来源URL)`，单源最多 15 词直引，默认 paraphrase

### 回复风格（用户不是技术背景，英文也不太好）

- **用大白话讲清楚**：用户看不懂技术术语。解释任何东西时,优先用日常类比或一句话白话,不要堆专业黑话。比如不要只说「走 CDP」,要说「通过调试端口让 agent 能指挥 Chrome 浏览器」。
- **英文术语必须括号标中文**：任何英文术语（代码标识符、产品名、缩写除外）第一次出现时,在后面加括号写中文意思。例：「profile（用户配置目录）」「fallback（兜底方案）」「snippet（搜索结果的摘要片段）」。**代码里的变量名/函数名/命令行 flag（如 `check-deps.mjs`、`--task-name`）不用翻译**,那是专有名词。
- **不确定对方懂不懂就主动解释**：宁可多解释一句,也不要默认对方知道。如果某个概念对理解整件事很关键,先花一两句把它讲明白,再往下走。
- **不要嫌烦**：用户问技术问题时,即使问题很简单,也耐心用他能懂的方式回答,不要甩一句「去查文档」或「这很基础」。

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
- 自起 Chrome（**只走 approval mode**，chrome://inspect toggle，没开就报错；唯一例外是用户主动跑 `scripts/launch-chrome.mjs`，那是用户调用的启动器，不是 agent 自起）
- 用 `--profile`（与 `--cdp` 互斥）
- 只传 CDP 端口等待 Chrome 授权；必须使用同次 full 检查返回并核验过的本地完整 `ws://127.0.0.1:<port>/devtools/browser/<id>` 地址
- 猜测、手工拼接或复用 Chrome 重启前的完整调试地址
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
- **`check-deps-core.mjs` 已移除旧 `ensureCDP` 别名**：环境检查现在显式区分 `--mode light` 与 `--mode full`，只有 full 要求浏览器就绪
- **`output.mjs` task-name 模式（2026-06-19）**：`resolveOutputDir(taskName?)` 支持两种模式——传 taskName 则按 `~/.sleuth/output/<task-name>/`（多 Agent 协作需独立 task 目录），不传则按 `YYYY-MM-DD/`（向后兼容）。`sanitizeTaskName` 拒路径分隔符 / `..` / 特殊字符（只允许 `[a-zA-Z0-9-_.]`），防注入。空字符串视为「已传入但非法」会抛错（`if (taskName !== undefined)` 不是 truthy 检查）。check-deps CLI 通过 `--task-name <name>` 传入。
- **`spawn-subagent.mjs` 的 5 role 模板**：`scout` / `search` / `boundary` / `review` / `synthesize`。各角色直接写自己的文件：landscape.json / raw JSONL / boundary-report.json / audit-report.json / draft.md；回复只报状态。
- **raw 文件名强制带轮次**：`raw/search-r<round>-<agent>.jsonl`。`normalize.mjs` 从全部 raw 确定性重建 findings，不追加旧派生结果；同一批 raw 重跑结果必须一致。
- **red_flag 也必须有结构化来源**：旧版、冲突或不可靠页面写入 `sources[]`，成稿只能用限制语义引用它来解释排除理由，不能当成当前事实。
- **跨 Agent 深度可审计**：boundary hint 必须带 `source_claim_keys`；Round 2+ finding 用 `context_links` 证明使用前序结论；`check-depth.mjs` 按 7 种 task_type 检查关系。

## COMMANDS

```bash
# 跑环境检查（agent 触发 sleuth 后第一件事）
node scripts/check-deps.mjs --mode light --check-only

# 浏览器兜底：只连接用户当前使用、已有登录态的 Chrome
node scripts/check-deps.mjs --mode full --check-only

# 独立诊断工具，不属于研究兜底；仅用户明确选择时运行，可能关闭 Chrome
node scripts/launch-chrome.mjs --confirm-close-browser

# 可选：检查远程调试许可。新连接仍可能要求确认一次，不是永久免弹窗
node scripts/fix-chrome-debug-permission.mjs --check

# 跑全部测试
node --test scripts/__tests__/*.mjs

# 生成子 Agent prompt 文本
# 生成子 Agent prompt 文本（默认 search role）
node scripts/spawn-subagent.mjs --goal "验证 X 的定价" --must-verify "价格" --deliverable "定价对比表" --stop-criteria "至少 3 个独立源"

# 生成边界 Agent prompt
node scripts/spawn-subagent.mjs --role boundary --goal "评估覆盖度" --task-dir ~/.sleuth/output/<task-name>/

# 生成审查 Agent prompt
node scripts/spawn-subagent.mjs --role review --goal "审计证据链" --task-dir ~/.sleuth/output/<task-name>/ --draft-path ~/.sleuth/output/<task-name>/draft.md

# 生成合成 Agent prompt（v2：主 Agent 不做合成，派合成 Agent）
node scripts/spawn-subagent.mjs --role synthesize --task-dir ~/.sleuth/output/<task-name>/

# 归一化 raw/ → findings.jsonl + stats-summary.json（v2 核心）
node scripts/normalize.mjs ~/.sleuth/output/<task-name>/

# 反认知循环计算（算 novelty_ratio + stale_count → 更新 progress.json）
node scripts/calc-novelty.mjs ~/.sleuth/output/<task-name>/

# 检查门（7 个 phase，不通过 exit 1）
node scripts/validate-state.mjs ~/.sleuth/output/<task-name>/ --phase 3-findings

# 找本地浏览器历史/书签 URL
node scripts/find-url.mjs "关键词" --since 7d

# 升级 agent-browser（必须 ≥ 0.28；0.27 的完整地址连接有已知 403 bug）
npm i -g agent-browser@latest
```

## NOTES

- **测试数量不写死在文档里**：以 `node --test scripts/__tests__/*.mjs` 的实时输出为准。核心覆盖包括两轮确定性归一化、完成条件、7 种跨轮关系、收敛规则、边界/草稿/审查检查门和角色交接。
- **环境脚本测试边界**：浏览器发现与“未经确认不得关闭 Chrome”可自动测；真正启动 Chrome、系统策略和真实历史数据库需要人工环境测试。
- **agent-browser 版本敏感**：0.27.1 的 `--cdp <ws-url>` 有 HTTP 预检 403 bug，必须 0.28+
- **浏览器兜底只连现有 Chrome**：轻量工具失败后先核对端口身份，再用同次 full 检查返回的完整本地 WebSocket 地址接入用户当前登录态；禁止只传端口重试授权，禁止裸 `agent-browser open`、`agent-browser install`、`--profile` 和自动 `launch-chrome.mjs`
- **chrome://inspect toggle 不持久**：Chrome 重启会重置，用户需重新勾选
- **`extract-subtitles.sh` + `srt_to_transcript.py`** 在 `scripts/` 下，混语言（Node + Bash + Python），无 README 解释边界
