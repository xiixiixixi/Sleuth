# 审查清单

本文档是审查 subagent 的参考标准。审查 subagent 是只读、无浏览器的独立审查员，评估交付物覆盖度。

主 Agent 不自审 — 搜索过程的沉没成本导致判断偏差。

## 输入

审查 subagent 通过 Read 获取：
- 主 Agent 提供的**问题清单 + 成功标准**（Frame 阶段产出）
- `deliver list --sid $SID` 获取的交付文件，逐个 Read

## 必查项

| # | 检查项 | 关注点 |
|---|--------|--------|
| 1 | 问题覆盖 | 逐条对照 Frame 清单：已答？未答？ |
| 2 | 来源强度 | 核心结论是否只有单一来源？需至少两个独立来源 |
| 3 | 视角覆盖 | 官方、用户、竞品、负面/反证 — 哪些没覆盖？ |
| 4 | Red Flags | 矛盾信息、品牌冲突、过时数据、来源不可信（critical/warning） |
| 5 | 时效性 | 价格、版本、团队、政策是否够新？ |
| 6 | 规划质量 | Frame 的关键假设是否被验证或推翻？是否发现 Frame 未预见的重要维度？ |

## 规划质量判定（第 6 项）

审查 subagent 必须回答：

1. **假设验证**：Frame 中的核心假设（实体身份、问题前提、用户意图推断）是否被搜索结果证实？如果被推翻，标记 `needs_reframe=true`。
2. **新维度发现**：搜索过程中是否出现了 Frame 完全没预见到的重要维度？如果是且影响核心结论，标记 `needs_reframe=true`。
3. **Scout 回溯**：Scout 发现的信息地形与实际搜索结果是否一致？差异大则说明 Scout 质量不够。

`needs_reframe=true` 时，输出中必须包含 `reframe_reason` 字段说明为什么原始 Frame 需要重新定义。

## 输出格式

```
- coverage: 已答问题 / 未答问题 / 已覆盖视角 / 缺失视角
- weak_claims: 单一来源或低可信度结论
- missing_perspectives: 未覆盖视角
- red_flags: 危险信号（critical / warning）
- planning_quality: Frame 假设验证状态 + 新维度发现
- needs_reframe: true / false
- reframe_reason: （needs_reframe=true 时）重新定义的原因
- is_enough: true / false
- patch_tasks: （false 时）具体补查任务，指向明确缺口
```

## 硬判定

```
red_flags 有 critical 项        → is_enough=false
关键问题未答                    → is_enough=false
核心结论无来源 URL              → is_enough=false
needs_reframe=true              → is_enough=false（触发 Reframe 而非 Patch）
以上都通过                      → is_enough=true
```

## Patch 规则

1. 只针对具体缺口补查，不重复泛搜
2. Patch 后必须再派审查 subagent 复审
3. 最多 2 轮 Patch。超过后进入 Deliver 并披露
4. Patch 由搜索探针执行（复用探针模板，scope 限定缺口）

必须 Patch：关键问题未答、critical red flag、核心结论单一来源且影响决策。
可以不 Patch 但必须披露：信息不可得、用户要求快速、缺口不影响核心。
