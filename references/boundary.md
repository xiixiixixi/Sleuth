# 边界评估

评估已有 findings 的覆盖度，输出未覆盖维度清单 + 终止建议。

读 `task_spec.md`（子问题 + 完成标准）+ `findings.jsonl`（已验证事实 + dimensions_seen），输出以下 schema。

## 4 固定维度（必须过，不允许省略）

| 维度 | 问什么 |
|---|---|
| **来源类型多样性** | 只看了官方？缺第三方/社区/学术？ |
| **视角覆盖** | 反方观点有没有？小众来源（HN/Reddit/小博客）有没有？还是只有大媒体？ |
| **时间覆盖** | 历史对比有没有？还是只查了最近？时间戳是否齐全？ |
| **地域/语境覆盖** | 只查了中美？其他市场视角有没有？ |

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
```

## terminate_recommended 判定规则

- 所有 uncovered_dimensions 的 priority 均为 `low` 且数量 ≤ 2 → `terminate_recommended: true`
- 任一 priority 为 `high` → `terminate_recommended: false`
- 其他情况（混合 low/medium 或数量 > 2）→ 自行判断并给 rationale

## 不做

- 不搜新内容（只读已有 findings 做覆盖度判断）
- 不审证据准不准
- 不返回 findings / gaps
