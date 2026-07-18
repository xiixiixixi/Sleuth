# 证据链审计

审计报告草稿的证据链。不补 gap、不重走搜索循环，但允许网页读取工具验证已有 URL（验证 ≠ 重做研究）。

## 5 项审计

| 审计项 | 怎么审 | 失败时怎么报 |
|--------|--------|-------------|
| **缺源 claim（全扫）** | grep 草稿找没有 `[xxx](url)` 内联 URL 的结论行——全扫，不抽样 | non_critical |
| **幻觉 URL（分层抽样）** | 按 Tier 分层抽样验证 URL 真实存在且包含所述内容。逐个验证 URL 是否可达 | critical（核心结论 URL 假）/ non_critical（次要） |
| **抹平冲突** | 读 findings 和草稿，看是否所有冲突都被明示（A 源说 X，B 源说 Y 是否被列出） | non_critical |
| **可信度分级错误** | 对照下方 5 级可信度定义，看草稿里的分级是否合理 | non_critical |
| **视觉证据（全扫）** | 逐张核对 visuals：图片能打开、本地文件存在、来源页匹配、图注说明用途、图像与结论相关，并且全部已嵌入草稿；装饰图不得充数 | 核心图虚假或错配为 critical；漏图、缺图注、无来源为 non_critical |

## 审计分级标准

| 级别 | 含义 | 主 Agent 怎么处理 |
|------|------|------------------|
| **critical** | 核心结论的 URL 是幻觉 / 实体完全错误 / 核心结论完全无源 | **回 LOOP 补搜**（带 suggested_search 作为新方向） |
| **non_critical** | 缺个别 URL / 分级偏差 / 冲突没标 / 次要结论问题 | **重派合成 Agent 修 draft**，修完重新审计 |

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

草稿可以引用 red_flag 的结构化 `sources` 来解释“旧版、冲突或不可靠来源为什么被排除”，但句子必须明确保持否定或限制语义，绝不能把 red_flag 当成当前事实。

## 输出 schema

写入任务目录的 `audit-report.json`：

```json
{
  "schema_version": 2,
  "critical": [
    {"issue":"问题描述","location":"draft 位置","action":"为什么要回 LOOP","suggested_search":"具体方向"}
  ],
  "non_critical": [
    {"issue":"问题描述","location":"draft 位置","action":"合成 Agent 怎么修"}
  ],
  "sampled_stats": {
    "total_t3": 0, "sampled_t3": 0,
    "total_t2": 0, "sampled_t2": 0,
    "total_t1": 0, "sampled_t1": 0
  },
  "visual_audit": {
    "total": 0,
    "checked": 0,
    "embedded": 0,
    "missing": [],
    "orphan": []
  },
  "passed": false
}
```

当 `stats-summary.json.total_visuals > 0` 时，`visual_audit` 必须出现，而且视觉证据 100% 全查。`missing` 记录 findings 已登记但草稿没放的图；`orphan` 记录草稿出现但 findings 没登记的图。两者不为空时禁止 `passed:true`。没有视觉证据时可以省略 `visual_audit`。

只有 `critical` 和 `non_critical` 都为空时，`passed` 才能是 `true`。JSON 必须可以被 `JSON.parse` 直接读取，禁止输出注释、代码围栏或额外文字。

## 不做

- 不补 gap、不重走搜索循环（但允许网页读取工具验证已有 URL）
- 不重写报告（只指出问题，修是主 Agent 的事）
- 不评估覆盖度（那是边界评估的事）
