# Chrome 授权直连实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Sleuth 在确认用户日常 Chrome 身份后，把同次 full 检查输出的完整本机 WebSocket 地址交给 `agent-browser`，避开 0.33.2 端口发现阶段写死的 2 秒授权超时，同时保持单后台进程和原有登录态。

**Architecture:** `check-deps.mjs` 继续负责浏览器身份与 `cdp_port` / `cdp_ws` 的同源输出；`spawn-subagent.mjs` 负责最后一道输入校验，只有本机回环地址、浏览器级路径和匹配端口同时成立才生成搜索提示。所有浏览器命令复用同一个完整地址与默认后台服务，Chrome 重启或地址失效时停止并重新 full 检查，不猜地址也不循环重试。

**Tech Stack:** Node.js ESM、`node:test`、Markdown、`agent-browser` ≥ 0.28、Chrome 144+ approval mode（授权模式）。

## Global Constraints

- 基础流程 Node.js ≥ 18；浏览器兜底 Node.js ≥ 24。
- 仓库零 npm 依赖；不得新增 `package.json`。
- 浏览器目标只允许 `ws://127.0.0.1:<port>/devtools/browser/<id>`，并且端口必须匹配同次 `SLEUTH_CDP_PORT`。
- 只有 `browser_identity: verified-user-chrome` 的 full 结果可以进入搜索任务。
- 所有命令带 `--idle-timeout 1h` 并复用默认后台服务；禁止 `--session`、`--namespace` 和其他常驻 CDP 代理。
- 禁止启动、关闭、重启或替换用户 Chrome；禁止 `--profile`、`agent-browser install`、`close --all` 和复制 cookie。
- Chrome 重启后完整地址作废，必须重新 full 检查。
- 测试使用 `node:test` + `node:assert`，每个行为先看到预期失败再写实现。
- `tmp/` 是用户/历史临时残留，不纳入提交。

---

### Task 1: 搜索任务只接受已核验的完整本机调试地址

**Files:**
- Modify: `scripts/__tests__/spawn-subagent.test.mjs`
- Modify: `scripts/spawn-subagent.mjs`

**Interfaces:**
- Consumes: 环境变量 `SLEUTH_CDP_PORT: string`、`SLEUTH_CDP_WS: string`。
- Produces: `resolveCdpTarget(): { port: string, wsUrl: string, commandTarget: string } | null`；搜索提示中的固定命令前缀 `agent-browser --cdp '<ws-url>' --idle-timeout 1h`。

- [ ] **Step 1: 写完整地址成功路径的失败测试**

在测试文件定义可复用夹具，并把现有所有使用 `{ SLEUTH_CDP_PORT: '9222' }` 的合法浏览器测试改成同一个 `CDP_ENV`，包括“使用字面值”和“不会误关用户标签页”两项，避免旧夹具制造无关失败：

```js
const CDP_ENV = {
  SLEUTH_CDP_PORT: '9222',
  SLEUTH_CDP_WS: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
};

test('search prompt 使用 full 检查核验后的完整本机调试地址', () => {
  const prompt = run(SEARCH_ARGS, CDP_ENV);
  assert.match(prompt, /agent-browser --cdp 'ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/abc-123' --idle-timeout 1h/);
  assert.doesNotMatch(prompt, /agent-browser --cdp 9222 --idle-timeout 1h/);
  assert.doesNotMatch(prompt, /--cdp ['"]?\$SLEUTH_CDP_WS['"]?/);
  assert.match(prompt, /Chrome 重启.*重新.*full 检查/);
});
```

- [ ] **Step 2: 运行成功路径测试并确认按预期失败**

Run:

```bash
node --test --test-name-pattern='完整本机调试地址' scripts/__tests__/spawn-subagent.test.mjs
```

Expected: FAIL，当前提示仍生成 `--cdp 9222`，没有内联完整地址。

- [ ] **Step 3: 写拒绝不完整或不安全目标的失败测试**

```js
test('search prompt 拒绝不完整或不安全的浏览器目标', () => {
  const badEnvs = [
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: '' },
    { SLEUTH_CDP_PORT: '', SLEUTH_CDP_WS: CDP_ENV.SLEUTH_CDP_WS },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: 'wss://remote.example/devtools/browser/abc' },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: 'ws://127.0.0.1:9333/devtools/browser/abc' },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: 'ws://127.0.0.1:9222/devtools/page/abc' },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: 'ws://user@127.0.0.1:9222/devtools/browser/abc' },
  ];
  for (const env of badEnvs) {
    const result = spawnSync('node', [SCRIPT, ...SEARCH_ARGS], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    assert.equal(result.status, 2, JSON.stringify(env));
    assert.match(result.stderr, /SLEUTH_CDP_PORT.*SLEUTH_CDP_WS|本机.*调试地址|端口.*一致/);
  }
});
```

- [ ] **Step 4: 运行拒绝路径测试并确认按预期失败**

Run:

```bash
node --test --test-name-pattern='不完整或不安全' scripts/__tests__/spawn-subagent.test.mjs
```

Expected: FAIL，当前生成器只看 `SLEUTH_CDP_PORT`，不会拒绝缺失、远程或不匹配地址。

- [ ] **Step 5: 实现最小的目标校验与提示生成**

在 `scripts/spawn-subagent.mjs` 中读取两个环境变量，并加入只服务 search role 的校验函数：

```js
const CDP_PORT = process.env.SLEUTH_CDP_PORT || '';
const CDP_WS = process.env.SLEUTH_CDP_WS || '';

function resolveCdpTarget() {
  if (!CDP_PORT && !CDP_WS) return null;
  if (!CDP_PORT || !CDP_WS) fail('浏览器使用权必须同时提供 SLEUTH_CDP_PORT 和 SLEUTH_CDP_WS');
  if (!/^\d+$/.test(CDP_PORT) || Number(CDP_PORT) < 1 || Number(CDP_PORT) > 65535) {
    fail('SLEUTH_CDP_PORT 必须是有效端口');
  }
  let parsed;
  try { parsed = new URL(CDP_WS); }
  catch { fail('SLEUTH_CDP_WS 必须是本机完整调试地址'); }
  if (
    parsed.protocol !== 'ws:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== CDP_PORT
    || parsed.username
    || parsed.password
    || !/^\/devtools\/browser\/[A-Za-z0-9._-]+$/.test(parsed.pathname)
    || parsed.search
    || parsed.hash
  ) fail('SLEUTH_CDP_WS 必须是端口一致的本机浏览器级调试地址');
  return { port: CDP_PORT, wsUrl: CDP_WS, commandTarget: `'${CDP_WS}'` };
}
```

`buildSearchContract()` 调用一次 `resolveCdpTarget()`，并把结果显式传给 `cdpSection(agentName, cdpTarget)`；没有目标时保留现有 `BROWSER_CONTROL_REQUIRED` 文本。所有当前端口前缀改为完整地址前缀，同时写明地址失效后必须重新 full 检查。

- [ ] **Step 6: 运行角色测试并确认通过**

Run:

```bash
node --test scripts/__tests__/spawn-subagent.test.mjs
```

Expected: 全部通过；错误路径 exit 2，合法提示不含仅端口执行前缀。

- [ ] **Step 7: 提交 Task 1**

```bash
git add scripts/spawn-subagent.mjs scripts/__tests__/spawn-subagent.test.mjs
git commit -m "fix: 使用已核验的 Chrome 完整调试地址"
```

---

### Task 2: 主规则与工具指南统一完整地址契约

**Files:**
- Modify: `scripts/__tests__/references-structure.test.mjs`
- Modify: `SKILL.md`
- Modify: `references/search.md`
- Modify: `references/tool-guide.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `scripts/AGENTS.md`

**Interfaces:**
- Consumes: Task 1 的 `SLEUTH_CDP_PORT` + `SLEUTH_CDP_WS` 双值契约。
- Produces: 主 Agent、搜索 Agent 和使用者看到的一致执行规则；端口只用于身份比对，完整地址用于执行。

- [ ] **Step 1: 写当前文档契约的失败测试**

更新 `SKILL.md` 契约测试，并新增跨文档断言：

```js
test('当前浏览器规则使用同次 full 检查的完整地址', () => {
  const skill = read('SKILL.md');
  const search = read('references/search.md');
  const tool = read('references/tool-guide.md');
  const current = [skill, search, tool, read('README.md')].join('\n');
  assert.match(skill, /SLEUTH_CDP_PORT=<port> SLEUTH_CDP_WS=<ws-url>/);
  assert.match(current, /完整.*WebSocket|完整.*调试地址/);
  assert.match(current, /ws:\/\/127\.0\.0\.1:<port>\/devtools\/browser\/<id>/);
  assert.match(current, /Chrome 重启.*重新.*full 检查/);
  assert.doesNotMatch(tool, /agent-browser --cdp \$SLEUTH_CDP_PORT --idle-timeout 1h/);
});
```

- [ ] **Step 2: 运行文档契约并确认按预期失败**

Run:

```bash
node --test scripts/__tests__/references-structure.test.mjs
```

Expected: FAIL，当前文档仍把 `$SLEUTH_CDP_PORT` 当作执行目标。

- [ ] **Step 3: 最小修改当前规则**

统一写法：

```bash
SLEUTH_CDP_PORT=<port> SLEUTH_CDP_WS=<ws-url> node scripts/spawn-subagent.mjs ...
agent-browser --cdp '<full 检查输出的 SLEUTH_CDP_WS>' --idle-timeout 1h <command>
```

必须解释：

- `SLEUTH_CDP_PORT` 只用于核对完整地址来自同一个日常 Chrome。
- Chrome 144+ 端口发现约 2 秒超时后不重试，直接使用同次 full 输出的 `SLEUTH_CDP_WS`。
- 完整地址只允许本机回环地址，Chrome 重启后必须重新 full 检查。
- 同一时刻只把这一对值交给一个搜索 Agent，继续串行操作标签页。

- [ ] **Step 4: 标记旧规格和旧计划已被替代**

在以下文件顶部加入醒目状态说明，但保留历史测试证据：

```markdown
> 状态：本文件的“只传端口”执行前缀已由 2026-08-10 Chrome 授权直连规格替代；历史根因和闲置退出结论继续有效。
```

Files:

- `docs/superpowers/specs/2026-08-09-agent-browser-daemon-lifecycle-design.md`
- `docs/superpowers/plans/2026-08-09-agent-browser-daemon-lifecycle.md`

- [ ] **Step 5: 运行相关测试和文档检查**

Run:

```bash
node --test scripts/__tests__/references-structure.test.mjs scripts/__tests__/spawn-subagent.test.mjs
node scripts/check-docs.mjs
git diff --check
```

Expected: 全部通过，当前可执行文档不再要求仅端口前缀。

- [ ] **Step 6: 提交 Task 2**

```bash
git add SKILL.md README.md AGENTS.md CLAUDE.md references/search.md references/tool-guide.md scripts/AGENTS.md scripts/__tests__/references-structure.test.mjs docs/superpowers/specs/2026-08-09-agent-browser-daemon-lifecycle-design.md docs/superpowers/plans/2026-08-09-agent-browser-daemon-lifecycle.md
git commit -m "docs: 对齐 Chrome 完整调试地址规则"
```

---

### Task 3: 更新当前设计、测试方案和问题账本

**Files:**
- Modify: `docs/DESIGN-v3.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/CHROME-DEBUG-ISSUE.md`
- Modify: `docs/TEST-ISSUES.md`
- Modify: `scripts/__tests__/references-structure.test.mjs`

**Interfaces:**
- Consumes: Task 1 的安全校验行为、2026-08-10 真实 Chrome 验收数据。
- Produces: 可重复执行的验收步骤和不夸大的当前状态记录。

- [ ] **Step 1: 扩展当前文档契约测试**

```js
test('当前测试文档记录端口超时与完整地址验收', () => {
  const testing = read('docs/TESTING.md');
  const issue = read('docs/CHROME-DEBUG-ISSUE.md');
  assert.match(testing, /端口发现.*2 秒.*不重试/);
  assert.match(testing, /完整.*SLEUTH_CDP_WS/);
  assert.match(testing, /一条.*9222.*连接/);
  assert.match(issue, /0\.33\.2/);
  assert.match(issue, /约 6\.64 秒/);
  assert.match(issue, /约 0\.11 秒/);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
node --test --test-name-pattern='端口超时与完整地址验收' scripts/__tests__/references-structure.test.mjs
```

Expected: FAIL，当前文档只记录旧后台进程根因，没有 0.33.2 的 2 秒缺陷和直连实测。

- [ ] **Step 3: 更新设计与测试步骤**

`docs/TESTING.md` 的真实命令统一为：

```bash
agent-browser --cdp '<full 输出的 cdp_ws>' --idle-timeout 1h get title
agent-browser --cdp '<同一个 cdp_ws>' --idle-timeout 1h get url
agent-browser --cdp '<同一个 cdp_ws>' --idle-timeout 1h tab list --json
ps -axo pid,ppid,etime,command | grep agent-browser
lsof -nP -iTCP:<full 输出的 cdp_port>
```

合格标准增加：首次完整地址连接可等待用户授权；后两条命令不再等待；完整地址、端口、进程身份来自同一次 full 结果。

- [ ] **Step 4: 更新真实问题记录**

在 `docs/TEST-ISSUES.md` 增加单独问题项：

- 端口模式 3 次约 2.08 秒超时且没有建立连接。
- 官方 0.33.2 源代码固定 2 秒，上游延时修复截至 2026-08-10 未合并。
- 完整地址首次约 6.64 秒成功，后续两命令共约 0.11 秒。
- 一个默认 PID、一个 `default.sock`、一条已建立连接、6 个原有标签、无测试浏览器和其他代理。
- 结论严格写成“同一连接不重复授权”，不承诺未来新连接永久免确认。

- [ ] **Step 5: 运行文档契约和检查**

Run:

```bash
node --test scripts/__tests__/references-structure.test.mjs
node scripts/check-docs.mjs
git diff --check
```

Expected: 全部通过。

- [ ] **Step 6: 提交 Task 3**

```bash
git add docs/DESIGN-v3.md docs/TESTING.md docs/CHROME-DEBUG-ISSUE.md docs/TEST-ISSUES.md scripts/__tests__/references-structure.test.mjs
git commit -m "docs: 记录 Chrome 144 授权直连实测"
```

---

### Task 4: 全量回归与完成审计

**Files:**
- Verify only: `scripts/**/*.mjs`
- Verify only: `scripts/*.sh`
- Verify only: `docs/**/*.md`
- Verify only: `/Users/weixili/.sleuth/output/shenluoji-deep-dive-20260802/`

**Interfaces:**
- Consumes: Tasks 1-3 的提交。
- Produces: 自动测试、文档、语法、真实研究任务和真实 Chrome 五类完成证据。

- [ ] **Step 1: 运行完整自动测试**

```bash
node --test scripts/__tests__/*.mjs
```

Expected: 0 failed；记录实时测试总数，不在长期文档中写死未来数量。

- [ ] **Step 2: 运行语法、文档和差异检查**

```bash
for file in scripts/*.mjs scripts/lib/*.mjs scripts/__tests__/*.mjs; do node --check "$file"; done
for file in scripts/*.sh; do bash -n "$file"; done
node scripts/check-docs.mjs
git diff --check
```

Expected: 全部 exit 0。

- [ ] **Step 3: 重跑“神逻辑”真实任务审计**

```bash
node scripts/audit-run.mjs /Users/weixili/.sleuth/output/shenluoji-deep-dive-20260802 --stage all
```

Expected: raw、归一化、深度、边界、就绪、草稿和审查全部通过。

- [ ] **Step 4: 核对真实 Chrome 证据仍成立**

只读检查当前后台状态：

```bash
ps -axo pid,ppid,etime,command | grep agent-browser
lsof -nP -iTCP:9222
find ~/.agent-browser -maxdepth 1 -type s -print
```

Expected: 一个默认后台进程、一个 `default.sock`、一条已建立连接、无命名会话、无其他代理或测试浏览器。若连接已因 1 小时闲置退出，不重新弹窗凑证据，使用 Task 3 已记录的现场时间与命令结果，并把“当前已闲置退出”作为符合设计的补充证据。

- [ ] **Step 5: 做逐项完成审计**

逐项核对规格的 8 条不可变边界，确认每项都有代码、自动测试、文档或真实运行证据；任何一项证据缺失都不得标记完成。

- [ ] **Step 6: 检查提交和工作树**

```bash
git log -5 --oneline
git status --short
```

Expected: 正式文件没有未提交改动；只允许保留任务开始前已有的 `tmp/` 未跟踪目录。
