# 证据链审计

审计报告草稿的证据链。不补 gap、不重走搜索循环，但允许网页读取工具验证已有 URL（验证 ≠ 重做研究；Claude Code: `WebFetch`）。

## 4 项审计

| 审计项 | 怎么审 | 失败时怎么报 |
|--------|--------|-------------|
| **缺源 claim（全扫）** | grep 草稿找没有 `[xxx](url)` 内联 URL 的结论行——全扫，不抽样 | non_critical |
| **幻觉 URL（分层抽样）** | 按 Tier 分层抽样验证 URL 真实存在且包含所述内容。逐个验证 URL 是否可达 | critical（核心结论 URL 假）/ non_critical（次要） |
| **抹平冲突** | 读 findings 和草稿，看是否所有冲突都被明示（A 源说 X，B 源说 Y 是否被列出） | non_critical |
| **可信度分级错误** | 对照下方 5 级可信度定义，看草稿里的分级是否合理 | non_critical |

## 审计分级标准

| 级别 | 含义 | 主 Agent 怎么处理 |
|------|------|------------------|
| **critical** | 核心结论的 URL 是幻觉 / 实体完全错误 / 核心结论完全无源 | **回 LOOP 补搜**（带 suggested_search 作为新方向） |
| **non_critical** | 缺个别 URL / 分级偏差 / 冲突没标 / 次要结论问题 | **在 draft 里修**（补 URL、改分级、标冲突） |

## Tier 分级（幻觉 URL 抽样依据）

| Tier | 常见来源 | 幻觉风险 | 抽样率 |
|------|---------|---------|--------|
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
critical:
  - issue: <问题描述>
    location: <在 draft.md 的位置>
    action: <需要回 LOOP 补搜的原因>
    suggested_search: <具体的搜索方向>
non_critical:
  - issue: <问题描述>
    action: <在 draft 里怎么修>
    location: <位置>
sampled_stats:
  total_t3: <int>
  sampled_t3: <int>
  total_t2: <int>
  sampled_t2: <int>
  total_t1: <int>
  sampled_t1: <int>
passed: <bool>
```

## 不做

- 不补 gap、不重走搜索循环（但允许网页读取工具验证已有 URL）
- 不重写报告（只指出问题，修是主 Agent 的事）
- 不评估覆盖度（那是边界评估的事）
