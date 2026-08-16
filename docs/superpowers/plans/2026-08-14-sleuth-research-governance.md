# Sleuth Research Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Sleuth 在多个 Codex 任务连续研究同一产品问题时，能够复用已经审计通过的结论、限制子智能体总数、避免带着预设答案搜索，并且绝不再把未完成的子问题误判为“可以交付”。

**Architecture:** 新增一层“任务内治理文件”，只约束当前研究目录，不建立全局会话系统或研究索引。`research-plan.json` 在搜索前声明中立问题、竞争假设、相关旧任务和最多 6 个固定子智能体；搜索结果在现有 raw（原始记录）末尾登记查询轨迹；Boundary（边界判断）对照任务清单和旧决策；Synthesize（合成）额外生成结构化决策记录；Review（审查）检查新结论是否与旧结论冲突。`validate-state.mjs` 在每个关键阶段执行硬检查。

**Tech Stack:** Node.js ESM、`node:test`、JSON / JSONL、Markdown；保持零 npm 依赖。

## Global Constraints

- [ ] 不改变 WebSearch、WebFetch、agent-browser 或现有登录态 Chrome 的兜底流程。本次审计中，浏览器升级与复用行为是正确的。
- [ ] 不创建全局 `research-index`、session（会话）系统、registry（注册表）或新的长期数据库；全部新增状态都放在 `~/.sleuth/output/<task-name>/` 内。
- [ ] 不自动改写历史任务目录。历史目录缺少新治理文件时仍可阅读；要继续研究，必须显式补齐新文件后再运行检查门。
- [ ] 子智能体上限是一次完整研究任务最多 6 个“固定身份”，不是每轮再创建 6 个。第二轮、审查修复和浏览器恢复都复用原身份。
- [ ] 浏览器失败恢复继续使用原来的 `shared-browser.mjs exec` 和同一登录态 Chrome；本计划不碰浏览器连接、授权框、标签页锁或端口发现代码。
- [ ] 不让主 Agent 重新读取全部 `findings.jsonl` 做人工汇总；仍由 Boundary、Synthesize、Review 分工。
- [ ] 不把产品文档修改和网络研究混为一个完成条件。研究必须先通过 `8-audit`，后续实施另开任务。
- [ ] 所有新增规则先写失败测试，再写最小实现，再运行相关测试；不得只改提示词而没有机器检查。

---

## Why This Plan Exists

本计划直接针对最近 Zendesk 研究中已经发生的情况，不是抽象优化：

- `agent-sidebar-context-package/draft.md` 把长期问题卡片作为侧栏主对象，`copilot-ui-boundary-20260813/draft.md` 又否定了长期问题卡片；两份报告都通过了各自的现有检查门，但系统没有要求后一份解释为什么改结论。
- 最近五轮相关任务大约启动了 3、9、15、9、9 个子智能体。15 个那轮出现失败，后面的审查也遇到名额不足；根因是“每轮可以并行”被误当成“每轮都可以新建一批人”。
- 部分 `task_spec.md` 把“问题卡片应如何工作”写成前提，搜索自然会围绕该答案找材料，缺少真正竞争的解释。
- 已出现 `task_spec.md` 仍全部是 `[ ]`，但 Boundary 和数量统计让 phase 4、phase 7-ready 通过的情况。当前 `questionList()` 解析时丢掉了勾选状态。
- 搜索记录里出现了 `site:`、精确引号和实质重复查询，违反现有搜索策略，却没有机器可读的查询记录可供检查。
- 浏览器兜底能在轻量搜索不足时及时切换到现有登录态 Chrome；这部分不是本轮根因，所以明确保持不动。

---

## Target State

一次新研究开始后，任务目录至少包含：

```text
~/.sleuth/output/<task-name>/
├── task-meta.json          # 标明这是采用新治理规则的任务
├── research-plan.json      # 中立问题、竞争假设、旧任务关系、固定 Agent 名单
├── task_spec.md            # 现有逐题完成清单
├── progress.json
├── landscape.json
├── raw/
├── findings.jsonl
├── stats-summary.json
├── boundary-report.json
├── decision-record.json    # 当前任务最终主张及与旧结论的关系
├── draft.md
└── audit-report.json
```

建议的 `research-plan.json` 第 1 版结构：

```json
{
  "schema_version": 1,
  "decision_key": "zendesk.copilot-sidebar-object",
  "decision_question": "Copilot 侧栏应围绕什么对象组织，分别适用于哪些场景？",
  "mode": "new",
  "parent_tasks": [
    {
      "task_dir": "/Users/weixili/.sleuth/output/agent-sidebar-context-package",
      "relation": "same_decision",
      "decision_key": "zendesk.copilot-sidebar-object"
    }
  ],
  "hypotheses": [
    {
      "id": "H1",
      "statement": "侧栏围绕长期问题对象组织",
      "falsifiers": ["官方对象模型无法承载长期问题，或真实工作流不需要该对象"]
    },
    {
      "id": "H2",
      "statement": "侧栏围绕服务对象、摘要和正式任务组织",
      "falsifiers": ["跨会话连续性无法由这些对象组合维持"]
    }
  ],
  "agent_budget": {
    "max_unique_agents": 6,
    "assignments": [
      { "role": "scout", "agent_name": "scout", "scope": "扫描实体和来源地形" },
      { "role": "search", "agent_name": "search-a", "scope": "验证主假设与一手来源" },
      { "role": "search", "agent_name": "search-b", "scope": "验证反例和替代假设" },
      { "role": "boundary", "agent_name": "boundary", "scope": "判断覆盖、冲突和停止边界" },
      { "role": "synthesize", "agent_name": "synthesize", "scope": "写草稿和决策记录" },
      { "role": "review", "agent_name": "review", "scope": "独立审查证据和旧决策冲突" }
    ]
  }
}
```

约束：

- `decision_question` 必须是问题，不能把目标结论写进问题。
- `hypotheses` 至少 2 个；每个都必须有可推翻它的 `falsifiers`，避免只寻找支持材料。
- `parent_tasks` 只能显式列出与本次决策直接相关的旧任务；系统不扫描整个 `~/.sleuth/output/` 建索引。
- `mode: extend` 表示继续同一决策，只补缺口或反例，必须沿用原任务目录和固定 Agent 名单。
- `agent_budget.max_unique_agents` 只能是 1–6；同一 `(role, agent_name)` 可以跨轮复用，不能临时换新名字绕过上限。

建议的 `decision-record.json` 第 1 版结构：

```json
{
  "schema_version": 1,
  "decision_key": "zendesk.copilot-sidebar-object",
  "conclusion": "侧栏以服务对象为主，并用摘要和正式任务承接跨会话连续性。",
  "relationship_to_parents": "revised",
  "parent_tasks": ["/Users/weixili/.sleuth/output/agent-sidebar-context-package"],
  "conflicts": [
    {
      "parent_conclusion": "侧栏围绕长期问题卡片组织。",
      "resolution": "官方对象模型与真实工作流证据不支持把问题卡片作为长期语义对象。",
      "source_claim_keys": ["copilot:sidebar:object-model"]
    }
  ],
  "alternatives_rejected": [
    {
      "alternative": "为每个问题建立长期问题卡片",
      "reason": "会和正式任务、摘要及服务对象重复",
      "source_claim_keys": ["copilot:sidebar:object-model"]
    }
  ],
  "limitations": ["尚未用真实坐席任务做长期可用性验证"]
}
```

`relationship_to_parents` 只能是 `not_applicable`、`confirmed`、`revised` 或 `contradicted`。后两种必须列出具体冲突、解决理由和证据键，不能悄悄覆盖旧结论。

---

## Task 1: 建立任务治理文件和共享校验器

**Files:**

- Create: **scripts/lib/research-governance.mjs**
- Create: **scripts/init-research-task.mjs**
- Create: **scripts/adopt-research-task.mjs**
- Create: **scripts/__tests__/research-governance.test.mjs**
- Create: **scripts/__tests__/init-research-task.test.mjs**
- Create: **scripts/__tests__/adopt-research-task.test.mjs**
- Modify: `scripts/validate-state.mjs`
- Modify: `scripts/__tests__/validate-state.test.mjs`
- Modify: `scripts/__tests__/current-problem.test.mjs`
- Modify: `scripts/AGENTS.md`

### Step 1: 先写治理结构的失败测试

- [ ] 在 `research-governance.test.mjs` 覆盖以下情况：
  - 合法的 `research-plan.json` 通过。
  - 少于 2 个竞争假设失败。
  - 假设没有 `falsifiers` 失败。
  - `max_unique_agents > 6` 失败。
  - `(role, agent_name)` 重复失败。
  - assignment（分工）数量超过预算失败。
  - `mode: extend` 却没有相关父任务失败。
  - `parent_tasks[].task_dir` 不是绝对路径失败。

测试直接导入以下公开接口：

```js
import {
  readTaskMeta,
  readResearchPlan,
  validateResearchPlan,
  assertAgentAssignment,
  normalizeResearchQuery,
  validateSearchTrace,
} from '../lib/research-governance.mjs';
```

- [ ] 运行并确认失败：

```bash
node --test scripts/__tests__/research-governance.test.mjs
```

预期：因为模块尚不存在而失败。

### Step 2: 实现最小共享校验器

- [ ] **scripts/lib/research-governance.mjs** 只使用 `node:fs`、`node:path` 等内建模块。
- [ ] `validateResearchPlan(plan)` 返回字符串错误数组，不直接退出进程，方便多个 CLI 共用。
- [ ] `assertAgentAssignment(plan, { role, agentName })` 在未分配或超过预算时抛出带中文说明的错误。
- [ ] `readTaskMeta(taskDir)` 和 `readResearchPlan(taskDir)` 只读任务目录，不扫描父目录。
- [ ] 在 `scripts/AGENTS.md` 说明 `scripts/lib/` 新增了研究治理共享逻辑，但仍禁止恢复旧 session / registry 系统。

### Step 3: 为新任务提供唯一初始化入口

- [ ] **scripts/init-research-task.mjs** 接受：

```text
--task-name <name>
--decision-key <key>
--decision-question <question>
--hypothesis <statement>::<falsifier>   # 至少重复两次
--parent-task <absolute-path>           # 可选，可重复
--mode new|extend
```

- [ ] 脚本复用 `resolveOutputDir()`、`ensureOutputDir()`，生成 `task-meta.json` 和 `research-plan.json`，并自动放入最多 6 个固定分工。
- [ ] 若目录中已有任何研究结果，默认拒绝覆盖；只有完全相同的初始化参数可以幂等重跑。
- [ ] 不加入 `--force`，避免覆盖用户已有研究。
- [ ] `task-meta.json` 至少记录：`schema_version`、`governance_version`、`task_name`、`created_at`。

### Step 4: 为历史任务提供显式采用入口

- [ ] **scripts/adopt-research-task.mjs** 只用于用户或维护者明确决定把一个旧任务接入新规则，不在正常研究流程中自动运行。
- [ ] 接受 `--task-dir`、`--plan-file`、`--decision-record-file`；两个输入 JSON 都必须先通过共享校验。
- [ ] 只有旧目录已经存在 `draft.md`、`audit-report.json` 且 `audit-report.passed === true` 时才允许采用。
- [ ] `decision-record.json` 的 conclusion 必须在现有 draft 中找到对应文字；引用的 `source_claim_keys` 必须存在于现有 findings。
- [ ] 只创建原来不存在的 `task-meta.json`、`research-plan.json` 和 `decision-record.json`，任何同名文件已存在都拒绝；绝不改写 raw、findings、draft 或 audit。
- [ ] 采用失败时不留下半套文件：先全部校验，再用独占创建方式一次写入；中途失败要删除本次新建的小文件，但不能碰历史证据。

### Step 5: 所有检查门默认要求治理文件

- [ ] `validate-state.mjs` 在执行任何 phase 前先读取 `task-meta.json` 和 `research-plan.json`；缺任一文件都失败，并提示运行初始化或显式采用脚本。
- [ ] 不提供能让新任务静默绕过治理规则的 `--legacy` 参数。历史目录可以继续阅读，但要重新跑流程或声明完成，必须先显式采用。
- [ ] `task-meta.governance_version` 与 plan schema 不受支持时失败，不能把未知新版当成旧版放行。
- [ ] 在 `validate-state.test.mjs` 增加缺两个文件、只缺一个文件、非法 plan 三个失败用例。
- [ ] 更新既有测试 fixture builder（样本生成器），统一写入最小合法治理文件；不要在每个测试里复制一份 JSON。
- [ ] `current-problem.test.mjs` 的 7 种任务样本同样补齐治理文件，证明新前置检查没有掩盖原来的任务类型检查。

### Step 6: 测试初始化和显式采用都不会覆盖数据

- [ ] 在 `init-research-task.test.mjs` 黑盒执行脚本，覆盖：首次创建、同参数幂等、不同参数拒绝、已有 raw 数据拒绝、非法 task name 拒绝。
- [ ] 在 `adopt-research-task.test.mjs` 覆盖：已审计旧任务可采用、未通过审计拒绝、结论与 draft 不一致拒绝、claim key 不存在拒绝、任一目标文件已存在时零改写。
- [ ] 运行：

```bash
node --test scripts/__tests__/research-governance.test.mjs scripts/__tests__/init-research-task.test.mjs scripts/__tests__/adopt-research-task.test.mjs
```

预期：全部通过。

### Step 7: 提交

- [ ] Commit:

```bash
git add scripts/lib/research-governance.mjs scripts/init-research-task.mjs scripts/adopt-research-task.mjs scripts/validate-state.mjs scripts/__tests__/research-governance.test.mjs scripts/__tests__/init-research-task.test.mjs scripts/__tests__/adopt-research-task.test.mjs scripts/__tests__/validate-state.test.mjs scripts/__tests__/current-problem.test.mjs scripts/AGENTS.md
git commit -m "feat: add task-local research governance"
```

---

## Task 2: 把“最多 6 个固定子智能体”变成硬限制

**Files:**

- Modify: `scripts/spawn-subagent.mjs`
- Modify: `scripts/__tests__/spawn-subagent.test.mjs`
- Modify: `SKILL.md`

### Step 1: 写失败测试

- [ ] 在 `spawn-subagent.test.mjs` 新增：
  - 所有 5 种角色都必须传 `--agent-name`，不再只有 search 要求。
  - 传 `--task-dir` 后，角色和名字必须出现在 `research-plan.json`。
  - `search-a` 在第 1、2 轮都可生成提示词，代表复用同一身份。
  - `search-c` 不在固定名单中时立即失败。
  - `boundary-fix-2` 这类临时新名字不能绕过预算。
  - 提示词明确写“第二轮、修复和浏览器恢复必须给现有 Agent 发 follow-up，不要创建新 Agent”。

- [ ] 运行并确认新增用例失败：

```bash
node --test scripts/__tests__/spawn-subagent.test.mjs
```

### Step 2: 修改提示词生成器

- [ ] `spawn-subagent.mjs` 对 scout、search、boundary、synthesize、review 都要求 `--task-dir` 和 `--agent-name`。
- [ ] 读取并校验 `research-plan.json`；不在 assignment 中的角色/名字拒绝生成提示词。
- [ ] 保留现有 search 的 `--round`、`--subquestion-id` 和 raw 文件命名规则。
- [ ] 输出中加入稳定身份说明，但不增加 session ID 或新的上报协议。

### Step 3: 修改主流程规则

- [ ] `SKILL.md` 把并行策略改成：
  - 新任务必须先运行 `init-research-task.mjs`，再写 `task_spec.md` 和派 Agent；旧任务要继续研究时先显式运行 `adopt-research-task.mjs`。
  - 最多 6 个固定身份；默认 1 scout + 2 search + 1 boundary + 1 synthesize + 1 review。
  - Round 2+ 用 `followup_task` 复用 search / boundary。
  - 合成修复复用 synthesize，复审复用 review。
  - 某 Agent 卡住时先中断并复用同一身份；只有该身份彻底不可恢复，才能在不增加唯一身份数的前提下替换，并同步修改计划。
- [ ] 明确“6 个是整个任务总数，不是单轮上限”。

### Step 4: 验证

- [ ] 运行：

```bash
node --test scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/research-governance.test.mjs
```

- [ ] 用一个临时任务验证 `search-a` 跨两轮能生成提示词，而 `search-c` 被拒绝。

### Step 5: 提交

- [ ] Commit:

```bash
git add SKILL.md scripts/spawn-subagent.mjs scripts/__tests__/spawn-subagent.test.mjs
git commit -m "feat: cap research tasks at six stable agents"
```

---

## Task 3: 修复 task_spec 勾选状态与 Boundary 不一致的问题

**Files:**

- Modify: `scripts/validate-state.mjs`
- Modify: `scripts/__tests__/validate-state.test.mjs`

### Step 1: 用真实失败模式写回归测试

- [ ] 建立一个 fixture（测试样本）：`task_spec.md` 所有问题仍为 `- [ ]`，但 `boundary-report.json` 写 `terminate_recommended: true`，统计也满足数量。
- [ ] 断言 `--phase 4` 和 `--phase 7-ready` 都必须失败。
- [ ] 再覆盖：
  - `[ ]` 问题必须出现在 `uncovered_subquestions`。
  - `[x]` 问题必须在 `stats-summary.json` 中为 `meets_criteria` 或 `accepted_limit`。
  - `[x]` 问题必须出现在 Boundary 的 `evidence_map.by_subquestion`。
  - Boundary 仍列缺口时，不能把相应题目标成 `[x]`。

- [ ] 运行并确认当前代码错误地放行：

```bash
node --test scripts/__tests__/validate-state.test.mjs
```

### Step 2: 保留并校验勾选状态

- [ ] 把 `questionList(spec)` 返回值扩展为：

```js
{ id, title, status: 'open' | 'done' }
```

- [ ] 新增纯函数 `validateQuestionCompletion({ spec, summary, boundary })`，同时由 phase 4 和 phase 7-ready 调用，避免两套判断逐渐分叉。
- [ ] Boundary 只能提出判断，不能直接改 `task_spec.md`；主 Agent 根据 Boundary 结果逐题更新 `[ ]` / `[x]` 后重新跑检查。
- [ ] `normalize.mjs` 绝不修改 `task_spec.md`。

### Step 3: 验证历史行为没有被误伤

- [ ] 运行：

```bash
node --test scripts/__tests__/validate-state.test.mjs scripts/__tests__/current-problem.test.mjs
```

- [ ] 对 7 种任务类型的现有样本确认：完整题目可通过；任何一题重新改成 `[ ]` 后必须阻止合成。

### Step 4: 提交

- [ ] Commit:

```bash
git add scripts/validate-state.mjs scripts/__tests__/validate-state.test.mjs
git commit -m "fix: align task checkboxes with boundary gates"
```

---

## Task 4: 记录并检查搜索查询，阻止重复和预设式搜索

**Files:**

- Modify: `references/search.md`
- Modify: `scripts/spawn-subagent.mjs`
- Modify: `scripts/validate-state.mjs`
- Modify: `scripts/__tests__/validate-state.test.mjs`
- Modify: `scripts/__tests__/references-structure.test.mjs`

### Step 1: 定义 raw 尾行中的查询轨迹

- [ ] 每个 search Agent 的 `agent_done` 必须增加：

```json
{
  "search_trace": {
    "queries": [
      {
        "query": "copilot sidebar object model",
        "reason": "验证侧栏承载对象",
        "gap_key": "sidebar-object",
        "outcome": "new_source"
      }
    ]
  }
}
```

- [ ] `outcome` 只允许 `new_source`、`repeat`、`failed`、`browser_fallback`。
- [ ] 浏览器兜底查询也登记在同一数组中；这只记录“查了什么”，不改变浏览器如何连接。
- [ ] 同一个逻辑查询从轻量工具升级到浏览器时只登记一条，最终 `outcome` 写 `browser_fallback`；不能因为换工具把同一句 query 登记两次。

### Step 2: 写失败测试

- [ ] `validate-state.test.mjs` 覆盖：
  - `agent_done` 缺 `search_trace` 失败。
  - query 缺 `reason` / `gap_key` / `outcome` 失败。
  - 含 `site:`、英文直引号、中文弯引号、前置排除词 `-foo` 的查询失败。
  - 同一任务不同 raw 文件中，大小写、全半角空格不同但实质相同的查询算重复并失败。
  - 同一缺口的第二次查询只有“实质改写”才允许。
  - 中文查询不按空格强制计算词数，避免误伤自然中文。

### Step 3: 实现查询校验

- [ ] `normalizeResearchQuery(query)` 统一大小写、Unicode、连续空白和首尾标点，仅用于判断重复，不改原始记录。
- [ ] `validateSearchTrace(trace)` 检查字段、禁用操作符和长度上限。
- [ ] phase `3-raw` 汇总当前任务所有 `search-r*-*.jsonl` 的查询后查重；重复时错误信息同时列出两个文件名和 query。
- [ ] 不禁止正常 URL 回原页核验；禁令只针对搜索框中的查询字符串。

### Step 4: 更新搜索提示词

- [ ] `references/search.md` 与 search prompt 明确：
  - 查询从中立实体词开始，不把预期答案塞进关键词。
  - 一个失败查询最多做一次实质改写，然后按原规则升级浏览器。
  - 不使用 `site:`、精确引号和负关键词堆砌。
  - 每个查询必须关联一个尚未覆盖的 `gap_key`。
- [ ] 保持现有“轻量工具失败后及时用登录态浏览器”的要求不变。

### Step 5: 验证并提交

- [ ] 运行：

```bash
node --test scripts/__tests__/validate-state.test.mjs scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/references-structure.test.mjs
```

- [ ] Commit:

```bash
git add references/search.md scripts/spawn-subagent.mjs scripts/validate-state.mjs scripts/__tests__/validate-state.test.mjs scripts/__tests__/references-structure.test.mjs
git commit -m "feat: audit and deduplicate research queries"
```

---

## Task 5: 让新任务显式继承、修正或反驳旧结论

**Files:**

- Modify: `references/boundary.md`
- Modify: `references/review.md`
- Modify: `scripts/spawn-subagent.mjs`
- Modify: `scripts/validate-state.mjs`
- Modify: `scripts/__tests__/spawn-subagent.test.mjs`
- Modify: `scripts/__tests__/validate-state.test.mjs`

### Step 1: 扩展 Boundary 输出契约

- [ ] `boundary-report.json` 增加：

```json
{
  "decision_consistency": {
    "status": "revised",
    "parent_tasks": ["/absolute/parent/task"],
    "conflicts": ["新证据不支持长期问题卡片作为语义对象"],
    "rationale": "对象模型与跨会话工作流证据更支持服务对象、摘要和正式任务组合。"
  }
}
```

- [ ] 没有父任务时 `status` 必须为 `not_applicable`。
- [ ] 有同一 `decision_key` 父任务时，只允许 `confirmed`、`revised` 或 `contradicted`。
- [ ] `revised` / `contradicted` 必须列出冲突和理由；不能只写“观点不同”。
- [ ] Boundary 必须读取父任务的 `decision-record.json` 和 `audit-report.json`；父任务没通过审查时，只能当线索，不能当已接受结论。

### Step 2: 让 Synthesize 写结构化决策记录

- [ ] synthesize prompt 从“只能写 `draft.md`”改为“只允许写 `draft.md` 和 `decision-record.json`”。
- [ ] `decision-record.json` 的 conclusion 必须能在 draft 的最终结论中找到对应表述。
- [ ] `source_claim_keys` 必须存在于当前 `findings.jsonl`；不能引用父任务中未带入当前证据表的键。
- [ ] 父结论被修改或反驳时，draft 必须在正文披露差异和原因，不能只藏在 JSON。

### Step 3: 扩展 Review 输出契约

- [ ] `audit-report.json` 增加：

```json
{
  "prior_decision_audit": {
    "checked": true,
    "conflicts_disclosed": true,
    "decision_record_matches_draft": true
  }
}
```

- [ ] Review 必须检查：旧决策确实存在、其审查状态、差异是否进入正文、决策记录与正文是否一致。
- [ ] 任一项为 false 时，`passed` 必须为 false；机器检查门再次独立验证，不能只相信 Review 自报。

### Step 4: 把契约接入检查门

- [ ] phase 4：校验 `decision_consistency`；同一决策却没检查父任务时失败。
- [ ] phase 7-ready：再次确认冲突已得到 Boundary 处理。
- [ ] phase 7-draft：新治理任务必须有 `decision-record.json`，`decision_key` 与计划一致，引用的 claim key 存在，正文披露冲突。
- [ ] phase 8-audit：存在父任务时必须有 `prior_decision_audit`，且三项全部为 true。
- [ ] 历史目录不自动补造决策记录；要继续运行，先用初始化工具显式采用新治理规则。

### Step 5: 用这次 Zendesk 冲突做回归样本

- [ ] 测试样本 A：父任务结论是“长期问题卡片”，子任务结论改为“服务对象 + 摘要 + 正式任务”，但未披露冲突；phase 7-draft 必须失败。
- [ ] 测试样本 B：同一冲突被列入 Boundary、decision record、draft 和 audit；全部检查门通过。
- [ ] 测试样本 C：父任务 audit `passed: false`；子任务不能把它写成已确认事实。

### Step 6: 验证并提交

- [ ] 运行：

```bash
node --test scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/validate-state.test.mjs
```

- [ ] Commit:

```bash
git add references/boundary.md references/review.md scripts/spawn-subagent.mjs scripts/validate-state.mjs scripts/__tests__/spawn-subagent.test.mjs scripts/__tests__/validate-state.test.mjs
git commit -m "feat: enforce cross-task decision consistency"
```

---

## Task 6: 把新流程写进正式文档和实际测试手册

**Files:**

- Modify: `SKILL.md`
- Modify: `docs/DESIGN-v3.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/TEST-ISSUES.md`
- Modify: `docs/CURRENT-PROBLEM.md`
- Modify: `scripts/AGENTS.md`
- Modify: `scripts/__tests__/references-structure.test.mjs`

### Step 1: 更新当前设计，不写历史故事

- [ ] `docs/DESIGN-v3.md` 增加“研究治理层”：任务初始化、父任务关系、固定 Agent 预算、查询轨迹、决策记录和新增检查门。
- [ ] 用一张小流程图说明：

```text
init task
  -> neutral plan + parent decisions
  -> fixed agent roster
  -> raw + query trace
  -> boundary + checkbox reconciliation
  -> decision record + draft
  -> prior-decision audit
  -> delivery
```

- [ ] `docs/CURRENT-PROBLEM.md` 明确 Boundary 复用同一 Agent，不新增“第七个 Agent”。
- [ ] `docs/STATUS.md` 更新当前能力和文档索引。
- [ ] `docs/TEST-ISSUES.md` 登记本次四类真实问题及解决状态：重复/冲突研究、Agent 数量膨胀、预设式查询、未勾选问题被放行。

### Step 2: 更新 `docs/TESTING.md` 的真实任务测试

- [ ] 增加一个 Zendesk 回归案例，要求：
  1. 初始化一个有父任务的同决策研究。
  2. 两个 search Agent 并行，第二轮仍复用这两个身份。
  3. 故意保留一个 `[ ]`，证明 phase 4 / 7-ready 都阻止合成。
  4. 故意重复 query，证明 `3-raw` 阻止归一化。
  5. 故意写与父任务冲突但不披露的 draft，证明 `7-draft` 阻止审查。
  6. 补齐披露和审查后，证明最终可通过。
- [ ] 明确成功标准不是“Agent finished”，而是治理文件、raw、决策记录、正文和审查报告全部一致。
- [ ] 浏览器部分继续执行现有 `check-deps.mjs --mode full --check-only --json` 身份核验，不新增浏览器测试路径。

### Step 3: 更新结构契约测试

- [ ] `references-structure.test.mjs` 断言：
  - SKILL 明确最多 6 个固定身份和跨轮复用。
  - search 引用 `search_trace`。
  - boundary 引用 `decision_consistency`。
  - review 引用 `prior_decision_audit`。
  - 全仓仍不出现已删除的 session / deliver / research-index 流程。

### Step 4: 验证并提交

- [ ] 运行：

```bash
node --test scripts/__tests__/references-structure.test.mjs scripts/__tests__/current-problem.test.mjs
node scripts/check-docs.mjs
```

- [ ] Commit:

```bash
git add SKILL.md docs/DESIGN-v3.md docs/STATUS.md docs/TESTING.md docs/TEST-ISSUES.md docs/CURRENT-PROBLEM.md scripts/AGENTS.md scripts/__tests__/references-structure.test.mjs
git commit -m "docs: define governed cross-task research workflow"
```

---

## Task 7: 全量验证与真实 Zendesk 回归

**Files:**

- Test only; do not modify production files unless a failing test identifies a real defect.

### Step 1: 自动测试

- [ ] 运行全部测试：

```bash
node --test scripts/__tests__/*.mjs
```

- [ ] 运行语法和文档检查：

```bash
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f" || exit 1; done
bash -n scripts/extract-subtitles.sh
node scripts/check-docs.mjs
git diff --check
```

### Step 2: 用历史任务副本验证，不污染原始证据

- [ ] 创建临时目录，复制以下两个任务作为父子冲突样本：
  - `~/.sleuth/output/agent-sidebar-context-package`
  - `~/.sleuth/output/copilot-ui-boundary-20260813`
- [ ] 绝不直接修改原目录；所有迁移和故障注入只在 `mktemp -d` 创建的副本中进行。
- [ ] 用 `adopt-research-task.mjs` 给副本补齐相同 `decision_key` 的治理文件，验证未披露冲突时失败、披露后通过。
- [ ] 保存每个命令的退出码和关键错误文本到测试记录；不能只写“看起来正常”。

示例准备命令：

```bash
GOVERNANCE_TEST_DIR=$(mktemp -d /tmp/sleuth-governance.XXXXXX)
cp -R "$HOME/.sleuth/output/agent-sidebar-context-package" "$GOVERNANCE_TEST_DIR/parent"
cp -R "$HOME/.sleuth/output/copilot-ui-boundary-20260813" "$GOVERNANCE_TEST_DIR/child"
```

### Step 3: 做一次小规模真实研究

- [ ] 按更新后的 `docs/TESTING.md` 初始化一个新的 Zendesk 子问题任务。
- [ ] 最多创建 6 个固定身份；记录实际创建数、每轮复用情况和是否有临时新增身份。
- [ ] 两个 search Agent 可以并行研究各自页面；使用浏览器时仍由现有 action lock（动作锁）避免抢同一标签页，不把整个研究串行化。
- [ ] 人工确认三条用户最关心的结果：
  - 没有互相打架：同一个结构化文件没有被两个 Agent 同时写。
  - 没有强制串行：互不依赖的搜索仍能同时进行。
  - 没有读错页面：浏览器动作前后都验证各自标签页身份。
- [ ] 故意制造一次 WebSearch 失败，确认系统及时升级到现有登录态浏览器；本计划没有破坏原兜底。

### Step 4: 最终审查

- [ ] 检查 `git diff --stat` 和 `git diff`，确保只包含本计划列出的文件。
- [ ] 确认没有新增 npm 依赖、没有 package.json、没有恢复任何已删除系统。
- [ ] 确认历史任务原目录哈希或文件修改时间未变化。
- [ ] 只有自动测试、真实任务、浏览器兜底和决策冲突回归全部通过，才更新 `docs/TEST-ISSUES.md` 为已解决。

### Step 5: 提交最终验证修正

- [ ] 如果验证没有发现新问题，不制造空提交。
- [ ] 如果发现问题，只做与失败证据直接对应的最小修正，重跑 Task 7 全部检查后提交：

```bash
git add <实际修正文件>
git commit -m "fix: close research governance regression"
```

---

## Acceptance Criteria

- [ ] 同一 `decision_key` 的新研究必须显式引用相关旧任务，或明确说明没有父任务。
- [ ] 新任务至少提出 2 个可被证伪的竞争假设，不能只围绕预设答案搜证据。
- [ ] 一次任务的唯一子智能体身份总数不超过 6；第二轮和修复阶段复用原身份。
- [ ] 任务内没有实质重复查询；禁用 `site:`、精确引号和负关键词堆砌。
- [ ] `task_spec.md` 任一问题仍为 `[ ]` 时，phase 4 和 phase 7-ready 都不能通过。
- [ ] 新结论确认、修正或反驳旧结论时，Boundary、decision record、draft 和 audit 四处一致。
- [ ] 历史研究目录未被自动改写，也没有出现全局索引或会话系统。
- [ ] 现有登录态 Chrome、agent-browser 和共享标签页动作锁的测试全部保持通过。
- [ ] `node --test scripts/__tests__/*.mjs`、语法检查、文档检查和真实 Zendesk 回归均通过。

## Expected Outcome for the Recent Zendesk Work

实施后，最近出现的两套相互冲突的侧栏结论不会再各自“独立审查通过”后直接交付。新任务会先看到旧任务的决策记录，再选择确认、修正或反驳；如果修正却没有说明差异，机器检查门会拦住。与此同时，原来一轮不断新增 Agent、最终达到 9–15 个的做法会被固定为最多 6 个身份，后续轮次继续用同一批人，因此既保留并行搜索，也避免数量失控和上下文割裂。
