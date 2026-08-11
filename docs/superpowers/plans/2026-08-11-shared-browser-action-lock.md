# Shared Browser Action Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让所有搜索子 Agent 保持并行，只在一次真实浏览器操作期间短暂排队，并保证每次操作都回到自己的标签页后再执行和核验。

**Architecture:** 新增一个 `shared-browser.mjs` 单一入口。调用者只提交自己的唯一身份和一条浏览器命令；脚本内部用跨进程短锁协调默认 `agent-browser` 后台服务，通过一次 `batch` 调用完成“选择标签页、执行命令、再次选回标签、读取最终 URL/标题”。正常完成或失败都自动释放；协调器被强制终止时保留保护锁，禁止自动强拆。搜索 prompt 不再让 Agent 手动取得或释放任务级浏览器使用权。

**Tech Stack:** Node.js ESM、`node:test`、`node:assert`、`node:child_process`、`node:fs` 内建模块；`agent-browser` ≥ 0.28，当前实测版本 0.33.2。

## Global Constraints

- Node.js 基础流程最低 18；真实浏览器兜底最低 24。
- 零 npm 依赖；不新增 `package.json`。
- 只连接同次 full 检查核验过的日常 Google Chrome 完整本机 WebSocket 地址。
- 禁止新建浏览器、命名 session（会话）、namespace（命名空间）或其他常驻 CDP 代理。
- 子 Agent 只使用 `exec`，不手动取得或释放锁；`status` 只用于诊断。
- 锁只覆盖一次浏览器操作，不覆盖搜索、阅读、分析或整个子 Agent 生命周期。
- 每次正常操作必须在命令前后都选择调用者自己的标签页，并在同一批次内返回最终 URL 和标题。
- 共享模式禁止跨命令复用 `@eN` 元素引用；交互使用稳定选择器或单命令 `find`，避免切换标签后误点。
- Chrome 或完整调试地址失效时返回 `BROWSER_CONTROL_REQUIRED`，禁止猜测新地址。

---

### Task 1: 修正规格中的锁粒度和连接寿命

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-shared-agent-browser-connection-design.md`

**Interfaces:**
- Consumes: 用户确认的三条验收线：不抢、不整队串行、不读错页面。
- Produces: `exec --owner <id> --tab <label> -- <command>` 唯一执行契约和可选 `status` 诊断契约。

- [x] **Step 1: 删除任务级 acquire/run/release 协议**

把“一个调用者持有到任务结束”改成“一次命令开始前取短锁，命令和核验结束后自动释放”。

- [x] **Step 2: 写明连接保持规则**

当前 `agent-browser` 支持用 `--idle-timeout 0` 关闭闲置退出；所有共享命令显式使用该值，只复用默认后台服务。

- [x] **Step 3: 写明错误页面防护**

标签选择、命令、URL/标题核验必须放进一个 `batch --bail --json` 调用；共享模式不允许跨调用复用 `@eN`。

- [x] **Step 4: 自查规格**

确认正文不再要求四步接口，也不再出现“一个 Agent 完成后下一个才能用浏览器”的任务级串行描述。

### Task 2: 用失败测试定义共享执行入口

**Files:**
- Create: `scripts/__tests__/shared-browser.test.mjs`
- Create: `scripts/shared-browser.mjs`

**Interfaces:**
- Consumes: 环境变量 `SLEUTH_CDP_PORT`、`SLEUTH_CDP_WS`，参数 `exec --owner --tab -- <command>`。
- Produces: 成功时透传命令结果并附最终 URL/标题；失败时非零退出且锁已释放；`status --json` 返回当前短锁状态。

- [x] **Step 1: 写参数和安全边界失败测试**

覆盖缺 owner、缺 tab、地址不完整、端口不一致、`--session`、`--namespace`、`--profile`、裸 `close`、跨命令 `@eN`。

- [x] **Step 2: 运行测试确认失败**

Run: `node --test scripts/__tests__/shared-browser.test.mjs`

Expected: FAIL，因为 `scripts/shared-browser.mjs` 尚不存在。

- [x] **Step 3: 写并发行为失败测试**

测试创建一个真实可执行的假 `agent-browser`，同时启动两个 `shared-browser exec` 进程。假 CLI 记录标签选择与命令执行顺序；断言两个命令区间不重叠，并且 A 的命令只在 A 标签执行、B 的命令只在 B 标签执行。

- [x] **Step 4: 写失败自动释放测试**

第一个命令故意失败，紧接的第二个命令必须成功；证明调用者无需手动 `release`，也不会留下任务级占用。

- [x] **Step 5: 实现最小脚本**

脚本使用 `mkdir` 的原子性创建短锁；等待者按短间隔检查，超时给出占用者信息。拿锁后先切换或创建自己的标签，再以 JSON stdin 调用：

```json
[
  ["tab", "<label>"],
  ["<command>", "<arg>"],
  ["tab", "<label>"],
  ["get", "url"],
  ["get", "title"]
]
```

使用 `try/finally` 保证任何退出路径都删除自己的锁目录。

- [x] **Step 6: 运行专项测试到通过**

Run: `node --test scripts/__tests__/shared-browser.test.mjs`

Expected: PASS，且没有残留锁目录。

### Task 3: 让搜索子 Agent 只使用单一入口

**Files:**
- Modify: `scripts/__tests__/spawn-subagent.test.mjs`
- Modify: `scripts/spawn-subagent.mjs`
- Modify: `scripts/__tests__/references-structure.test.mjs`
- Modify: `SKILL.md`
- Modify: `references/tool-guide.md`
- Modify: `README.md`
- Modify: `docs/DESIGN-v3.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/CHROME-DEBUG-ISSUE.md`

**Interfaces:**
- Consumes: Task 2 的 `shared-browser.mjs exec`。
- Produces: 所有搜索 prompt 都给出带字面完整地址的 wrapper（包装脚本）命令，不再让子 Agent 直接运行 `agent-browser --cdp`。

- [x] **Step 1: 先修改 prompt 测试并确认失败**

新断言要求 prompt 含 `shared-browser.mjs exec --owner <唯一任务身份> --tab <同一唯一身份>`、`--idle-timeout 0` 的连接语义、“轻量工作继续并行”，并明确不含 `acquire`、`release` 和任务级独占描述；不同任务中的同名 Agent 必须生成不同身份。

- [x] **Step 2: 修改 prompt 生成器到通过**

把完整本机地址和端口逐字内联成每次 wrapper 调用前的环境变量；子 Agent 只替换 `--` 后的浏览器命令。

- [x] **Step 3: 更新当前规则文档**

统一说明：默认后台连接长期复用；子 Agent 并行；浏览器命令短暂排队；标签选择和核验由脚本自动完成；禁止直接调用绕过协调器。

- [x] **Step 4: 跑契约测试**

Run: `node --test scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/references-structure.test.mjs`

Expected: PASS。

### Task 4: 按 TESTING.md 自动和真实验收

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `docs/TEST-ISSUES.md`

**Interfaces:**
- Consumes: 完整实现与当前用户 Chrome。
- Produces: 自动并发证据、真实双标签证据、连接数量和授权行为记录。

- [x] **Step 1: 跑完整自动测试**

Run: `node --test scripts/__tests__/*.mjs`

Expected: 0 failures。

- [x] **Step 2: 跑文档检查**

Run: `node scripts/check-docs.mjs`

Expected: PASS。

- [x] **Step 3: 运行 full 环境检查**

Run: `node scripts/check-deps.mjs --mode full --check-only --json`

Expected: `browser_identity` 为 `verified-user-chrome`，得到同一次检查的端口和完整地址；若 Chrome 要求授权，由用户点击一次。

- [x] **Step 4: 同时启动两个真实 wrapper 调用**

A 和 B 分别绑定本任务新建的唯一标签，导航到两个不同的公开页面；并发启动后分别读取 URL 和标题。必须证明 A 始终是 A 页面、B 始终是 B 页面，没有交叉。

- [x] **Step 5: 检查短锁与连接**

任务命令结束后没有持有锁；两个子进程可以同时做非浏览器工作；默认后台服务只有一个，Chrome 调试端口只有一条 `agent-browser` 已建立连接，没有命名 `.sock`。

- [x] **Step 6: 清理本任务标签并记录结果**

只通过 wrapper 关闭 A/B 标签，不关闭用户原有标签页。把执行命令、结果和仍需人工确认的限制写入 `docs/TEST-ISSUES.md`。

- [x] **Step 7: 最终复验**

再次运行完整自动测试和 `node scripts/check-docs.mjs`；检查 `git diff --check` 和 `git status --short`。
