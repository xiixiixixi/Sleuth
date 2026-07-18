# Sleuth 测试与验收方法

> 目标：证明流程真的能阻止错误并形成多轮深度，不以“命令没报错”代替质量证明。

## 一、每次修改都要跑的自动测试

```bash
node --test scripts/__tests__/*.mjs
```

通过标准：0 failed。测试数量以命令实时输出为准，不在文档里写死。

然后做语法和文本检查：

```bash
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f" || exit 1; done
bash -n scripts/extract-subtitles.sh
git diff --check
```

## 二、核心回归范围

自动测试必须覆盖：

| 范围 | 必须证明 |
|---|---|
| 多轮账本 | 同一批 raw 重跑不重复；Round 2 不会变 Round 1 |
| 完成条件 | 中文标题不靠猜；required_fields 和过期来源有效 |
| 多来源 | 支持/反对来源不丢；置信度由程序推导 |
| 风险来源 | red_flag 必须有结构化 sources；限制语义可引用，不能算当前事实 |
| 跨 Agent 深度 | 7 种 task_type 的 R2 都有正确 context_links |
| 类型初判 | 7 种明确表达和 general 都能正确分类 |
| 收敛 | Rule A 和 Rule B 各自有触发测试 |
| 检查门 | boundary false、孤儿 URL、未清零审查都能被拒绝 |
| 角色交接 | Scout/Boundary/Review/Synthesize 直接写各自文件 |
| 浏览器安全 | 未明确确认时，启动脚本不会关闭 Chrome |

其中 `current-problem.test.mjs` 是 `CURRENT-PROBLEM.md` 的专项验收：每一种 task_type 都先确认 R1 被拦，再加入带正确关系的 R2，最后走到审查通过。

## 三、验收一个实际任务目录

不要自动选择“最近目录”，必须显式指定本次任务，避免检查错任务：

```bash
TASK_DIR="$HOME/.sleuth/output/<task-name>"
node scripts/audit-run.mjs "$TASK_DIR" --stage all
```

也可以分阶段执行：

```bash
node scripts/audit-run.mjs "$TASK_DIR" --stage raw
node scripts/audit-run.mjs "$TASK_DIR" --stage research
node scripts/audit-run.mjs "$TASK_DIR" --stage draft
node scripts/audit-run.mjs "$TASK_DIR" --stage final
```

各阶段含义：

- `raw`：原始文件 → 归一化 → 深度 → 统计 → 收敛。
- `research`：边界报告和合成就绪条件。
- `draft`：章节、引用和逐题限制。
- `final`：审查问题、抽样率和 passed。

任何一步失败都必须修复或回 LOOP，禁止跳过后宣称通过。

## 四、`CURRENT-PROBLEM.md` 的行为验收

自动测试证明管道存在；真实模型测试还要证明“第二轮确实更深”。选择一个至少 3 个实体、3 个共同维度的对比题，完整跑两轮。

### 测试题要求

- 用户明确列出实体，避免 Scout 自由缩小范围。
- 至少一个维度在 R1 后应出现明显缺口。
- R2 必须需要跨实体参照，不能靠单家公司独立搜完。
- 核心结论可从公开一手来源核验。

示例：

```text
对比 3 个 AI 客服平台的工作流编排：原生委派、流程上限、人工接管。
要求说明每家差异和适用场景，核心结论必须有官方来源。
```

### R1 后检查

```bash
node scripts/audit-run.mjs "$TASK_DIR" --stage raw
node scripts/validate-state.mjs "$TASK_DIR" --phase 4
```

如果 Boundary 认为不完整，phase 4 必须失败。随后检查：

```bash
node -e '
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
console.log({type:p.task_type, terminate:p.terminate_recommended, hints:p.cross_agent_hints});
' "$TASK_DIR/boundary-report.json"
```

合格标准：

- `task_type` 正确。
- `terminate_recommended` 为 false。
- hints 有 3-5 条。
- 每条有 `target`、`hint`、`rationale`、`source_claim_keys`。

### R2 后检查

```bash
node scripts/audit-run.mjs "$TASK_DIR" --stage raw
node -e '
const fs=require("fs");
const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
const r2=rows.filter(x=>x.type==="finding" && x.rounds_seen?.includes(2));
console.log(r2.map(x=>({claim_key:x.claim_key,context_links:x.context_links,claim:x.claim})));
' "$TASK_DIR/findings.jsonl"
```

合格标准：

- R2 至少有一条 finding 带 `context_links`。
- comparison 使用 `compares`；其他类型使用对应关系。
- 人工阅读 R2 claim，确实出现参照、递进、因果、边界、补漏或正反观点，不只是形式上挂 key。
- R2 新结论能改变或细化用户的判断。

### 最终检查

```bash
node scripts/audit-run.mjs "$TASK_DIR" --stage all
```

还要人工确认：

- 用户指定实体没有静默消失。
- 无证据实体只写数据缺口，没有补写事实。
- 报告中的数字来自 `stats-summary.json`。
- 每个核心结论有内联 URL。
- audit 的 critical 和 non_critical 都为空。

## 五、浏览器环境测试

基础路径：

```bash
node scripts/check-deps.mjs --mode light --check-only --json
```

需要浏览器时：

```bash
node scripts/check-deps.mjs --mode full --check-only --json
```

`ready:false` 时只提示用户处理 Chrome，不运行启动脚本。用户主动测试启动器时，先保存浏览器内容，再执行：

```bash
node scripts/launch-chrome.mjs --confirm-close-browser
```

没有确认参数时必须退出；Chrome 不正常退出时也必须停止，不能强制结束日常 Chrome。

## 六、文档一致性

```bash
node scripts/check-docs.mjs
```

它会检查当前文档是否使用过时报告名，以及 `docs/`、`scripts/`、`references/` 引用的文件是否真实存在。

## 七、记录结果

测试结果只更新 `TEST-ISSUES.md`：

- 日期和当前提交
- 实际执行的命令
- 自动测试通过/失败数量
- `CURRENT-PROBLEM.md` 7 类型专项结果
- 真实行为测试目录（如果执行）
- 未覆盖的人工环境项

禁止把“没有测试”写成“已修复”。
