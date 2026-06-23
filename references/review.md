# 证据链审计

审计报告草稿的证据链。不补 gap、不重走搜索循环，但允许 WebFetch 验证已有 URL（验证 ≠ 重做研究）。

## 4 项审计

| 审计项 | 怎么审 | 失败时怎么报 |
|---|---|---|
| **缺源 claim（全扫）** | grep 草稿找没有 `[xxx](url)` 内联 URL 的结论行——全扫，不抽样 | 列出缺源 claim 清单 + 建议补查或删除 |
| **幻觉 URL（分层抽样）** | 按 Tier 分层抽样验证 URL 真实存在且包含所述内容。逐个 WebFetch | 列出幻觉 URL 清单 + 建议 finding 标记为「未验证」 |
| **抹平冲突** | 读 findings 和草稿，看是否所有冲突都被明示（A 源说 X，B 源说 Y 是否被列出） | 列出被抹平的冲突 + 建议回合成阶段补充 |
| **可信度分级错误** | 对照下方 5 级可信度定义，看草稿里的分级是否合理 | 列出错误分级 + 建议修正 |

## Tier 分级（幻觉 URL 抽样依据）

| Tier | 常见来源 | 幻觉风险 | 抽样率 |
|---|---|---|---|
| **Tier 1** | 官方文档、官方博客、监管文件（.gov / SEC / 同行评议） | 最低 | 抽 5-10 个 |
| **Tier 2** | 行业分析、第三方评测、GitHub README / issues、成熟评论站 | 中等 | 抽 50% |
| **Tier 3** | 搜索摘要、SEO 文、未署名新闻稿、单条论坛评论 | 最高 | 100% 全扫 |

## 5 级可信度（分级审计依据）

```
已验证事实  ← 多个独立源一致 + T1 来源
高置信推断  ← 单源 + T1/T2 来源
未确认线索  ← 单源 + T3 来源，或标了 red_flag
冲突信息    ← 源之间矛盾
覆盖缺口    ← 所有 gaps 汇总
```

审计"可信度分级错误"时对照以上定义。如：单源 + T3 来源不应标"已验证事实"。

## 输出 schema

```yaml
audit_findings:
  hallucinated_urls:
    - url: <URL>
      finding_ref: <对应 finding 的 claim_id 或描述>
      evidence: <WebFetch 返回的实际情况>
  smoothed_conflicts:
    - conflict: <被抹平的冲突描述>
      sources: [A 源 URL, B 源 URL]
  unsupported_claims:
    - claim: <草稿里的结论>
      location: <在草稿里的位置>
  miscategorized_confidence:
    - claim: <分级错误的结论>
      current: <草稿标的级别>
      suggested: <应该的级别>
      reason: <为什么>
  sampled_stats:
    total_t3: <int>
    sampled_t3: <int>
    total_t2: <int>
    sampled_t2: <int>
    total_t1: <int>
    sampled_t1: <int>
```

## 不做

- 不补 gap、不重走搜索循环（但允许 WebFetch 验证已有 URL）
- 不重写报告（只指出问题，修是主 Agent 的事）
- 不评估覆盖度（那是边界评估的事）
