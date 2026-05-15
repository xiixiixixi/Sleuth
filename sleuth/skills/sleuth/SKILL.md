---
name: sleuth
description: 联网检索与浏览器操作。触发场景：搜索信息、查看网页、登录访问、社交媒体抓取、动态页面渲染等一切需要真实浏览器的网络任务。使用场景：用户提到搜索、查一下、search、look up、联网、最新信息、网页内容提取；任何需要打开浏览器访问网页的任务。
---

# sleuth — 梦里寻

sleuth 是唯一联网方式。禁止 WebSearch、WebFetch、Fetch、curl、wget 及任何 MCP web 工具。所有联网通过 agent-browser 连接用户日常 Chrome。浏览器问题通过 `check-deps.mjs` 修复，不降级。

```bash
# 插件根目录 — 所有脚本和参考文档的基础路径
SKILL_DIR="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)"
```

## 路由

收到联网需求后判断响应层级：

```
我能确信答案正确吗？
  ├─ 能，且无时效性 → 直答（不联网）
  ├─ 能，但需确认是否过时 → 快速验证（开一个页面确认）
  └─ 不能 →
      用户要单点事实还是全景？
        ├─ 单点 → 定向搜索（搜索 + 2-3页）
        └─ 全景 → 深度调研（Research Loop）
```

例：「React 最新版本号」→ 快速验证。「React vs Vue 2026 全面对比」→ 深度调研。两者都含「最新」但深度不同。

不确定时从低层级开始，不够再升级。

## 前置

所有层级（除直答）：

```bash
# 历史召回
node "${SKILL_DIR}/scripts/research-index.mjs" --action recall --query "关键词" --limit 5
# 有命中先 Read，只搜增量

# 环境检查
node "${SKILL_DIR}/scripts/check-deps.mjs"
# 站点经验（确定域名后）
node "${SKILL_DIR}/scripts/match-site.mjs" "<域名>"

# 本地 URL 检索（用户提到"之前看过"、"书签里"、"内部系统"时）
node "${SKILL_DIR}/scripts/find-url.mjs" "关键词" --since 7d
```

命名实体无召回命中时先 backfill：
```bash
node "${SKILL_DIR}/scripts/research-index.mjs" --action backfill --days 7
```

## 快速验证 / 定向搜索

无需 session。搜索方法见 `references/search-guide.md`。结果内联回复 + 来源 URL。

故障：页面不可达换来源，搜索为空扩词或中英文各搜，两次失败告知用户。

## 深度调研（Research Loop）

```bash
SID=$(node "${SKILL_DIR}/scripts/session-logger.mjs" --action start --query "问题" --type research)
SLEUTH_OUTPUT=$(node "${SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid $SID)
```

| # | 阶段 | 产出 |
|---|------|------|
| 1 | **Scout** | 2-3 次快速搜索 → 信息地形报告（关键实体、主要来源类型、争议点） |
| 2 | **Frame** | 基于 Scout 发现制定问题清单 + 成功标准 |
| 3 | **Expand** | 六方向盲区（`search-expansion.md`），基于 Scout 实证填写 |
| 4 | **Search** | 主线 + 探针并行 |
| 5 | **Gate** | `deliver list --sid $SID` 确认每探针有交付物。缺文件 = 探针失败，重派或标记缺口 |
| 6 | **Review** | 派审查 subagent（不可跳过），含规划质量检查 |
| 7 | **Patch** | 缺口补查 或 Reframe（最多2轮） |
| 8 | **Deliver** | 合并 + 内联总结 + cwd 输出完整报告 |

搜索方法见 `references/search-guide.md`。

### Scout 阶段（必须先于 Frame）

用用户原始 query 做 2-3 次快速搜索（不同角度或语言），只读标题和摘要，不深入页面。目的：了解信息地形，为 Frame 提供实证基础。

产出格式（内联，不需要文件）：
```
Scout 发现：
- 关键实体/别名：[从搜索结果中发现的实际名称映射]
- 主要信息源类型：[哪些平台/渠道有内容，哪些没有]
- 争议/矛盾信号：[搜索结果中出现的对立观点]
- 信息密度判断：[丰富/中等/稀缺]
- 时效信号：[最新结果的日期范围]
```

Scout 禁止：深读页面、交付文件、派探针。Scout 是"扫一眼"，不是"做调研"。

**启动时先输出**：Scout 发现 + Frame + Expansion + Search Plan（主 Agent vs 探针分工）。

### Review → Patch 循环

```
Search 完成
  → Gate: deliver list 确认每探针有文件（缺 = 重派或标记缺口）
  → 派审查 subagent（读各探针交付文件 + review-checklist.md）
  → is_enough?
      是 → Merge → Deliver
      否 → needs_reframe?
            是 → 回到 Frame 重新定义问题（最多1次）→ 重新 Search
            否 → 派补查探针（scope 限定缺口）→ 再审查 → 最多2轮
  → 最终通过 → Merge → Deliver
```

- 审查由 subagent 执行，主 Agent 不自审
- **审查读个别交付文件，不需要先 merge**。审查 subagent 通过 `deliver list` 获取文件列表后逐个 Read
- Patch 只针对具体缺口，不重搜
- **Reframe**：当审查发现 Frame 方向性错误（关键假设被推翻、发现全新重要维度）→ 允许回到 Frame 重新定义，最多 1 次
- 每次 Patch 后必须再审查
- 最多 3 轮总（1 主搜 + 2 Patch），Reframe 不计入
- 达上限仍有缺口 → 交付但披露未覆盖范围

### Merge 与 Deliver（审查通过后执行）

审查通过后、交付前：
1. `deliver merge --sid $SID` — 合并所有探针交付文件
2. Read 合并文件，编辑为最终报告
3. **Write** 到用户 cwd：`<主题>-report.md`（硬规则 #10，不可跳过）
4. 内联回复摘要（关键结论 + 来源 URL）

⚠️ Merge 只在审查最终通过后执行一次。禁止在审查前 merge — 审查 subagent 直接读各探针的个别交付文件。

### 状态维护

长任务（3+ 轮或多探针）在对话中维护轻量状态块，防遗忘：

```
## State
- goal: 用户要解决什么
- questions: Q1 / Q2 / Q3...
- findings: [置信度] 结论 + URL
- gaps: 未覆盖
- red_flags: 矛盾/危险
```

更新时机：Frame 后写 goal/questions，每轮搜索后更新 findings/gaps，Review 后更新。不需要写入文件 — deliver 文件本身就是持久化。

## 探针调度

`--session` 提供 Browser Context 级隔离：每个 session 拥有独立的 cookies、storage、tabs，共享同一个 Chrome 进程但互不影响。并行探针各用独立 session，数据完全隔离。

| 角色 | 何时 | 浏览器 |
|------|------|--------|
| 搜索探针 | 角度独立可并行 | 是（独立 session） |
| 审查者 | 搜索完成后 | 否（只读文件） |
| 补查探针 | 审查发现缺口 | 是（独立 session） |

**注意**：
- 探针运行期间禁止 `killall Chrome` / `close --all` / `check-deps`（见硬规则 #9）
- SLEUTH_OUTPUT 由探针自行通过 `check-deps --output-dir` 获取，主 Agent 不传此变量
- 探针失败时通过 Gate 阶段发现（`deliver list` 缺文件），重派或标记缺口
- 所有探针共用同一个 SID，交付文件统一存到同一个 session 目录下。禁止探针创建独立 SID

### 搜索探针模板（必须原样使用，禁止改写）

⚠️ 以下模板是探针能正常运行的唯一格式。变量替换后直接使用，不得省略任何字段、不得用自己的话重写 prompt。省略 SKILL_DIR 或 subagent-guide.md 读取指令 = 探针必然失败。

```
BROWSER_SESSION="${SID}-<标识>"

Agent({
  description: "3-5 词",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: `
    你是调研探针。

    第一步（强制）：Read ${SKILL_DIR}/references/subagent-guide.md，通读并严格遵循全部约束。

    禁止 Agent 工具。禁止加载 sleuth skill。

    变量（三个由主 Agent 传入）：
    - SKILL_DIR=${SKILL_DIR}
    - SID=${SID}
    - BROWSER_SESSION=${BROWSER_SESSION}

    环境验证（第二步，按顺序执行，任何一步失败则立即返回错误）：
    1. which agent-browser || echo "ERROR: agent-browser not found"
    2. SLEUTH_OUTPUT=$(node "${SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid ${SID})
    3. echo "SLEUTH_OUTPUT=${SLEUTH_OUTPUT}"
    4. [ -d "${SLEUTH_OUTPUT}" ] || mkdir -p "${SLEUTH_OUTPUT}"

    ⚠️ SLEUTH_OUTPUT 必须通过上面第 2 步获取，禁止自行拼路径。

    任务：${目标}
    已知：${已知信息}
    浏览器：所有命令带 --auto-connect --session "${BROWSER_SESSION}"

    完成后（按顺序）：
    1. node "${SKILL_DIR}/scripts/deliver.mjs" --action save --sid "${SID}" 保存发现
    2. node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"subagent_done","name":"${BROWSER_SESSION}"}'
    3. agent-browser --auto-connect --session "${BROWSER_SESSION}" close
    4. 返回结构化摘要（findings/sources/leads/gaps/red_flags）
  `
})
```

**补查探针 = 搜索探针模板**，区别：任务描述改为审查者输出的 `patch_tasks` 内容，scope 限定为具体缺口。

### 审查者模板

```
Agent({
  description: "审查覆盖度",
  subagent_type: "general-purpose",
  run_in_background: false,
  prompt: `
    独立审查员。只读文件，不搜索，不开浏览器。禁止 Agent 工具。

    1. Read ${SKILL_DIR}/references/review-checklist.md
    2. Read 交付文件：${文件列表}
    3. 对照问题清单：${Frame 问题 + 标准}
    4. 输出 coverage / weak_claims / missing_perspectives / red_flags / is_enough / patch_tasks
  `
})
```

## 浏览器

命令带 `--auto-connect --session <名>`。主 Agent 用 `${SID}-main`。参考 `references/tool-guide.md`。

**登录态验证**：`check-deps` 后第一次 open 页面时，确认页面是登录态（检查页面内容有用户信息/非登录页）。如果不是登录态，停止操作，告知用户"sleuth Chrome 登录态缺失，请关闭所有 Chrome 后重新运行 check-deps"。不要在无登录态的情况下继续抓取需要登录的页面。

## 内容提取

文本优先（`eval "document.body.innerText"`）。特殊场景见 `references/content-extraction.md`。

## 交付

- **快速验证/定向搜索**：内联回复 + 来源 URL
- **深度调研（默认）**：Merge → Write 完整报告到 cwd → 内联回复摘要
- **深度调研（用户指定格式）**：完全按用户要求（格式、路径、文件名），不套默认行为

### cwd 输出（深度调研最后一步，不可跳过）

深度调研的 Deliver 阶段执行顺序：

```
1. deliver merge --sid $SID              → 合并所有探针交付文件为一份
2. Read 合并文件，编辑为最终报告
3. Write "<主题>-report.md" 到用户 cwd   → 这是用户拿到的最终文件（完整版）
4. 内联回复摘要（关键结论 + 来源 URL）   → 方便用户快速了解结果
```

文件名：`<主题关键词>-report.md`，中文主题用中文文件名。
内容 = merge 后经过编辑的完整报告（不是摘要，不是个别探针的碎片文件）。

⚠️ 用户只看到 cwd 里的一份文件。`~/.sleuth/output/` 下的探针碎片文件是内部中间产物，用户不应该需要去那里找报告。

deliver save 命令（探针交付用）：
```bash
node "${SKILL_DIR}/scripts/deliver.mjs" --action save \
  --type <doc|screenshot|image|transcript|data|page> \
  --source <源> --name <名> --url <URL> --sid $SID
```

## 硬规则

1. 联网前必须 recall。有命中必须 Read 再决定增量。
2. 深度调研必须 deliver save，每批发现就存。
3. 每访问重要页面必须 session-logger log。
4. 只有主 Agent 能 finish session。
5. 交付前必须派审查 subagent，主 Agent 不自审。
6. 不对敏感页面截图，不提取 cookie/密码，不执行产生记录的操作（除非用户要求）。
7. **深度调研禁止跳过 Review→Patch**：Search 阶段完成后，必须先 `deliver list` 确认文件齐全，再派审查 subagent。审查未通过则必须 Patch。不允许 Search 后直接 Deliver。
8. **探针模板不可改写**：派探针时必须使用「搜索探针模板」原样（变量替换后），不得用自己的话重写 prompt、不得省略 SKILL_DIR / subagent-guide.md 读取指令。
9. **探针运行期间禁止杀 Chrome**：有 background 探针运行时，禁止 `killall Chrome`、`close --all`、`check-deps`（会重启 Chrome）。等所有探针完成或手动取消后再操作。
10. **深度调研必须输出 cwd 文件**：Deliver 阶段必须用 Write 工具在用户 cwd 生成 `<主题>-report.md`。内联回复只是摘要，不能替代完整文件输出。用户指定了格式的除外。

## 站点经验

确定目标域名后通过 `match-site.mjs` 查找先验知识：

```bash
node "${SKILL_DIR}/scripts/match-site.mjs" "<域名>"
```

操作成功后发现新模式，写入 `~/.sleuth/site-patterns/<域名>.md`：

```markdown
---
domain: example.com
aliases: [示例]
updated: 2026-04-27
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么
```

统计由 `update-site-stats.mjs` 从 session 日志自动聚合（访问次数、成功率、Bayesian 可信度）。

## 结束 session

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid $SID --outcome success|partial|fail
```
