---
name: sleuth
description: >-
  所有搜索、网页读取、浏览器验证与网络研究任务都应优先通过此 skill 处理。触发场景：用户要求搜索信息、查看网页内容、验证页面或来源、访问动态渲染页面、使用登录态浏览器、读取最新网页信息、或处理任何需要真实网页证据的网络任务。
  
  All search, web reading, browser verification, and web research tasks
  should be handled by this skill first. Triggers: user asks to search for
  information, view web content, verify pages or sources, access dynamically
  rendered pages, use logged-in browser sessions, read up-to-date
  information, or any task requiring real web evidence.
---

## 角色边界

主 Agent 只做**调度**——派子 Agent 研究、收 findings、派合成、派审查。不亲手做研究、不自己搜、不开浏览器、不读 findings.jsonl 全文、不写 draft。上下文越小越不容易跳步。

## 第 0 步：环境检查

```bash
node scripts/check-deps.mjs
```

如果输出 "chrome: 未发现可连的浏览器"：

```bash
node scripts/launch-chrome.mjs        # 启动带 CDP 的 Chrome（保留登录态）
```

如果 Chrome 144+ 反复弹"要允许远程调试吗?"：

```bash
node scripts/fix-chrome-debug-permission.mjs            # 装策略压住弹窗
node scripts/fix-chrome-debug-permission.mjs --check     # 检测是否已装
```

装完完全重启 Chrome（Cmd+Q 再重开）生效。

## 第 1 步：判断任务复杂度

**简单任务**（1-2 次搜索能答完、单一来源即可）→ 直接答 + 必要时一次网页读取验证。

**复杂任务**（多源交叉验证 / 多子主题 / 需多轮迭代）→ 继续第 1.5 步。

## 第 1.5 步：侦察（Scout）

```bash
node scripts/spawn-subagent.mjs --role scout --goal "<用户问题领域>"
```

拿到 landscape.json 后写入 `<outputDir>/landscape.json`，基于它拆 task_spec。

```bash
node scripts/validate-state.mjs <outputDir> --phase 1.5
```

## 第 2 步：初始化任务目录 + 写 task_spec.md

任务目录：`~/.sleuth/output/<task-name>/`（主 Agent 自己拼名字，Write 时目录自动创建）。

写 `<outputDir>/task_spec.md`，包含：

- **用户问题**（重写后的具体可研究问题）
- **任务类型（task_type）**——从 7 种选 1（见下方判断标准）
- **子问题**（每个 `- [ ] N.`，带完成标准：min_sources / min_t1 / required_fields / max_age_days）
- **全局完成标准**（时间覆盖 / 反方视角 / 来源多样性）

### task_type 判断标准

| task_type | 识别信号 |
|-----------|---------|
| **comparison** | "对比"/"vs"/"哪家好"/要求对比表 |
| **deep_dive** | "深入研究 X"/"X 怎么实现" |
| **timeline** | "历程"/"演变"/"从 X 到 Y" |
| **causal** | "为什么 X"/"X 的原因" |
| **problem_solving** | "怎么 X"/"如何解决" |
| **enumeration** | "列出所有"/"有哪些" |
| **debate** | "X 值得吗"/"X 会不会" |

判断不了用 `general`（不启用跨 Agent 线索）。这个字段决定 boundary Agent 提炼什么样的线索（见 `references/boundary.md`）。

同时初始化 `<outputDir>/progress.json`：

```json
{"started_at":"<ISO>","current_phase":"loop","current_round":1,"last_seen":"<ISO>","stale_count":0,"revision_count":0,"stats":{"total_findings":0,"total_t1":0,"rounds_completed":0},"termination_reason":null}
```

每轮 LOOP 末更新 current_round + last_seen + stats。stale_count 由 calc-novelty.mjs 自动更新。

```bash
node scripts/validate-state.mjs <outputDir> --phase 2
node scripts/validate-state.mjs <outputDir> --phase 2-typecheck
```

## 第 3 步：派搜索 Agent（每轮）

```bash
node scripts/spawn-subagent.mjs \
  --role search \
  --goal "验证该产品当前公开定价与计费单位" \
  --must-verify "价格数字" \
  --must-verify "计费单位" \
  --deliverable "含 3 个独立源的定价对比表" \
  --stop-criteria "至少 3 个独立源" \
  --known-clue "域名: example.com" \
  --task-dir <outputDir> \
  --round <当前轮次>
```

写 goal **说要什么，不说怎么做**。描述目标（「验证定价」），不要指定路径（「搜 pricing」）。must-verify 要具体到字段（「价格数字」），不要写「核实信息」。

**每轮最多并行 5 个**。子问题 > 5 分两批。派发前设置子 Agent 环境变量（SLEUTH_CDP_PORT / SLEUTH_CDP_WS）。

子 Agent 直写 `<outputDir>/raw/search-<name>.jsonl`，不返回 stdout。

### 3.1 跑归一化器

所有子 Agent 完成后：

```bash
node scripts/normalize.mjs <outputDir>
```

归一化器产出 findings.jsonl + stats-summary.json + parse_errors.log。

**你不读 findings.jsonl 全文**——只读 stats-summary.json（小文件）更新 task_spec。

```bash
node scripts/validate-state.mjs <outputDir> --phase 3-raw
node scripts/check-depth.mjs <outputDir>
node scripts/validate-state.mjs <outputDir> --phase 3-findings
```

⚠️ **深度门 exit 1 时，被点名的 agent 必须重派**（--round 递增），不是跳过。重派后重跑归一化（append 模式合并）。

### 3.2 更新 task_spec 状态

读 stats-summary.json 的 `by_subquestion.<编号>.meets_criteria`：true → 标 `[x]`，false → 保持 `[ ]`。挂载 gaps_to_resolve 为子节点。**这步在派边界 Agent 之前做。**

## 第 4 步：派边界 Agent

```bash
node scripts/spawn-subagent.mjs --role boundary --goal "评估覆盖度" --task-dir <outputDir>
```

```bash
node scripts/validate-state.mjs <outputDir> --phase 4
```

⚠️ **phase 4 是硬关卡**：`terminate_recommended: false` → exit 1 → 必须回第 6 步补搜。例外：Rule A（stale_count>=2）或 Rule B（>=5 轮）已触发时放行。

## 第 5 步：检查终止信号

前置：task_spec 所有子问题标 `[x]`（有 `[ ]` → 直接回第 6 步）。

```bash
node scripts/calc-novelty.mjs <outputDir>
```

终止条件（满足任一进第 7 步）：
- **Rule A**：stale_count >= 2
- **Rule B**：总轮数 >= 5 且最近 3 轮非递增且 novelty_ratio < 0.20
- **软终止**：boundary terminate_recommended=true + 无 entity_mismatch + follow_ups_unresolved=0
- **用户终止**：CHECKPOINT → 停

不终止 → 第 6 步。

## 第 6 步：混合派发 + 下一轮

分配 ≤5 个 Agent 名额：P1 垂直深挖（follow_ups，1-2 个）+ P2 广度推进（未完成子问题，3-4 个）。

```bash
node scripts/inject-hints.mjs <outputDir>                      # 读 boundary 的 cross_agent_hints，输出 --known-clue 参数
node scripts/inject-hints.mjs <outputDir> --target "Intercom"   # 按 target 过滤
```

派发时 --known-clue 带：follow_up 原文 + inject-hints 输出的 hint。查 directions.json 避免重复。追加新方向到 directions.json。回第 3 步（--round 递增）。

## 第 7 步：合成 + 审查 + 交付

你不做合成——派合成 Agent。

```bash
node scripts/validate-state.mjs <outputDir> --phase 7-pre
```

### 7.1 派合成 Agent

```bash
node scripts/spawn-subagent.mjs --role synthesize --task-dir <outputDir>
```

### 7.2 派审计 Agent

```bash
node scripts/spawn-subagent.mjs --role review --goal "审计报告" --task-dir <outputDir> --draft-path <outputDir>/draft.md
```

```bash
node scripts/validate-state.mjs <outputDir> --phase 7-post
```

### 7.3 处理审计结果

读 audit_report.yaml（不读 draft.md 全文）：

- non_critical 非空 → 重派合成 Agent 改 draft（--audit-fix "问题摘要"）
- critical 非空 → 回 LOOP（第 3 步），critical 回 loop 最多 3 次，第 3 次仍 critical → 标「已知限制」交付
- 都为空 → 交付

就绪即执行，不停下来问"是否提交"。

## 主 Agent 不许做的事（禁止清单）

| # | 禁止 | 为什么 |
|---|------|--------|
| 1 | 不许手拼子 Agent prompt（用 spawn-subagent.mjs） | 手拼漏安全边界/返回格式 |
| 2 | 不许自己做合成——必须派合成 Agent | 上下文爆炸 → 跳步 |
| 3 | 不许读 findings.jsonl 全文——只看 stats-summary.json | 几百行读了上下文膨胀 |
| 4 | 不许跳过检查门 | 跳了等于没质量关卡 |
| 5 | 不许单方面放弃用户列出的实体——必须 CHECKPOINT | 用户列 12 家，自己放弃 3 家 |
| 6 | 不许编辑 boundary-report.yaml / audit_report.yaml | 子 Agent 产出，不许改 |
| 7 | 不许编造数字 | 必须由脚本算 |
| 8 | 不许凭印象标 task_spec `[x]` | 必须基于 stats-summary.json 的 meets_criteria |
| 9 | 不许删除 findings/directions/follow_ups 的历史行 | append-only 是审计基础 |
| 10 | 不许跳过 normalize.mjs 直接从 raw/ 读 | 字段没归一化 |

## 运行边界

- 不提取 cookie、密码、敏感凭据
- 不对敏感页面截图
- 不绕付费墙
- 不执行会产生记录的状态变更操作（除非用户明确要求）

🔴 **CHECKPOINT**：提交表单/下单/改配置/点"确认删除"——执行前必须获用户同意。只读浏览无需确认。

🔴 **CHECKPOINT · 任务范围变更**：用户列出的实体**不许单方面放弃**。缺数据的标「数据缺口」不静默删除。如果搜索 Agent 返回某实体无数据，必须 CHECKPOINT 告知用户。

## 长程任务行为

- **零交互**：运行中不中途停下问用户。遇到歧义自行决定，写入报告"假设与决策"段
- **就绪即执行**：研究完直接交付，不停下问"是否提交"
- **状态持久化**：中间记录写文件，不靠对话记忆。上下文压缩后从文件重建状态（task_spec.md 存在 → 读它恢复进度；找最新修改的 `~/.sleuth/output/<name>/task_spec.md`）
- **反认知循环**：连续 2 轮返回类似信息 → 强制换路（换来源类型/工具/角度），不盲目重试
