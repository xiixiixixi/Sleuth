---
name: sleuth
description: >-
  所有搜索、网页读取、浏览器验证与网络研究任务都应优先通过此 skill 处理。触发场景：用户要求搜索信息、查看网页内容、验证页面或来源、访问动态渲染页面、使用登录态浏览器、读取最新网页信息、或处理任何需要真实网页证据的网络任务。
---


## 文档

| 文档 | 内容 |
|---|---|
| **SKILL.md** | 操作步骤 / loop / 状态文件 / 合成 / 证据分层 / 交付 / 运行边界 |
| **scout.md** | 侦察执行：广度扫描策略 / 工具选择 / landscape.json 返回格式 |
| **search.md** | 搜索执行：自迭代循环 / 查询 / 工具选择 / 失败兜底 / JSONL 返回 / follow_ups |
| **boundary.md** | 边界评估：覆盖度 + 方向偏移 + 实体准确 + follow-ups 状态 / 输出 schema |
| **review.md** | 证据链审计：4 项审计 / critical-non_critical 分级 / 输出 schema |
| **tool-guide.md** | agent-browser 命令速查 / 反爬降级 / 特殊内容 |

## 输入输出格式约定（I/O Contract）

| 角色 | 输入 | 读什么文档 | 用什么工具 | 输出格式 |
|------|------|-----------|-----------|---------|
| 侦察 Scout | `--goal`（用户问题领域） | scout.md | WebSearch + WebFetch | landscape.json（JSON 对象） |
| 搜索 Searcher | `--goal` + `--must-verify` + `--task-dir` + `--round` | search.md | WebSearch + WebFetch + agent-browser + extract-subtitles | JSONL（findings + gaps + red_flags + follow_ups） |
| 边界 Boundary | `--task-dir`（读 task_spec + findings + follow_ups） | boundary.md | 无（只读文件） | YAML（terminate + uncovered + drift + mismatch） |
| 审计 Reviewer | `--task-dir` + `--draft-path` | review.md | WebFetch（仅验证 URL） | YAML（critical + non_critical + stats） |

## 角色边界

主 Agent 只做 **调度 + 合成**——派子 Agent 做研究、收 findings、写报告、派审查。**不亲手做研究**：不自己搜、不自己开浏览器、不自己截图。你脑子里的 URL 可能是错的（如把 Windsurf 的官网记成 devin.ai），搜索子 Agent 的搜索结果比你的记忆可靠。研究由子 Agent 完成，主 Agent 用子 Agent 返回的 URL 和 findings 合成报告。

## 第 0 步：环境检查

每次触发后第一件事，不跳过：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

输出当前浏览器连接模式和环境变量（`SLEUTH_CDP_PORT` / `SLEUTH_CDP_WS`）。后续所有 agent-browser 命令带上这些变量。

**如果 check-deps 输出 “chrome: 未发现可连的浏览器”**——Chrome 没开 CDP 调试。跑 launch-chrome 脚本启动带调试端口的 Chrome（保留你的登录态）：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/launch-chrome.mjs"
```

脚本做的事：杀 Chrome → 把日常 profile 符号链接到 `~/.sleuth/chrome-live/` → 用 `--remote-debugging-port=9222 --user-data-dir=~/.sleuth/chrome-live/` 重启（骗过 Chrome 136+ 的安全检查，保留登录态）→ 写 DevToolsActivePort → 输出 `SLEUTH_CDP_PORT` / `SLEUTH_CDP_WS`。

跑完后再跑一次 `check-deps.mjs` 确认连上了。没开调试的任务（纯 WebSearch / WebFetch 能搞定的轻任务）可以继续，但涉及浏览器操作的任务必须等连上了再跑。

## 第 1 步：判断任务复杂度

**轻任务**（直接答，不进 loop）：
- 1-2 次搜索能答完
- 问题边界清晰、单一来源即可

→ 直接答 + 必要时一次 WebFetch 验证一手来源（不拿搜索摘要当证据）。搜索策略、工具选择、失败兜底看 `${CLAUDE_SKILL_DIR}/references/search.md` §2-5。

**并行调研**（走 loop，满足任一）：
- 问题需要多源交叉验证（对比 / 调研 / 争议性话题 / 高风险领域）
- 涉及多个独立子主题
- 单次搜索后发现比预想复杂
- 需要多轮迭代才能收敛

→ 继续第 1.5 步。

## 第 1.5 步：侦察（Scout）

并行调研任务在写 task_spec 之前，先派 1 个侦察 Agent 做全局广度扫描：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs \
  --role scout \
  --goal "<用户问题领域>" \
  --task-dir <outputDir>
```

侦察 Agent 做 3 类搜索（实体发现 / 结构对比 / 技术维度），返回 landscape.json（entities / perspectives / source_hints）。不做深度研究、不提取 claim。

**拿到 landscape.json 后**：基于它写 task_spec——子问题按 entities 和 perspectives 拆，不是凭你脑子里的知识猜。侦察发现的实体和来源是你拆题的依据。

## 第 2 步：初始化任务目录 + 写 task_spec.md

### 2.1 写 task_spec.md

任务目录路径是 `~/.sleuth/output/<task-name>/`（主 Agent 自己拼，不需要再跑 check-deps）。用 Write 工具写文件时目录会自动创建。
用 Write 工具写 `<outputDir>/task_spec.md`：

````markdown
# task_spec.md

## 用户问题（重写后）
<把用户模糊问题转成具体可研究的 question>

## 子问题
1. <子问题 1>
   - 来源类型：<官方/学术/新闻/...>
   - 完成标准：<什么叫答完，如"找到 2+ 个独立源确认 X">
2. <子问题 2>
   - 来源类型：<...>
   - 完成标准：<...>

## 全局完成标准
- 时间覆盖：<如"包含 2026 年内至少 2 个时间点">
- 反方视角：<如"至少 1 个批评性来源">
- 来源多样性：<如"至少 3 种来源类型">
````

**完成标准是终止判断的依据**——你在第 5 步对照它判断是否够。

拆解原则：子问题独立（不依赖彼此）；每个单一目标；数量等于复杂度，不为拆而拆。

## 第 3 步：派搜索 Agent（每轮）

对每个子问题（或第 6 步里边界 Agent 建议的新方向）：

### 3.1 生成 prompt

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs" \
  --role search \
  --goal "验证该产品当前公开定价与计费单位" \
  --must-verify "价格数字" \
  --must-verify "计费单位" \
  --deliverable "一份含 3 个独立源的定价对比表" \
  --stop-criteria "至少 3 个独立源" \
  --known-clue "域名: example.com" \
  --task-dir <outputDir> \
  --round <当前轮次>
```

**写 goal 时说要什么，不说怎么做。** 描述目标（「验证定价」），不要指定路径（「搜 pricing」）。`must-verify` 要具体到字段（「价格数字」），不要写「核实信息」。

### 3.2 派发

把上一步输出的**整段 prompt 文本**作为子 Agent 的 prompt，用你的运行时子 Agent 派发工具（如 Claude Code 的 `task` 工具）派发。

**每轮最多并行 5 个搜索 Agent。** 子问题 > 5 个时分两批：第一批先派 5 个，收齐 findings 后再派剩余的。不要一次性把 7-8 个全丢出去——模型后台任务系统扛不住，会静默丢 Agent。

**派发前必须设置子 Agent 的环境变量**：把第 0 步 check-deps 输出的 `SLEUTH_CDP_PORT`（和 `SLEUTH_CDP_WS` 如果有）作为环境变量传给子 Agent——子 Agent 的所有 agent-browser 命令依赖这个变量连浏览器。

搜索 Agent 会读 `${CLAUDE_SKILL_DIR}/references/search.md`（搜索逻辑 + 工具选择 + 失败兜底 + JSONL 返回格式）+ 通过 `--task-dir` 读已有 findings/directions 避免重复。

### 3.3 收 stdout → 写 findings.jsonl

每个搜索 Agent 通过 stdout 返回 **JSONL**（每行一个 JSON 对象，格式见 `${CLAUDE_SKILL_DIR}/references/search.md` §4.3）。收齐后：

1. `JSON.parse` 逐行解析
2. **校验 + 归一化**（子 Agent 可能不严格遵守 §4.3 枚举，必须清洗后再写）：
   - `type` 不在 `finding` / `gap` / `red_flag` 里 → 强制改 `finding`（自定义类型如 `funding_round` / `valuation` 不保留）
   - `confidence` 不在 5 级枚举（`已验证事实` / `高置信推断` / `未确认线索` / `冲突信息` / `覆盖缺口`）里 → 按 tier 推断：T1/T2 → `高置信推断`，T3 → `未确认线索`
   - `tier` 是整数（`1`/`2`/`3`）或英文（`primary`/`secondary`/`tertiary`）→ 映射成 `"T1"` / `"T2"` / `"T3"`
   - `dimensions_seen` 是字符串数组（如 `["amount","date"]`）→ 转成对象数组 `[{"dimension":"<原值>","observation":""}]`
3. 给每条 finding 补充字段：`ts`（当前 ISO 时间戳）、`round`（当前轮次）、`agent`（你给的 agent 名）、`claim_id`（`sha1(normalized_claim + url_domain)` 前 12 位；`normalized_claim` = lowercase + 去标点 + 折叠空白）
4. 用 Write 工具 append 到 `<outputDir>/findings.jsonl`
5. **提取 follow_up_questions**：从 findings 里提取所有 follow_up_questions，写入 `<outputDir>/follow_ups.json`（格式见「状态文件 schema」段）。下一轮派发时用作新方向依据。

**只有你写 findings.jsonl 和 follow_ups.json。** 子 Agent 不写文件——避免并发写撕行。

### 3.4 写 directions.json

每派一个搜索 Agent，把方向追加到 `<outputDir>/directions.json`（格式见「状态文件 schema」段）。

## 第 4 步：派边界 Agent

每轮搜索 Agent 收齐后，派一个边界 Agent 评估覆盖度：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs" \
  --role boundary \
  --goal "评估覆盖度" \
  --task-dir <outputDir>
```

边界 Agent 读 `task_spec.md` + `findings.jsonl` + `follow_ups.json`，返回 `terminate_recommended` + `uncovered_dimensions` + `direction_drift` + `entity_mismatch` + `follow_ups_unresolved`（判定规则和输出格式见 `${CLAUDE_SKILL_DIR}/references/boundary.md`）。

## 第 5 步：检查终止信号

1. **软终止**：`terminate_recommended: true` → 进第 7 步
2. **硬终止**：连续 2 轮 findings 的 `claim_id` 集合无新增（`Set Round N − Set Round N-1 = ∅`）→ 进第 7 步
3. **用户终止**：CHECKPOINT → 停

不终止 → 第 6 步。

## 第 6 步：写新方向 + 下一轮

1. 综合三个来源设计新搜索方向：
   - 边界 Agent 的 `uncovered_dimensions`
   - `follow_ups.json` 里 `resolved: false` 的问题
   - 边界 Agent 的 `direction_drift`
2. **查 directions.json 避免重复**：新方向的 `direction + source_type` 组合不能已在列表里
3. 追加新方向到 directions.json
4. 把未解决的 follow-up 问题作为新搜索 Agent 的 `--known-clue` 传入
5. 回第 3 步（派搜索 Agent，`--round` 递增）

**loop 持续迭代，直到终止信号触发——不是固定轮次。**

## 第 7 步：合成 + 审查 + 交付

⚠️ **合成只由你（主 Agent）一次性完成。** 子 Agent 只做 research，不写报告。不要让子 Agent 各写一段再拼——会产生前后矛盾。你收齐所有 findings，自己一口气写完 draft.md。
### 7.1 压缩

进入合成前先压缩——把多轮搜索的 raw 内容去噪：

- **去重**：3 个源说同一件事 → 合成一句“3 个源都说 X”，列出 3 个 URL
- **去无关**：明显跑题的内容删掉
- **标记冲突**：A 源说 X，B 源说 Y → 明确列出冲突，标时间戳，给判断依据
- **按可信度分层**：T1（官方原始）/ T2（第三方深度）/ T3（聚合摘要）

压缩是去噪不是丢证据。压缩完应该比原文短，但**每个原始 URL 都还在**。

### 7.2 合成

按问题类型选结构：

| 问题类型 | 推荐结构 |
|---|---|
| 对比类（A vs B） | 背景 → A 概览 → B 概览 → 对比表 → 结论 |
| 清单类（“列出 X”） | 直接列表，每项一段，不需要 intro/outro |
| 调研类（“全面了解 X”） | 概览 → 关键维度 1 → 关键维度 2 → ... → 结论 |
| 时间线类 | 按时间排序，每事件一段 |
| 单一问题 | 直接答案 + 支撑证据（最简结构） |

写作纪律：每个核心结论内联来源 URL；不自指（“作为研究员我...”）——直接写报告；用用户问题的语言写。

### 7.3 证据分层

**Tier 分级**：

| Tier | 常见来源 | 用法 |
|---|---|---|
| **Tier 1** | 官方文档、官方博客、监管文件（.gov / SEC / 同行评议） | 核心事实首选 |
| **Tier 2** | 行业分析、第三方评测、GitHub / issues、成熟评论站 | 补强、对照、寻找反证 |
| **Tier 3** | 搜索摘要、SEO 文、未署名新闻稿、单条论坛评论 | 发现线索，**不单独支撑核心结论** |

**5 级可信度**：

```
已验证事实  ← 多个独立源一致 + T1 来源
高置信推断  ← 单源 + T1/T2 来源
未确认线索  ← 单源 + T3 来源，或标了 red_flag
冲突信息    ← 源之间矛盾
覆盖缺口    ← 所有 gaps 汇总
```

### 7.4 冲突处理

- 同一事实 2+ 源冲突 → **再搜一次**确认，不要凭印象选边
- 争议性话题 → 刻意找各方立场
- 时效冲突 → 优先取最近 30 天内的源，但明示旧源说什么
- 合成前 cross-source validation：每个 claim 的 support count，support < 2 的标 confidence low
- **冲突无法解决时**：明确告诉用户“源之间存在分歧”，列出各方说法，**不为了给答案而强行采信某一方**

### 7.5 引用纪律

- **每个核心结论必须内联来源 URL**：`[结论](https://来源URL)`。没有 URL 的结论视为编造
- 单源最多 1 句直引，不超过 15 词，默认 paraphrase
- 不要用 bullet / numbered list 重现原文章结构（版权问题）
- 涉高风险话题：用“according to X”，不用“权威认证”

### 7.6 写草稿

基于 `findings.jsonl` 合成报告草稿，写到 `<outputDir>/draft.md`。

### 7.7 派审查 Agent

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs" \
  --role review \
  --goal "审计报告" \
  --task-dir <outputDir> \
  --draft-path <outputDir>/draft.md
```

审查 Agent 返回 `audit_findings` + `sampled_stats`（审计规则看 `${CLAUDE_SKILL_DIR}/references/review.md`）。

### 7.8 审计结果处理

审计 Agent 返回 critical + non_critical + sampled_stats（审计规则看 `${CLAUDE_SKILL_DIR}/references/review.md`）。

- non_critical 非空 → 你修 draft（补 URL、改分级、标冲突）
- critical 非空 → **回 LOOP**（第 3 步），带 `suggested_search` 作为新方向
  - revision 硬上限：critical 回 loop 最多 3 次
  - 第 3 次仍 critical → 标记为「已知限制」写入报告，交付
- 都为空 → 交付

**不停下来问"是否提交"**——就绪即执行。

输出按优先级：
1. 用户指定输出形式 → 严格按用户要求
2. 简单问题 → 内联回复 + URL
3. 复杂问题 → Markdown 报告写到用户 cwd 或 `<outputDir>/`
4. 并行调研 → 合成一份最终报告，不生成多个“final / merged / summary”版本

**图文并茂（按 query 类型）**：产品对比 / 设计 / 图表解读 / 评测类报告，必须图文并茂——呈现型图片按 `${CLAUDE_SKILL_DIR}/references/search.md` §6.2 流程归档并内嵌。纯事实 / 政策类不强求。证据型图片只附 URL + 标注“视觉分析”。

## 状态文件 schema

### 文件总表

```
<outputDir>/
├── task_spec.md       # 你写 / 你 + 边界 Agent + 搜索 Agent 读
├── findings.jsonl     # 你代写 / 你 + 边界 Agent + 审查 Agent 读
├── follow_ups.json    # 你写 / 你 + 边界 Agent 读（搜索 Agent 返回的追踪问题）
├── directions.json    # 你写 / 你 + 搜索 Agent 读
└── draft.md           # 你写 / 你 + 审查 Agent 读
```

| 文件 | 写者 | 读者 | 格式 |
|---|---|---|---|
| `task_spec.md` | 你 | 你 + 边界 Agent + 搜索 Agent（`--task-dir`） | Markdown（见第 2.1 步） |
| `findings.jsonl` | 你（代写，子 Agent stdout 返回） | 你 + 边界 Agent + 审查 Agent | JSONL（见下文） |
| `follow_ups.json` | 你（从 findings 提取） | 你 + 边界 Agent | JSON 数组（见下文） |
| `directions.json` | 你 | 你 + 搜索 Agent（`--task-dir`） | JSON 数组（见下文） |
| `draft.md` | 你 | 你 + 审查 Agent（`--draft-path`） | Markdown |

### findings.jsonl 行格式

```jsonl
{"ts":"2026-06-19T12:34:56Z","round":1,"agent":"search-2","claim_id":"a3f9c2e1b8d7","claim":"Anthropic Claude API 输入定价 $3/M tokens","url":"https://www.anthropic.com/pricing","confidence":"已验证事实","tier":"T1"}
```

字段：
- `ts`: ISO 时间戳（你代写时注入）
- `round`: loop 轮次（你派发时传入；用于第 5 步硬终止判定）
- `agent`: 你给的 agent 名（如 `search-2`）
- `claim_id`: `sha1(normalized_claim + url_domain)` 前 12 位——你用 claim_id 集合 diff 判新增
  - `normalized_claim` = lowercase + 去标点 + 折叠空白
  - `url_domain` = URL 的 host
- `claim` / `url` / `confidence` / `tier`: 见 §7.3 证据分层


### follow_ups.json 格式

```json
[
  {"round":1,"from_agent":"search-3","question":"Genesys 是否也有 AOP 机制？","resolved":false},
  {"round":2,"from_agent":"search-1","question":"Twilio Flex 的规则引擎如何工作？","resolved":false}
]
```

字段：
- `round`: 哪一轮的搜索 Agent 返回的
- `from_agent`: agent 名
- `question`: 追踪问题（搜索中发现的新实体/概念/方向）
- `resolved`: 主 Agent 标记——某轮搜索覆盖了这个问题时改 `true`

边界 Agent 读这个文件判断 follow_ups_unresolved。主 Agent 在第 6 步用它作为新方向依据。
### directions.json 格式

```json
[
  {"round":1,"direction":"OpenAI 商业模式","source_type":"官方","agent":"search-1","ts":"..."},
  {"round":2,"direction":"社区对 OpenAI 的批评","source_type":"社区","agent":"search-3","ts":"..."}
]
```

字段：
- `round`: 哪一轮派的方向
- `direction`: 方向描述（一句话，主题角度）
- `source_type`: 来源类型枚举（`官方` / `第三方` / `社区` / `学术` / `新闻`）
- `agent`: 你给的 agent 名
- `ts`: ISO 时间戳

**写入时机**：每轮派搜索 Agent 前，把要派的方向追加。

**重复判定规则**：
- `direction` + `source_type` 组合已在列表 → **重复，必须换路**
- `direction` 相似但 `source_type` 不同 → **不算重复**（同主题换来源类型是合法探索）

**state 写文件，不靠对话记忆**——上下文压缩后或换 session 时能从文件重建状态。

## 浏览器连接

Chrome 136+ 不允许 `--remote-debugging-port` 配合默认 profile（安全限制）。sleuth 用 symlink profile 方案绕过：把日常 profile 符号链接到 `~/.sleuth/chrome-live/`，用 `--user-data-dir=~/.sleuth/chrome-live/ --remote-debugging-port=9222` 启动——路径字符串不同骗过检查，实际读写同一份 profile 数据，登录态 / 书签 / 历史全保留。

`node \"${CLAUDE_SKILL_DIR}/scripts/launch-chrome.mjs\"` 一键完成：杀 Chrome → 建 symlink → 重启 → 写 DevToolsActivePort → 输出连接变量。

check-deps 跑一遍检查环境。


## 长程任务行为

并行调研 / 跨多日任务必须遵守 3 条行为约束——针对认知循环、停滞、上下文压缩后循环静默死三种失败模式：

- **零交互**：运行中不中途停下问用户。遇到歧义自行决定（选最合理的解释），把决策写入报告的"假设与决策"段。只在 CHECKPOINT 触发或用户主动询问时才交互。
- **就绪即执行**：研究完准备交付时，直接交付，不要停下问"是否提交报告？"/"是否再查一点？"。提交、重搜、补验证都是常规操作，不需确认。
- **状态持久化**：中间记录（findings / gaps / red_flags / dimensions_seen / 已试方向）必须写到 `<outputDir>/` 的文件里，不靠对话记忆。上下文压缩后或换 session 时能从文件重建状态。

**反认知循环硬规则**：连续 2 轮搜索返回类似信息 → 强制换路（换来源类型 / 换工具 / 换角度），不在同一路径盲目重试。新方向必须与 `directions.json` 里已试方向不同。

## 运行边界

- 不提取 cookie、密码或其他敏感凭据。
- 不对敏感页面截图。
- 不绕过付费墙。
- 不执行会产生记录的状态变更操作，除非用户明确要求。
- 不把搜索摘要、二手搬运或 SEO 软文包装成一手事实。
- 不在同一条失败路径上盲目重试；没有新信息就换路。

🔴 **CHECKPOINT · 执行前确认**：任何会产生记录或状态变更的动作——提交表单、发帖/留言、下单付款、改后台配置、点"确认/删除"——**执行前必须先获用户明确同意**。只读浏览（打开、滚动、读取、对非敏感页截图）无需确认。拿不准会不会改状态时，先停下来问，不要替用户按下按钮。
替用户按下按钮。
