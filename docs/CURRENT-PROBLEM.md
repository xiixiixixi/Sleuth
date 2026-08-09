# 当前核心问题：跨 Agent 深度如何形成

> 更新：2026-07-18；状态：代码闭环已完成，7 种类型的自动端到端验收和一个真实两轮对比任务均已通过。

## 一句话结论

搜索 Agent 仍然“做完就走、互不通信”，但 Boundary 会把前序结论压缩成带证据编号的线索，主 Agent 把线索注入下一轮；下一轮再用 `context_links` 证明自己确实基于前序结论继续研究。

这保留了原来的独立文件协作形式，同时解决“每个 Agent 只能产出孤立事实”的问题。

## 1. 原问题

不同研究任务的“深”并不一样：

| 类型 | 深度要求 |
|---|---|
| comparison | 跨实体比较差异 |
| deep_dive | 一层基于一层继续下钻 |
| timeline | 事件顺序和后果链 |
| causal | 多角度解释和反证 |
| problem_solving | 多解法、适用条件和边界 |
| enumeration | 已有成员基础上继续补漏 |
| debate | 正反观点都被看见并有证据 |

单一并行搜索流程无法自然产生以上关系。根因不是 Agent 数量不够，而是每个 Agent 看不到其他 Agent 的发现。

## 2. 当前解法

```text
Round 1 搜索 Agent 写 raw
→ normalize 重建 findings
→ Boundary 读取全局证据
→ 写 3-5 条 cross_agent_hints + source_claim_keys
→ inject-hints 生成下一轮 --known-clue
→ Round 2 搜索 Agent 使用线索
→ finding 写 context_links 指回 Round 1 claim_key
→ check-depth 按 task_type 检查关系
```

Boundary 被复用为轻量分析角色，没有增加第 6 个 Agent。原因是它本来就要读取全局 findings、判断缺口和决定下一轮方向；线索提炼是同一次阅读的第二个产出。

## 3. 7 种类型如何落地

| task_type | Boundary 注入什么 | Round 2 证据关系 |
|---|---|---|
| comparison | 其他实体在同维度的结论 | `compares` |
| deep_dive | 上一层发现与未挖透的 gap | `extends` |
| timeline | 前一事件与待追后果 | `follows` / `causes` |
| causal | 已有解释角度和缺失角度 | `causes` / `complements` / `contradicts` |
| problem_solving | 已有解法和适用边界 | `bounds` / `compares` / `complements` |
| enumeration | 已发现成员和可能遗漏类别 | `complements` |
| debate | 已有正反论点和弱证据侧 | `contradicts` / `complements` |

## 4. 为什么不再只靠 `--known-clue`

旧方案只证明“prompt 里有线索”，不能证明搜索 Agent 真用过。现在形成四段证据链：

1. `boundary-report.json.cross_agent_hints[].source_claim_keys`：线索来自哪些前序结论。
2. `inject-hints.mjs`：把线索和前序 key 一起注入。
3. Round 2 finding 的 `context_links`：新结论与前序结论是什么关系。
4. `check-depth.mjs`：关系不符合 task_type 就返回失败。

因此，“信息中继是否发生”从主观判断变成可检查事实。

## 5. 验收标准与证据

| 验收项 | 当前实现 | 自动证明 |
|---|---|---|
| 用户问题能初判 7 种类型 | `classify-task.mjs` + phase 2-typecheck | 8 种输入（含 general）分类测试 |
| Boundary 能针对类型产线索 | `references/boundary.md` | 7 类型契约测试 |
| 线索保留前序证据编号 | `source_claim_keys` | inject-hints 测试 |
| 下一轮收到线索 | `inject-hints.mjs` 输出 `--known-clue` | loop-tools 测试 |
| 下一轮留下使用证据 | finding `context_links` | normalize 测试 |
| 关系符合任务深度形态 | `check-depth.mjs` | 7 类型关系测试 |
| Boundary 说不能停时必须进 R2 | phase 4 硬拦截 | validate-state 测试 |
| R2 后能继续到合成和审查 | `audit-run.mjs --stage all` | current-problem 7 类型端到端测试 |

真实行为测试还验证了：Round 1 的跨平台子问题为 0 条证据时 phase 4 硬拦截；Boundary 生成 4 条带来源编号的线索；Round 2 新增 6 条带 `compares` 的横向结论；独立审查两次退回，第三次问题清零后才交付。完整记录见 `TEST-ISSUES.md`。

端到端测试对每一种 task_type 都执行：

1. 只放 Round 1 证据。
2. Boundary 返回 `terminate_recommended:false`，确认 phase 4 拦截。
3. 读取并注入带 `source_claim_keys` 的 hints。
4. 加入带正确 `context_links` 的 Round 2 证据。
5. 重新归一化、深度检查、边界、合成和审查。
6. 最终所有检查门通过。

## 6. 同时修掉的基础问题

跨 Agent 线索只有建立在正确账本上才有意义，因此本次同时完成：

- findings 不再追加，改为从 raw 确定性重建。
- raw 文件名强制带轮次。
- 相同 `claim_key` 跨轮合并，保留 `rounds_seen`。
- 多来源放进同一 finding，不再丢掉第二个来源。
- 完成标准只认 `subquestion_ids`、`fields_covered` 和来源日期。
- Rule A / Rule B 只由 `calc-novelty.mjs` 计算。
- Boundary 和 Review 改为可严格解析的 JSON 文件。
- 审查问题不清零就不能交付。
- red_flag 也保存结构化来源，允许报告解释旧版或冲突信息为何被排除。

## 7. 仍需人工观察的部分

自动测试和本次真实对比题证明机制能工作、失败能被拦住，但无法保证每个模型、每个主题提炼的 hint 都同样精彩。后续真实研究仍要观察：

- Boundary 提炼的线索是不是抓住了最关键差异。
- Round 2 是否只是形式上引用前序 key，还是确实产生了更有价值的判断；本次对比题已通过，其他任务类型仍需持续观察。
- 更复杂报告中，R2 的跨实体结论是否仍能稳定优于 R1。

这些属于模型产出质量，不再是流程“有没有执行”的黑箱问题。人工实测方法见 `TESTING.md` 的行为验收部分。
