# Sleuth 测试问题账本

> 更新：2026-07-18。每个问题只保留一个当前状态；“代码已改”和“真实环境已验证”分开写。

## 当前结论

核心数据链、跨 Agent 线索、检查门和审查交付已经同时通过自动化测试与一个两轮公开网页对比实题。真实浏览器启动、Chrome 重启后的调试许可，以及视觉证据任务，仍属于人工环境观察项。

## 历史行为问题

| # | 问题 | 当前状态 | 证据或剩余事项 |
|---|---|---|---|
| 001 | Phase 4/5/6/8 被跳过 | 已修复 | `validate-state.test.mjs` 覆盖边界、就绪、草稿和审查拒绝路径 |
| 002 | 搜索 Agent 浅扫或零 finding | 已修复 | raw 字段门、agent_done、depth-report；零产出会失败 |
| 003 | 动态页面不使用浏览器 | 流程已修复，需按任务观察 | prompt 明确工具升级；只有需要时检查 full 模式 |
| 004 | 搜索 Agent 串行派发 | 运行时行为，未做伪强制 | SKILL 要求每批最多 5 个并行；文件独占已消除并发写冲突。真实耗时测试继续观察 |
| 005 | 无数据实体仍有章节和事实 | 已修复 | synthesize 禁止补写；7-draft 检查章节和孤儿 URL |
| 006 | PRD 写成架构文档 | 已修复，需 PRD 实题观察 | synthesize prompt 有 PRD 结构和禁止项 |
| 007 | Scout 漏用户指定实体 | 已修复到安全边界 | 禁止静默放弃；范围改变必须询问。实体完备性仍需按用户输入人工核对 |
| 008 | 报告虚报来源数量 | 已修复 | 数字只读 stats-summary；禁止用 findings 总行数代替证据数 |
| 009 | Boundary 说不能停却直接合成 | 已修复 | phase 4 在无收敛信号时硬拦；有高优先级缺口不能建议终止 |
| 010 | 图文任务没有截图 | 机制已修复，需视觉实题观察 | `visual_evidence: required` + `--visual-required`；没有 screenshot_path 过不了 raw 门 |

## 2026-07-18 工程审查新增问题

| # | 问题 | 当前状态 | 修复证据 |
|---|---|---|---|
| 011 | 多次 normalize 重复追加，所有数据变 Round 1 | 已修复 | 确定性重建、轮次文件名、`rounds_seen`；重复运行逐字一致测试 |
| 012 | required_fields 一填就永远不能完成；中文靠关键词猜 | 已修复 | `subquestion_ids` + `fields_covered` + 日期计算；中文与字段测试 |
| 013 | 检查门只看文件和关键词 | 已修复 | Boundary/Review 改 JSON；逐项结构和语义拒绝测试 |
| 014 | Scout/Boundary/Review 谁写文件不明确 | 已修复 | 每个角色 prompt 明确唯一产出文件 |
| 015 | 深度门只奖励字数和 URL 数 | 已修复 | 字数变提醒；来源结构、稳定 claim 和 task_type 递进变硬检查 |
| 016 | 多源验证后只保留一个 URL | 已修复 | `sources[]` 保留支持/反对来源，置信度由程序推导 |
| 017 | 环境检查和启动脚本可能影响日常 Chrome | 已修复 | light/full 分离；用户确认参数；不再强制终止日常 Chrome |
| 018 | docs 被忽略、引用缺失文件、状态互相矛盾 | 已修复 | docs 纳入版本管理；新增 STATUS；当前文档不引用缺失文件 |
| 019 | 117 条旧测试未覆盖两轮主链路 | 已修复 | 新增 normalize、loop、validate、current-problem 端到端测试；数量不再写死 |
| 020 | red_flag 只有文本 URL，导致“为什么排除旧资料”无法在成稿中引用 | 已修复并经实题验证 | red_flag 强制结构化 `sources`；normalize 保留；草稿门允许以限制语义引用；新增 raw、normalize、draft 测试 |

## `CURRENT-PROBLEM.md` 专项结果

专项测试对以下 7 种 task_type 分别跑完整夹具：

- comparison → `compares`
- deep_dive → `extends`
- timeline → `follows`
- causal → `causes`
- problem_solving → `bounds`
- enumeration → `complements`
- debate → `contradicts`

每个夹具都证明：

1. Round 1 未完成时 phase 4 会失败。
2. Boundary hints 带 `source_claim_keys`。
3. 注入工具把前序 key 传给 Round 2。
4. Round 2 finding 带正确 `context_links`。
5. raw、normalize、depth、findings、boundary、ready、draft、audit 全部通过。

自动测试命令：

```bash
node --test scripts/__tests__/*.mjs
```

本次在提交 `aa4ae68` 的未提交修改上实跑结果：109 个测试全部通过，0 个失败。

## 真实两轮行为测试

任务目录：`~/.sleuth/output/sleuth-live-comparison-20260718/`

题目：对比 Intercom、Zendesk、Salesforce Agentforce 的客服工作流编排，核验原生委派、流程上限、人工接管和跨平台适用场景。

实际结果：

1. Scout 写出 9 个相关实体、8 个观察视角和 10 个官方来源线索。
2. Round 1 由 3 个搜索角色分别研究三家平台，得到 9 条 finding；子问题 4 为 0 条，Boundary 输出 4 条带 `source_claim_keys` 的 hint，phase 4 按预期失败并强制进入 Round 2。
3. Round 2 由 3 个搜索角色分别对比委派、上限和接管，新增 6 条 finding；每条都有 `compares` 关系，子问题 4 覆盖 24 个独立 URL 和 3 个必填字段。
4. 草稿第一次因孤儿 URL 被 phase 7-draft 拒绝；第一次 Review 发现 4 个 non_critical，第二次发现 2 个，并由此暴露 red_flag 来源未结构化的问题。
5. 修复 red_flag 证据链后，第三次 Review 为 `passed: true`，critical 0、non_critical 0；T1 抽查 10/15。
6. `node scripts/audit-run.mjs ~/.sleuth/output/sleuth-live-comparison-20260718 --stage all` 全阶段通过。

人工抽读确认 Round 2 不是重复搜索：它把三家上限拆成硬限制、经验建议、测试版限制和未公开信息，并比较了委派返回语义与人工接管停止点，确实细化了选型判断。

## 尚未冒充“已验证”的项目

- Chrome 调试许可在电脑重启后是否仍持久。
- macOS / Linux / Windows 的真实 Chrome 启动全过程。
- 一个 `visual_evidence: required` 的真实 UI 对比题是否能为每个 Agent 产出合格截图。

这些项目没有被写成已修复；执行方法见 `TESTING.md`。
