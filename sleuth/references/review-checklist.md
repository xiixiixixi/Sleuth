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

## 输出格式

```
- coverage: 已答问题 / 未答问题 / 已覆盖视角 / 缺失视角
- weak_claims: 单一来源或低可信度结论
- missing_perspectives: 未覆盖视角
- red_flags: 危险信号（critical / warning）
- is_enough: true / false
- patch_tasks: （false 时）具体补查任务，指向明确缺口
```

## 硬判定

```
red_flags 有 critical 项        → is_enough=false
关键问题未答                    → is_enough=false
核心结论无来源 URL              → is_enough=false
以上都通过                      → is_enough=true
```

## Patch 规则

1. 只针对具体缺口补查，不重复泛搜
2. Patch 后必须再派审查 subagent 复审
3. 最多 2 轮 Patch。超过后进入 Deliver 并披露
4. Patch 由搜索探针执行（复用探针模板，scope 限定缺口）

必须 Patch：关键问题未答、critical red flag、核心结论单一来源且影响决策。
可以不 Patch 但必须披露：信息不可得、用户要求快速、缺口不影响核心。
