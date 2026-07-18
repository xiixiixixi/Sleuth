---
name: sleuth
description: >-
  所有搜索、网页读取、浏览器验证与网络研究任务都应优先通过此 skill 处理。触发场景：用户要求搜索信息、查看网页、验证来源、访问动态页面、使用登录态浏览器或读取最新信息。
  All search, web reading, browser verification, and web research tasks should use this skill first.
---

# Sleuth 主流程

主 Agent 只调度、读小型状态文件并执行检查门；搜索、边界评估、合成和审查必须交给对应子 Agent。复杂任务按下列顺序执行，检查失败必须修复或回到上一轮。

## 1. 分流与环境

- 1-2 次搜索、单一来源即可回答：直接研究并引用一手来源。
- 多实体、多维度、多源或需要迭代：走完整流程。

先创建任务目录并做轻量检查：

```bash
node scripts/check-deps.mjs --mode light --task-name <task-name>
```

只有确定需要动态页面、登录态或交互时才运行 `--mode full`。浏览器未就绪时，提示用户打开 `chrome://inspect/#remote-debugging`；禁止自动运行 `launch-chrome.mjs`。该脚本只有用户明确选择并接受关闭 Chrome 时才能运行。

## 2. 侦察与任务定义

```bash
node scripts/classify-task.mjs --goal "<用户原问题>"
node scripts/spawn-subagent.mjs --role scout --goal "<问题领域>" --task-dir <task-dir>
node scripts/validate-state.mjs <task-dir> --phase 1.5
```

侦察 Agent 直接写 `landscape.json`。随后主 Agent 写 `task_spec.md`：

- `task_type`：`comparison / deep_dive / timeline / causal / problem_solving / enumeration / debate / general`
- 每个子问题：`- [ ] N. 标题`
- 每个子问题必须声明：`min_sources`、`min_t1`、`required_fields`、`max_age_days`
- `visual_evidence` 必须声明：默认 `auto`（每个一手页面扫描有用图片）；结论依赖图片时用 `required` 并在派搜索时加 `--visual-required`；只有用户明确不要图片或内容敏感时才可用 `off`，并写 `visual_evidence_reason`
- 无法取得但允许带限制交付时，只能在对应子问题下写 `known_limit`，禁止用全局限制放行全部问题

同时初始化 `progress.json`、`directions.json`、`follow_ups.json`，再检查：

```bash
node scripts/validate-state.mjs <task-dir> --phase 2
node scripts/validate-state.mjs <task-dir> --phase 2-typecheck
```

## 3. 搜索轮次

每轮最多并行 5 个搜索 Agent；超过 5 个分批并行。禁止手写 prompt：

```bash
node scripts/spawn-subagent.mjs --role search \
  --goal "<可验证目标>" --must-verify "<具体字段>" \
  --deliverable "<交付物>" --stop-criteria "<停止条件>" \
  --task-dir <task-dir> --agent-name <本轮唯一名称> --round <N> \
  --subquestion-id <编号> [--known-clue "<线索>"]
```

Agent 直接写 `raw/search-r<N>-<agent>.jsonl`。全部返回后依次执行：

```bash
node scripts/validate-state.mjs <task-dir> --phase 3-raw
node scripts/normalize.mjs <task-dir>
node scripts/check-depth.mjs <task-dir>
node scripts/validate-state.mjs <task-dir> --phase 3-findings
node scripts/calc-novelty.mjs <task-dir>
```

`raw/` 是唯一原始账本；`normalize.mjs` 每次确定性重建结果。禁止修改 `findings.jsonl`，禁止凭印象改统计。每个搜索 Agent 必须在 `agent_done.visual_scan.pages[]` 逐页说明检查了多少图片候选；有用原图或截图进入 finding 的 `visuals[]`。

## 4. 边界反馈与下一轮

```bash
node scripts/spawn-subagent.mjs --role boundary --goal "评估覆盖度并提炼跨 Agent 线索" --task-dir <task-dir>
node scripts/validate-state.mjs <task-dir> --phase 4
```

边界 Agent 直接写 `boundary-report.json`。检查失败表示必须继续搜索；先读取结构化缺口，再把线索注入下一轮：

```bash
node scripts/inject-hints.mjs <task-dir> [--target "<实体或维度>"]
```

下一轮必须把输出的 `--known-clue` 加到派发命令，并把新方向写入 `directions.json`。不同 `task_type` 的递进关系由边界 Agent 生成，`check-depth.mjs` 会检查 Round 2+ 是否真的通过 `context_links` 使用了前序结论。

只有以下情况可准备合成：

- 每个子问题达到机械完成标准，或各自有明确 `known_limit`
- 边界建议终止；或 `calc-novelty.mjs` 的统一收敛规则已触发
- 没有实体错误

```bash
node scripts/validate-state.mjs <task-dir> --phase 7-ready
```

## 5. 合成、审查、交付

```bash
node scripts/spawn-subagent.mjs --role synthesize --task-dir <task-dir>
node scripts/validate-state.mjs <task-dir> --phase 7-draft
node scripts/spawn-subagent.mjs --role review --goal "审计报告" --task-dir <task-dir> --draft-path <task-dir>/draft.md
node scripts/validate-state.mjs <task-dir> --phase 8-audit
```

- `non_critical`：把问题作为 `--audit-fix` 重派合成，再重新审查。
- `critical`：带 `suggested_search` 回到搜索轮次。
- 只有 `8-audit` 通过才能交付 `draft.md`；禁止把“未通过审查”说成完成。
- `visuals[]` 中登记的图片必须全部进入草稿，并由 Review 逐张检查来源、图注和相关性。

## 硬边界

- 完整流程中，禁止主 Agent 搜索、打开浏览器、读完整 `findings.jsonl`、写 `draft.md` 或修改子 Agent 报告。
- 禁止跳过检查门、删除历史 `raw/`、静默放弃用户指定实体、编造数字或来源。
- 用户指定实体缺数据时保留并标数据缺口；改变范围前必须询问用户。
- 不提取凭据、不绕付费墙、不截敏感页；提交、下单、发帖、改配置、删除等状态变更必须先获用户同意。
- 长任务不中途询问普通歧义；把假设写进报告。状态只靠任务目录恢复，不靠对话记忆。
