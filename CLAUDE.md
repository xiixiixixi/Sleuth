# CLAUDE.md

Sleuth 是网络研究判断层：主 Agent 调度 5 种子 Agent，通过独立文件和机器检查门完成多轮研究。

## 常用命令

```bash
node --test scripts/__tests__/*.mjs
node --check scripts/*.mjs scripts/lib/*.mjs
node scripts/check-deps.mjs --mode light --check-only
node scripts/spawn-subagent.mjs --help
```

## 当前流程

```text
分流 → 侦察 → task_spec → 搜索轮次 → 确定性归一化
→ 深度/统计检查 → 边界反馈与 hints → 下一轮或收敛
→ 合成 → 草稿检查 → 审查 → 交付
```

角色与产出：

- Scout → `landscape.json`
- Search → `raw/search-r<round>-<agent>.jsonl`
- Boundary → `boundary-report.json`
- Synthesize → `draft.md`
- Review → `audit-report.json`

`findings.jsonl` 和 `stats-summary.json` 由 `normalize.mjs` 从全部 raw 确定性重建。任何角色都不能手改派生结果。

## 关键约束

- ESM only，Node.js ≥ 18，零 npm 依赖。
- `scripts/*.mjs` 是 CLI；可复用核心逻辑放 `scripts/lib/`。
- 测试使用 `node:test` + `node:assert`。
- 子 Agent 不读 `SKILL.md`；任务契约由 `spawn-subagent.mjs` 生成。
- 主 Agent 不读完整 findings、不合成、不修改子 Agent 报告。
- 边界和审查报告使用 JSON，禁止退回无法严格解析的 YAML 文本匹配。
- 不允许重新引入 session、deliver、research-index、managed browser 或 AppleScript bridge。
- `launch-chrome.mjs` 只允许用户主动运行并传 `--confirm-close-browser`；Sleuth 不自动启动或关闭 Chrome。

## 修改位置

- 主流程：`SKILL.md`
- 搜索与证据格式：`references/search.md`
- 7 种任务类型与跨 Agent 线索：`references/boundary.md`
- 审查：`references/review.md`
- 角色 prompt：`scripts/spawn-subagent.mjs`
- 数据真相：`scripts/normalize.mjs`
- 检查门：`scripts/validate-state.mjs`
- 测试方法：`docs/TESTING.md`
- 当前核心目标：`docs/CURRENT-PROBLEM.md`

## 测试纪律

行为变化必须增加会在旧实现上失败的测试，不能只断言文档里出现某句话。最低要求：

- 多轮测试必须覆盖 Round 1 + Round 2、重复事实和再次归一化。
- 检查门必须同时测试通过与拒绝路径。
- 7 种 task_type 必须验证各自的跨轮关系。
- 修改文档后检查不存在的引用和过时文件名。

完整流程按 `docs/TESTING.md` 执行，测试问题只更新 `docs/TEST-ISSUES.md`。
