# 边界评估

评估已有 findings 的覆盖度 + 方向有效性 + 实体准确性，输出终止建议 + 未覆盖维度 + 问题清单。

读 `task_spec.md`（子问题 + 完成标准）+ `findings.jsonl`（已验证事实 + dimensions_seen）+ `follow_ups.json`（未解决的追踪问题），输出以下 schema。

## 检查维度

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
- claim 说 "Windsurf 界面" 但 URL 是 devin.ai → entity_mismatch
- 这是防止搜索 Agent 开错门的最后防线

### 4. Follow-ups 状态

`follow_ups.json` 里有 `resolved: false` 的问题吗？
- 有未解决的 follow-up → 覆盖不完整 → 不推荐终止

## 可扩展维度（任务相关时加，不强制）

- 价格/合同条款（调研商业产品）
- 安全/合规（SaaS / API 调研）
- 性能基准（技术方案调研）
- 法务/监管（金融/医疗调研）

## 输出 schema

```yaml
terminate_recommended: <bool>
uncovered_dimensions:
  - dimension: <维度名，必须 4 固定维度或已声明扩展名>
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

- 有 entity_mismatch → **强制不终止**（必须修实体再走）
- follow_ups_unresolved > 0 → **不终止**（有未解决问题）
- 任一 uncovered priority 为 `high` → `terminate_recommended: false`
- 所有 uncovered priority 均为 `low` 且 ≤ 2 且无 mismatch 且无 unresolved follow_ups → `terminate_recommended: true`
- 其他情况（混合 low/medium 或数量 > 2）→ 自行判断并给 rationale

## 不做

- 不搜新内容（只读已有 findings 做覆盖度判断）
- 不审证据准不准（那是审计 Agent 的活）
- 不返回 findings / gaps
