# 边界评估

评估已有 findings 的 task_spec 完成度 + 覆盖质量 + 方向有效性 + 实体准确性，输出终止建议 + 未覆盖项 + 问题清单。

读 `task_spec.md`（子问题 + **状态标记 `[ ]`/`[x]`** + 完成标准）+ `findings.jsonl`（已验证事实 + dimensions_seen）+ `follow_ups.json`（未解决的追踪问题），输出以下 schema。

## 检查维度


### 0. task_spec 完成度（Task Spec Completion）

读 task_spec 的状态标记 `- [ ]` / `- [x]` + **每个子问题的结构化完成标准**——完成标准包含 4 个可计数字段：

| 字段 | 含义 | 默认值 |
|------|------|--------|
| `min_sources` | 最少独立 URL 数 | 2 |
| `min_t1` | 最少 T1 来源（官方/监管/同行评议） | 1 |
| `required_fields` | 必须覆盖的字段列表 | [] |
| `max_age_days` | 来源最大天数 | 365 |

如果子问题未显式声明完成标准，使用默认值。

**自动判定每个子问题**（按以下规则逐一检查）：
- **来源数**：统计 findings.jsonl 中与该子问题相关的独立 URL 数 → ≥ min_sources？
- **T1 来源数**：其中 tier="T1" 的有几条 → ≥ min_t1？
- **required_fields 覆盖**：每个 required_field 是否被至少 1 条 finding 的 claim 或 dimensions_seen 覆盖？**用 LLM 语义判断**——看 finding 实际讨论了什么，不是字符串匹配。例：required_field「定价模型」，finding claim「按请求量阶梯计费，超出免费额度后 $0.01/1K tokens」→ 语义覆盖 ✓，即便「定价模型」四字没出现在 claim 里。
- **时效性**：所有相关 finding 的 ts 是否在 max_age_days 窗口内？（缺 ts 宽松处理，不判失败）

对已标 `[x]` 的子问题同样做 4 项检查——`[x]` 不代表跳过，边界 Agent 独立验证每项完成标准是否被 findings 证据支撑。若 `[x]` 与 evidence 不一致，列入 `uncovered_subquestions`。

4 项全过 → 该子问题可标 `[x]`。任一项未过 → 子问题未完成。

- 有 `- [ ]` 的子问题 → **task_spec 未全覆盖，强制不终止**
- 输出 `uncovered_subquestions`：列出所有还是 `[ ]` 的子问题编号和标题，**注明具体哪个标准未达标**（如 `"sources: 1/2, T1: 0/1, required_fields: [触发方式] 未覆盖"`）

**子问题归属判定**：如何将一个 finding 归属到某个子问题？按 finding 的 claim 文本与子问题标题/required_fields 的关键词匹配度——匹配度最高的子问题即为归属。一条 finding 可以归属多个子问题。
### 1. 覆盖度（Coverage）

| 维度 | 问什么 |
|------|--------|
| **来源类型多样性** | 只看了官方？缺第三方/社区/学术？ |
| **视角覆盖** | 反方观点有没有？小众来源（HN/Reddit/小博客）有没有？还是只有大媒体？ |
| **时间覆盖** | 历史对比有没有？还是只查了最近？时间戳是否齐全？ |
| **地域/语境覆盖** | 只查了中美？其他市场视角有没有？ |

### 2. 方向偏移（Direction Drift）

已搜方向有没有偏离 task_spec 目标？
- 读 `directions.json` + `findings.jsonl`
- findings 里的 claim 是否和子问题相关？
- claim 内容和子问题主题不相关 > 30% → 标记 drift

### 3. 实体准确（Entity Accuracy）

findings 里 claim 提到的实体名和 URL 域名是否匹配？
- claim 提到产品 A 的功能但 URL 却是产品 B 的官网 → entity_mismatch
- 这是防止搜索 Agent 开错门的最后防线

### 4. Follow-ups 状态

`follow_ups.json` 里有 `resolved: false` 的问题吗？
- 有未解决的 follow-up → 覆盖不完整 → 不推荐终止

## 可扩展维度（任务相关时加，不强制）

- 价格/合同条款（调研商业产品）
- 安全/合规（SaaS / API 调研）
- 性能基准（技术方案调研）
- 法务/监管（金融/医疗调研）
- 可信度/权威性（学术/政策调研——评估来源权威级别与论据可信度）
- 可重现性/方法学（学术调研——评估方法论、样本、复现性）
- 集成/互操作（API/平台对比——评估与上下游系统的衔接）
- 社区生态/采用度（技术选型——GitHub stars、Slack/Discord 活跃、采用规模）

## 输出 schema

```yaml
terminate_recommended: <bool>
uncovered_subquestions:
  - id: <子问题编号，如 "3" 或 "1.1">
    title: <子问题标题>
    reason: <为什么没覆盖>
uncovered_dimensions:
  - dimension: <维度名>
    priority: high | medium | low
    rationale: <为什么这个维度对回答用户问题重要>
    suggested_direction: <下一波搜索该往哪搜>
direction_drift:
  - direction: <已搜方向>
    problem: <偏离了 task_spec 的哪个子问题>
    suggested_fix: <应该搜什么>
entity_mismatch:
  - claim: <claim 内容>
    url: <实际 URL>
    expected_entity: <预期实体名>
    actual_title: <页面实际 title>
follow_ups_unresolved: <int>
```

## terminate_recommended 判定规则

- 有 uncovered_subquestions（task_spec 有 `[ ]`）→ **强制不终止**
- 有 entity_mismatch → **强制不终止**（必须修实体再走）
- follow_ups_unresolved > 0 → **不终止**（有未解决问题）
- 任一 uncovered priority 为 `high` → `terminate_recommended: false`
- task_spec 全 `[x]` + 无 mismatch + 无 drift + follow_ups = 0 + 所有 uncovered priority 均为 `low` 且 ≤ 2 → `terminate_recommended: true`
- 其他情况 → 自行判断并给 rationale

## 不做

- 不搜新内容（只读已有 findings 做覆盖度判断）
- 不审证据准不准（那是审计 Agent 的活）
- 不返回 findings / gaps
