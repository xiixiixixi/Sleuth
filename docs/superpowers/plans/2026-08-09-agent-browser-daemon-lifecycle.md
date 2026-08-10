# agent-browser 后台连接生命周期实施计划

> **历史状态：部分被替代。** 本计划已经完成；其中只传端口的连接步骤已被 `2026-08-10-chrome-approval-direct-websocket.md` 替代，默认后台服务与 1 小时闲置退出规则仍然保留。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Sleuth 只复用一个连接用户日常 Chrome 的 `agent-browser` 后台服务，并在闲置 1 小时后自动断开，避免授权弹窗因残留会话反复出现。

**Architecture:** 保留现有的字面 CDP（Chrome 调试协议）端口和串行浏览器调度，不新增管理进程。通过统一命令前缀把显式闲置时间传给 `agent-browser`，并在主规则、工具指南和搜索角色提示三个入口同时约束；自动测试检查生成后的真实提示和当前文档契约。

**Tech Stack:** Node.js ESM、`node:test`、Markdown 规则文档、`agent-browser` 0.28 以上。

## Global Constraints

- 浏览器兜底只连接用户平时使用、已经登录的稳定版 Google Chrome。
- 所有浏览器命令必须使用 `agent-browser --cdp <port> --idle-timeout 1h <command>`。
- 禁止使用 `--session` 或 `--namespace` 创建额外后台服务。
- 禁止启动或复用其他常驻 CDP 代理。
- 禁止使用 `agent-browser close` 或 `close --all` 结束用户 Chrome；只能关闭本任务明确创建的标签页。
- 浏览器操作必须串行，同一时刻只把端口交给一个搜索角色。
- 不自动启动、关闭、重启或替换 Chrome，不恢复 `~/.sleuth/chrome-live`。
- 保持零 npm 依赖；测试使用 `node:test` 和 `node:assert`。

---

### Task 1: 用失败测试固定单连接和闲置退出契约

**Files:**
- Modify: `scripts/__tests__/spawn-subagent.test.mjs`
- Modify: `scripts/__tests__/references-structure.test.mjs`

**Interfaces:**
- Consumes: `SLEUTH_CDP_PORT` 环境变量和 `scripts/spawn-subagent.mjs` 输出的搜索角色提示。
- Produces: 对完整命令前缀、禁止额外会话、文档三处一致性的回归断言。

- [ ] **Step 1: 给搜索提示增加失败断言**

在“有浏览器端口时使用字面值”测试中增加：

```js
assert.match(prompt, /agent-browser --cdp 9222 --idle-timeout 1h/);
assert.match(prompt, /不要使用 `--session` 或 `--namespace`/);
assert.match(prompt, /禁止启动或复用其他常驻 CDP 代理/);
```

- [ ] **Step 2: 给文档契约增加失败断言**

在 `references-structure.test.mjs` 中分别断言：

```js
assert.match(skill, /--idle-timeout 1h/);
assert.match(tool, /--idle-timeout 1h/);
assert.match(tool, /禁止使用 `--session` 或 `--namespace`/);
assert.match(tool, /禁止启动或复用其他常驻 CDP 代理/);
assert.match(tool, /禁止使用 `agent-browser close` 或 `close --all`/);
```

- [ ] **Step 3: 运行相关测试并确认按预期失败**

Run:

```bash
node --test scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/references-structure.test.mjs
```

Expected: FAIL，原因是当前提示和文档还没有 `--idle-timeout 1h` 以及完整的后台会话约束。

---

### Task 2: 最小实现统一命令前缀

**Files:**
- Modify: `SKILL.md`
- Modify: `references/tool-guide.md`
- Modify: `scripts/spawn-subagent.mjs`

**Interfaces:**
- Consumes: `SLEUTH_CDP_PORT=<port>`。
- Produces: 搜索角色可直接复制执行的 `agent-browser --cdp <port> --idle-timeout 1h <command>` 前缀。

- [ ] **Step 1: 修改主规则**

在 `SKILL.md` 浏览器兜底段加入：

```md
所有命令必须使用同一个默认后台服务，并带 `--cdp <port> --idle-timeout 1h`；禁止使用 `--session` 或 `--namespace` 另建后台服务。
```

- [ ] **Step 2: 修改工具指南**

把正确示例改为：

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --idle-timeout 1h open https://example.com
```

并明确以下生命周期：

```md
连接用户 Chrome 的后台服务默认不会自动闲置退出，所以必须显式设置 1 小时。任务结束只关闭自己创建的标签页；禁止使用 `agent-browser close` 或 `close --all`，避免关闭用户 Chrome。
```

- [ ] **Step 3: 修改搜索角色提示**

在 `browserContract()` 中生成：

```text
所有命令使用 agent-browser --cdp <port> --idle-timeout 1h <command>；不要使用 --session 或 --namespace。
```

- [ ] **Step 4: 运行相关测试并确认通过**

Run:

```bash
node --test scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/references-structure.test.mjs
```

Expected: PASS，0 failed。

---

### Task 3: 对齐当前设计、测试方法和问题账本

**Files:**
- Modify: `docs/DESIGN-v3.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/TEST-ISSUES.md`
- Modify: `docs/STATUS.md` only if document inventory or status changes

**Interfaces:**
- Consumes: Task 2 的固定命令前缀和本机真实验证结果。
- Produces: 不再声称 9222 属于 `chrome-live` 的当前事实记录，以及后台连接生命周期的验收步骤。

- [ ] **Step 1: 更新当前设计和测试方法**

在浏览器边界加入单后台服务、显式闲置退出和首次连接仍可能弹一次官方授权；在 `TESTING.md` 加入：

```bash
agent-browser --cdp 9222 --idle-timeout 1h get title
```

并检查连续命令复用同一个后台进程、不产生额外命名会话，也没有其他常驻 CDP 客户端连接 9222。

- [ ] **Step 2: 更新问题账本**

新增问题记录：多个旧 `agent-browser` 后台服务不会默认闲置退出，同时还有一个运行 21 天的 Node CDP 代理保持连接，导致 Chrome 重复授权。记录根因证据、即时清理结果、代码修复和真实测试结果；把 #032 的“当前仍是 chrome-live”改为历史事实，明确当前日常 Chrome 已通过身份检查和 Google 登录态现场验证。

- [ ] **Step 3: 运行文档检查**

Run:

```bash
node scripts/check-docs.mjs
git diff --check
```

Expected: PASS，无缺失文档、过时文件名或空白错误。

---

### Task 4: 完整自动回归和真实 Chrome 验收

**Files:**
- Modify: `docs/TEST-ISSUES.md`（只记录实际结果）

**Interfaces:**
- Consumes: 当前工作树全部修改和 `~/.sleuth/output/shenluoji-deep-dive-20260802/` 真实任务目录。
- Produces: 自动测试、语法、文档、真实任务和真实 Chrome 的完成证据。

- [ ] **Step 1: 运行全部自动测试**

Run:

```bash
node --test scripts/__tests__/*.mjs
```

Expected: 0 failed；通过数按实时输出记录，不提前写死。

- [ ] **Step 2: 运行语法和格式检查**

Run:

```bash
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f" || exit 1; done
bash -n scripts/extract-subtitles.sh
node scripts/check-docs.mjs
git diff --check
```

Expected: 全部 exit 0。

- [ ] **Step 3: 复验真实研究任务目录**

Run:

```bash
node scripts/audit-run.mjs "$HOME/.sleuth/output/shenluoji-deep-dive-20260802" --stage all
```

Expected: raw、research、draft、final 全部通过。

- [ ] **Step 4: 复验日常 Chrome 身份**

Run:

```bash
node scripts/check-deps.mjs --mode full --check-only --json
```

Expected: `ready:true`、`browser_identity: verified-user-chrome`、CLI 版本不低于 0.28。

- [ ] **Step 5: 验证单后台服务复用**

在用户确认一次 Chrome 官方授权后，连续执行两条只读命令：

```bash
agent-browser --cdp 9222 --idle-timeout 1h get title
agent-browser --cdp 9222 --idle-timeout 1h get url
```

然后用 `ps` 与 `lsof` 验证只存在一个默认 `agent-browser` 后台服务和一条已建立的 9222 连接；不得出现任务命名的 `.sock` 会话，也不得有其他常驻 CDP 客户端连接 9222。

- [ ] **Step 6: 写入真实测试结果并完成审计**

只把实际命令输出写进 `docs/TEST-ISSUES.md`。逐项核对设计目标、测试要求、当前事实和未验证限制；任何证据缺失都继续修复，不把部分通过写成完成。
