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

主 Agent 只做 **调度 + 合成**——派子 Agent 做研究、收 findings、写报告、派审查。**不亲手做研究**：不自己搜、不自己开浏览器、不自己截图。你脑子里的 URL 可能是错的（如记错某产品的官网域名），搜索子 Agent 的搜索结果比你的记忆可靠。研究由子 Agent 完成，主 Agent 用子 Agent 返回的 URL 和 findings 合成报告。

## 第 0 步：环境检查

**以下所有路径相对于本 SKILL.md 所在目录（即 skill 根目录）。** 你是正在读这份文档的 Agent——你知道它在哪。Bash 命令和文件引用都从 skill 根目录解析。

每次触发后第一件事，不跳过：

```bash
node scripts/check-deps.mjs
```

输出当前浏览器连接模式和环境变量（`SLEUTH_CDP_PORT` / `SLEUTH_CDP_WS`）。后续所有 agent-browser 命令带上这些变量。

**如果 check-deps 输出 “chrome: 未发现可连的浏览器”**——Chrome 没开 CDP 调试。跑 launch-chrome 脚本启动带调试端口的 Chrome（保留你的登录态）：

```bash
node scripts/launch-chrome.mjs
```

脚本做的事：杀 Chrome → 把日常 profile 符号链接到 `~/.sleuth/chrome-live/` → 用 `--remote-debugging-port=9222 --user-data-dir=~/.sleuth/chrome-live/` 重启（骗过 Chrome 136+ 的安全检查，保留登录态）→ 写 DevToolsActivePort → 输出 `SLEUTH_CDP_PORT` / `SLEUTH_CDP_WS`。

跑完后再跑一次 `check-deps.mjs` 确认连上了。没开调试的任务（纯 WebSearch / WebFetch 能搞定的轻任务）可以继续，但涉及浏览器操作的任务必须等连上了再跑。

## 第 1 步：判断任务复杂度

**轻任务**（直接答，不进 loop）：
- 1-2 次搜索能答完
- 问题边界清晰、单一来源即可

→ 直接答 + 必要时一次 WebFetch 验证一手来源（不拿搜索摘要当证据）。搜索策略、工具选择、失败兜底看 `references/search.md` §2-5。

**并行调研**（走 loop，满足任一）：
- 问题需要多源交叉验证（对比 / 调研 / 争议性话题 / 高风险领域）
- 涉及多个独立子主题
- 单次搜索后发现比预想复杂
- 需要多轮迭代才能收敛

→ 继续第 1.5 步。

## 第 1.5 步：侦察（Scout）

并行调研任务在写 task_spec 之前，先派 1 个侦察 Agent 做全局广度扫描：

```bash
node scripts/spawn-subagent.mjs \
  --role scout \
  --goal "<用户问题领域>" \
  --task-dir <outputDir>
```

侦察 Agent 做广度扫描（具体策略看 scout.md），返回 landscape.json（entities / perspectives / source_hints）。不做深度研究、不提取 claim。

**拿到 landscape.json 后**：基于它写 task_spec——子问题按 entities 和 perspectives 拆，不是凭你脑子里的知识猜。侦察发现的实体和来源是你拆题的依据。

## 第 2 步：初始化任务目录 + 写 task_spec.md

### 2.1 写 task_spec.md

任务目录路径是 `~/.sleuth/output/<task-name>/`（主 Agent 自己拼，不需要再跑 check-deps）。用 Write 工具写文件时目录会自动创建。
用 Write 工具写 `<outputDir>/task_spec.md`：

````markdown
# task_spec.md

## 用户问题（重写后）
<把用户模糊问题转成具体可研究的问题>

## 子问题（状态追踪）

每个子问题用 `- [ ]` 标记未完成，`- [x]` 标记已完成。
搜索过程中发现的 follow_up 问题挂载到对应子问题下作为子节点。

- [ ] 1. <子问题 1>
  - 来源类型：<官方/学术/新闻/...>
  - 完成标准：
    - min_sources: 2
    - min_t1: 1
    - required_fields: ["字段1", "字段2"]
    - max_age_days: 365
  - [ ] 1.1 <Round N follow_up 问题>（来自 search-X Round N）
  - [ ] 1.2 <Round N follow_up 问题>
- [ ] 2. <子问题 2>
  - 来源类型：<...>
  - 完成标准：
    - min_sources: <int>
    - min_t1: <int>
    - required_fields: ["..."]
    - max_age_days: <int>
- [ ] N. <后续新增的子问题>（来自 Round N follow_up 新增）
- [ ] N+1. <合并的子问题>（A + B 合并，来自 Round N follow_up）

## 全局完成标准
- 时间覆盖：<如"包含 2026 年内至少 2 个时间点">
- 反方视角：<如"至少 1 个批评性来源">
- 来源多样性：<如"至少 3 种来源类型">

## 完成标准说明

**子问题级（机械可判定）**：每个子问题的完成标准包含 4 个可计数字段，边界 Agent 和主 Agent 可自动判定该子问题是否完成：

| 字段 | 含义 | 默认值 |
|------|------|--------|
| `min_sources` | 最少独立来源数（按 URL 去重） | 2 |
| `min_t1` | 最少 T1 来源数（官方文档 / 监管文件 / 同行评议） | 1 |
| `required_fields` | 必须覆盖的具体字段列表（如 `["触发方式", "优先级规则", "冲突解决"]`），每个字段需被至少 1 条 finding 的 claim 或 dimensions_seen 覆盖 | []（无强制字段） |
| `max_age_days` | 来源最大天数（时效性要求——从当前日期往前算，所有 sources 的发布时间必须在此窗口内；无法确定发布时间则宽松处理，不因缺时间戳而判失败） | 365 |

**全局级（视野广度）**：边界 Agent 的 4 个维度（来源类型多样性 / 视角覆盖 / 时间覆盖 / 地域覆盖）+ 反方视角——回答"视野够不够"，与子问题级的"细节够不够"互补。

**默认完成标准**：如果主 Agent 不为某个子问题写具体字段，使用默认值（min_sources=2, min_t1=1, required_fields=[], max_age_days=365）。简单问题不需要重标准——默认值已经足够覆盖大多数场景。
````

**完成标准是终止判断的依据**——你在第 5 步对照它判断是否够。

拆解原则：子问题独立（不依赖彼此）；每个单一目标；数量等于复杂度，不为拆而拆。

### 2.2 task_spec 操作规则（每轮更新）

task_spec 不是写一次就不动——**每轮搜索 Agent 收齐后，主 Agent 更新 task_spec 状态**：

| 操作 | 什么时候做 | 规则 |
|------|-----------|------|
| **标记完成** | 子问题的 sources / T1 / required_fields / 时效性全部满足完成标准（见 §3.5 自动判定规则） | `[ ]` → `[x]`，注明 `✅ Round N` |
| **挂载 follow_up** | 搜索 Agent 返回了 follow_up_questions | 挂到发现的子问题下，编号 `1.1`、`1.2` |
| **新增子问题** | follow_up 发现全新实体（和已有子问题不相关） | 新编号接在最后，注明来源 |
| **合并子问题** | follow_up 的实体和已有子问题领域类似 | 合并编号，注明合并来源 |
| **标记 follow_up 解决** | findings 覆盖了 follow_up 的问题 | 子节点 `[ ]` → `[x]`，follow_ups.json `resolved: true` |

## 第 3 步：派搜索 Agent（每轮）

对每个子问题（或第 6 步里边界 Agent 建议的新方向）：

### 3.1 生成 prompt

```bash
node scripts/spawn-subagent.mjs \
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

把上一步输出的**整段 prompt 文本**作为子 Agent 的 prompt，用你的运行时子 Agent 派发工具派发。prompt 已自包含——绝对路径 + 安全边界 + 返回格式 + 启动检查清单一应俱全，不依赖运行时环境变量或 skill loader。

**运行时兼容性**：sleuth 子 Agent 通过纯文本 prompt 派发——子 Agent prompt 已自包含（绝对路径 + 安全边界 + 返回格式），理论上不绑定特定运行时。但**以下兼容性声明未经跨运行时实测，仅 Claude Code 已验证通过**。

| 运行时 | 就绪度 | 说明 |
|--------|--------|------|
| **Claude Code** | ✅ 已验证 | `task` 工具运行；21 项自动化测试通过 |
| **其他运行时** | ⚠️ 未实测 | prompt 文本可手动粘贴到子 Agent 对话；并行派发、env 继承、返回值格式均未在非 Claude Code 环境下验证 |

**如果你在非 Claude Code 运行时使用 sleuth**：子 Agent prompt 中的路径是绝对路径、CDP 端口已写为字面值——这是你能在新运行时快速验证的最小可用条件。欢迎反馈实测结果。

**每轮最多并行 5 个搜索 Agent。** 子问题 > 5 个时分两批：第一批先派 5 个，收齐 findings 后再派剩余的。不要一次性把 7-8 个全丢出去——模型后台任务系统扛不住，会静默丢 Agent。

**派发前必须设置子 Agent 的环境变量**：把第 0 步 check-deps 输出的 `SLEUTH_CDP_PORT`（和 `SLEUTH_CDP_WS` 如果有）作为环境变量传给子 Agent——子 Agent 的所有 agent-browser 命令依赖这个变量连浏览器。

搜索 Agent 会读 `references/search.md`（搜索逻辑 + 工具选择 + 失败兜底 + JSONL 返回格式）+ 通过 `--task-dir` 读已有 findings/directions 避免重复。

**子 Agent 健康监控**：派发后不要干等——周期性检查子 Agent 状态。Claude Code 的 task 系统会报告子 Agent 的运行状态。如果某个子 Agent 长时间无 progress 或进入 error 状态，**主动终止并立即用同参数重派一个新 Agent**。重试 2 次仍失败 → 将该子问题标记为 gap，在最终报告中说明"经多次尝试未获取，纳入已知限制"，不再阻滞 LOOP 推进。

### 3.3 收 stdout → 写 findings.jsonl

**收前先确认状态**：收集结果前，扫一遍所有派发的子 Agent——已完成的直接收结果；仍在正常运行中的继续等；已死亡/无响应的按上述规则终止重派。其他 Agent 的结果先处理，不被个别死 Agent 阻塞。

每个搜索 Agent 通过 stdout 返回 **JSONL**（每行一个 JSON 对象，格式见 `references/search.md` §4.3）。收齐后：

1. **逐行 parse（防截断）**：`try/catch` 逐行 `JSON.parse`。parse 成功的行进入归一化；parse 失败的行（截断 JSONL / 非 JSON 文本）写入 `<outputDir>/parse_errors.log` 后跳过，不阻塞整批处理。若某 Agent 超过 50% 的行 parse 失败 → 整个 Agent 结果丢弃，按 §3.2 健康监控规则重派。
2. **校验 + 归一化**（子 Agent 可能不严格遵守 §4.3 枚举，必须清洗后再写）：
   - `type` 不在 `finding` / `gap` / `red_flag` 里 → 强制改 `finding`（自定义类型如 `funding_round` / `valuation` 不保留）
   - `confidence` 不在 5 级枚举（`已验证事实` / `高置信推断` / `未确认线索` / `冲突信息` / `覆盖缺口`）里 → 按 tier 推断：T1/T2 → `高置信推断`，T3 → `未确认线索`
   - `tier` 是整数（`1`/`2`/`3`）或英文（`primary`/`secondary`/`tertiary`）→ 映射成 `"T1"` / `"T2"` / `"T3"`
   - `dimensions_seen` 是字符串数组（如 `["amount","date"]`）→ 转成对象数组 `[{"dimension":"<原值>","observation":""}]`
3. 给每条 finding 补充字段：`ts`（当前 ISO 时间戳）、`round`（当前轮次）、`agent`（你给的 agent 名）、`claim_id`（直接将 claim 文本归一化——lowercase + 去除所有标点 + 连续空白折叠为单空格 + 移除首尾空白。归一化后的字符串即为 claim_id，用于跨轮集合 diff 判断是否有新事实发现）
4. 用 Write 工具 append 到 `<outputDir>/findings.jsonl`
5. **提取 follow_up_questions**：从 findings 里提取所有 follow_up_questions，写入 `<outputDir>/follow_ups.json`（格式见「状态文件 schema」段）。下一轮派发时用作新方向依据。

**只有你写 findings.jsonl 和 follow_ups.json。** 子 Agent 不写文件——避免并发写撕行。

### 3.4 写 directions.json

每派一个搜索 Agent，把方向追加到 `<outputDir>/directions.json`（格式见「状态文件 schema」段）。

### 3.5 更新 task_spec 状态（每轮必做）

收完 findings + 提取 follow_ups 后，**更新 task_spec.md 的状态标记**：

1. **标完成**：对每个 `- [ ]` 子问题，对照其结构化完成标准（min_sources / min_t1 / required_fields / max_age_days）做 4 项判定：

   **判定步骤**（数学化，不靠直觉）：
   a. **来源数**：统计 findings.jsonl 中与该子问题相关的独立 URL 数 → ≥ min_sources？
   b. **T1 来源数**：其中 tier="T1" 的有几条 → ≥ min_t1？
   c. **required_fields 覆盖**：required_fields 里的每个字段，是否被至少 1 条 finding 的 claim 文本或 dimensions_seen 覆盖？**用 LLM 语义判断**——看 finding 实际讨论了什么，不是字符串匹配。例：required_field 是「定价模型」，finding claim 写「按请求量阶梯计费，超出免费额度后 $0.01/1K tokens」→ 语义上覆盖了「定价模型」，即便这四个字没出现在 claim 里。**不做纯关键词 grep**。
   d. **时效性**：所有相关 finding 的 ts 字段是否在 max_age_days 窗口内？（无法确定 ts 的 finding 不因时效性被判失败——宽松处理）

   4 项全部通过 → 改 `- [x]` + 注明 `✅ Round N`。任一项未通过 → 保持 `- [ ]`，记录未达标项（如 `sources: 1/2, T1: 0/1`）以便第 6 步派发时作为新方向依据。
2. **挂载 follow_ups**：把 follow_up_questions 挂到发现它的子问题下作为子节点（`1.1`、`1.2`）
3. **新增/合并**：全新实体 → 新编号接最后；和已有类似 → 合并编号
4. **标 follow_up 解决**：已解决的 follow_up 子节点 `- [ ]` → `- [x]` + follow_ups.json `resolved: true`

**这步在派边界 Agent 之前做**——边界 Agent 读更新后的 task_spec 判断完成度。
## 第 4 步：派边界 Agent

每轮搜索 Agent 收齐后，派一个边界 Agent 评估覆盖度：

```bash
node scripts/spawn-subagent.mjs \
  --role boundary \
  --goal "评估覆盖度" \
  --task-dir <outputDir>
```

边界 Agent 读 `task_spec.md` + `findings.jsonl` + `follow_ups.json`，返回 `terminate_recommended` + `uncovered_dimensions` + `direction_drift` + `entity_mismatch` + `follow_ups_unresolved`（判定规则和输出格式见 `references/boundary.md`）。

## 第 5 步：检查终止信号

**前置条件**：task_spec 所有子问题（含子节点）必须标 `[x]`——即每个子问题的 4 项结构化完成标准（min_sources / min_t1 / required_fields / max_age_days）已全部满足。有 `- [ ]` 的子问题 → 直接回第 6 步，不检查其他终止条件。

前置条件满足后，检查：

**1. 收敛检查（信息增益信号）**— 从 findings.jsonl 按 round 分组提取 claim_id 集合，计算：
- `C_r` = 本轮所有 claim_id
- `N_r` = `|C_r \ 前几轮的并集|`（本轮纯新增数）
- `novelty_r` = `N_r / |C_r|`（本轮新颖比）
- 累积集 `H_r` = 本轮及之前所有 claim_id 的并集

满足以下任一收敛条件即进第 7 步：
- **硬饱和（Rule A）**：连续 2 轮 `N_r = 0`，且总轮数 ≥ 3
- **递减收益（Rule B）**：总轮数 ≥ 5，且最近 3 轮 `N_r` 非递增，且当前轮 `N_r ≤ 2`，且 `novelty_r < 0.20`

Rule A 或 Rule B 触发时，输出可解释的终止消息——"连续 2 轮无新增事实"或"发现速率已连续 3 轮衰减（X→Y→Z），当前轮仅发现 N 个新事实（新颖比 P%），信息空间接近穷尽"。**收敛检查是安全网——正常任务 3-5 轮由软终止退出，不会触发。**

**1b. 硬兜底（Panic Stop）**：总轮数达 `SLEUTH_MAX_ROUNDS`（默认 20）→ 强制进第 7 步，合成时标注 "WARNING: 轮次硬上限已达（N 轮），以下维度可能未充分覆盖" + 未覆盖子问题清单。**这是最后的降落伞——收敛检查失效时才触发，正常任务永远碰不到。** `SLEUTH_MAX_ROUNDS` 环境变量允许用户按需调整。

**2. 软终止（边界 Agent）**：`terminate_recommended: true` + 无 entity_mismatch + follow_ups_unresolved = 0 → 进第 7 步

**3. 用户终止**：CHECKPOINT → 停

不终止 → 第 6 步。

## 第 6 步：混合派发 + 下一轮

按优先级分配 ≤5 个 Agent 名额：

| 优先级 | 类型 | 名额 | 来源 |
|--------|------|------|------|
| **P1 垂直深挖** | 解决 follow_ups | 1-2 个 | follow_ups.json 里 `resolved: false` 的子节点 |
| **P2 广度推进** | 覆盖未完成子问题 | 3-4 个 | task_spec 里还是 `- [ ]` 的子问题 |

**分配规则**：
- 有未解决 follow_ups：P1 拿 1-2 个，P2 拿剩余
- 无未解决 follow_ups：全部给 P2（广度推进）
- task_spec 全 `[x]` 但 boundary 说 coverage 不够：全部给 P1（深挖新来源类型）

**派发步骤**：
1. 确定本轮 P1/P2 分配（上面规则）
2. P1 Agent 的 `--known-clue` 带入 follow_up 问题原文
3. P2 Agent 的 `--known-clue` 带入 scout 的 source_hints 对应实体 URL
4. **查 directions.json 避免重复**
5. 追加新方向到 directions.json
6. 回第 3 步（派搜索 Agent，`--round` 递增）

**loop 持续迭代直到终止信号触发。** 正常任务 3-5 轮边界 Agent 软终止自然收敛；当软终止持续未触发但信息增益已枯竭时，收敛检查（Rule A / Rule B）作为安全网兜底终止。

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
node scripts/spawn-subagent.mjs \
  --role review \
  --goal "审计报告" \
  --task-dir <outputDir> \
  --draft-path <outputDir>/draft.md
```

审查 Agent 返回 `audit_findings` + `sampled_stats`（审计规则看 `references/review.md`）。

### 7.8 审计结果处理

审计 Agent 返回 critical + non_critical + sampled_stats（审计规则看 `references/review.md`）。

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

**图文并茂（按 query 类型）**：产品对比 / 设计 / 图表解读 / 评测类报告，必须图文并茂——呈现型图片按 `references/search.md` §6.2 流程归档并内嵌。纯事实 / 政策类不强求。证据型图片只附 URL + 标注“视觉分析”。

## 状态文件 schema

### 文件总表

```
<outputDir>/
├── landscape.json      # 侦察 Agent 产出（Phase 1.5）
├── task_spec.md       # 你写 / 你 + 边界 Agent + 搜索 Agent 读
├── findings.jsonl     # 你代写 / 你 + 边界 Agent + 审查 Agent 读
├── follow_ups.json    # 你写 / 你 + 边界 Agent 读（搜索 Agent 返回的追踪问题）
├── directions.json    # 你写 / 你 + 搜索 Agent 读
├── draft.md           # 你写 / 你 + 审查 Agent 读
├── screenshots/       # 搜索 Agent 截图存这里（agent-browser 截图搬到这里）
└── audit_report.yaml  # 审查 Agent 产出（Phase 8，YAML schema）
```

| 文件 | 写者 | 读者 | 格式 |
|---|---|---|---|
| `landscape.json` | 侦察 Agent | 你（写 task_spec 用） | JSON 对象（见 scout.md） |
| `task_spec.md` | 你 | 你 + 边界 Agent + 搜索 Agent（`--task-dir`） | Markdown（见第 2.1 步） |
| `findings.jsonl` | 你（代写，子 Agent stdout 返回） | 你 + 边界 Agent + 审查 Agent | JSONL（见下文） |
| `follow_ups.json` | 你（从 findings 提取） | 你 + 边界 Agent | JSON 数组（见下文） |
| `directions.json` | 你 | 你 + 搜索 Agent（`--task-dir`） | JSON 数组（见下文） |
| `draft.md` | 你 | 你 + 审查 Agent（`--draft-path`） | Markdown |
| `screenshots/` | 搜索 Agent（截图后搬到这里） | 你（嵌 draft） | PNG 文件 |
| `audit_report.yaml` | 审查 Agent | 你（修 draft 用） | YAML（critical/non_critical） |

### findings.jsonl 行格式

```jsonl
{"ts":"2026-06-19T12:34:56Z","round":1,"agent":"search-2","claim_id":"anthropic claude api input pricing $3/m tokens","claim":"Anthropic Claude API 输入定价 $3/M tokens","url":"https://www.anthropic.com/pricing","confidence":"已验证事实","tier":"T1"}
```

字段：
- `ts`: ISO 时间戳（你代写时注入）
- `round`: loop 轮次（你派发时传入；用于第 5 步硬终止判定）
- `agent`: 你给的 agent 名（如 `search-2`）
- `claim_id`: claim 文本归一化后的字符串——lowercase + 去除标点 + 连续空白折叠为单空格 + 移除首尾空白。不含 url_domain。同一事实被不同网站报道产生相同 claim_id，用 claim_id 集合 diff 判是否仍有新事实发现
- `claim` / `url` / `confidence` / `tier`: 见 §7.3 证据分层


### follow_ups.json 格式

```json
[
  {"round":1,"from_agent":"search-3","question":"竞品 X 是否也有类似机制？","resolved":false},
  {"round":2,"from_agent":"search-1","question":"该平台的规则引擎如何与外部系统集成？","resolved":false}
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
- `direction` 相似 → 判断实质是否重复——两次搜索是否大概率产出重叠结果。若高度重叠，即使 `source_type` 不同也视为重复，换角度而非换标签

**state 写文件，不靠对话记忆**——上下文压缩后或换 session 时能从文件重建状态。恢复流程见下方「Session Recovery」段。

## Session Recovery（从文件重建研究进度）

上下文压缩后或换 session 重新进入时，如果 `<outputDir>/task_spec.md` 存在但你没有任何记忆——按以下步骤恢复进度，不重头来：

**1. 找到任务目录**：最新修改过的 `~/.sleuth/output/<name>/task_spec.md` 即为上次任务。读 task_spec.md 获取子问题完成状态。

**2. 推断轮次**：
- 读 `findings.jsonl` → 取 `max(round)` = **最后完成的轮**
- 读 `directions.json` → 取 `max(round)` = **最后派出的轮**
- 如果 `directions.max > findings.max`：存在"已派未收"的飞行 Agent → 找不到原 Agent（新 session 无旧 task 句柄），**整轮重派**
- 如果 `directions.max == findings.max`：该轮已收齐 → 按 task_spec 的 `[ ]` 状态正常推进

**3. 恢复 Phase**：
- 有 `draft.md` → 进入或已完成 Phase 7（合成）
- 有 `audit_report.yaml` → 检查 `passed`。`true` → 进 Phase 9（交付）；`false` + critical 非空 → 进 Phase 3（重搜），审计计数 +1
- 无 draft.md 但有 task_spec → 检查边界条件（Phase 5），不满足则进 Phase 3/6

**4. 审计计数**：从 `audit_report.yaml` 存在的份数推断。若缺失 → 默认 0。审计回 LOOP 上限 3 次，溢出由 panic stop 兜底。

**5. 已知限制**：
- **飞行中的 findings 永久丢失**——Agent 返回了但没写入文件时，那批结果在新 session 中不可恢复。这是设计取舍（子 Agent 不写文件以防止并行撕裂）。重派可复现大部分证据。
- **revision 计数偏差**——若恰在审计判定后、写入前中断，可能多/少一轮。后果不超过 1 轮浪费，由 `SLEUTH_MAX_ROUNDS` 兜底。
- **需要用户主动恢复**——新 session 主 Agent 不知道曾经有 sleuth 任务。用户说"继续上次的研究"即可触发此流程。

恢复的总原则：**宁可多搜一轮，不遗漏。** 状态不确定时按保守策略——`[ ]` 覆盖 `[x]`。

## 浏览器连接

Chrome 136+ 不允许 `--remote-debugging-port` 配合默认 profile（安全限制）。sleuth 用 symlink profile 方案绕过：把日常 profile 符号链接到 `~/.sleuth/chrome-live/`，用 `--user-data-dir=~/.sleuth/chrome-live/ --remote-debugging-port=9222` 启动——路径字符串不同骗过检查，实际读写同一份 profile 数据，登录态 / 书签 / 历史全保留。

`node scripts/launch-chrome.mjs` 一键完成：杀 Chrome → 建 symlink → 重启 → 写 DevToolsActivePort → 输出连接变量。

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
