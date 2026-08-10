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
| 视觉证据 | 每个已采用来源页都有扫描记录；图片可去重统计；漏图、孤儿图和漏审会失败 |
| 跨 Agent 深度 | 7 种 task_type 的 R2 都有正确 context_links |
| 类型初判 | 7 种明确表达和 general 都能正确分类 |
| 收敛 | Rule A 和 Rule B 各自有触发测试 |
| 检查门 | boundary false、孤儿 URL、未清零审查都能被拒绝 |
| 角色交接 | Scout/Boundary/Review/Synthesize 直接写各自文件 |
| 浏览器安全 | 未明确确认时，启动脚本不会关闭 Chrome |
| 浏览器兜底 | 轻量工具失败不固定等待；Node 版本不兼容会阻止安装；full 执行模式会自动补齐 CLI；测试版、开发版、独立用户目录和伪装参数不能冒充现有登录态 Chrome |

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

## 五、真实图片任务验收

自动测试只能证明规则会拦错，真实任务还要证明搜索 Agent 会从公开网页发现有用图片，并把它一路带进报告。选一个官方页面含流程图、架构图、定价表或产品界面的题目，`task_spec.md` 写 `visual_evidence: required`，派搜索时加 `--visual-required`。

搜索完成后检查：

```bash
node scripts/validate-state.mjs "$TASK_DIR" --phase 3-raw
node scripts/normalize.mjs "$TASK_DIR"
node scripts/validate-state.mjs "$TASK_DIR" --phase 3-findings
```

合格标准：

- `agent_done.visual_scan.pages[]` 覆盖每个已采用来源 URL，逐页数量与总数一致。
- 每条 finding 都显式写 `visuals[]`；本任务至少一条 finding 的数组非空。图片必须有来源页、图注、抓取时间，并且只使用 `image_url` 或 `screenshot_path` 其中一种。
- `stats-summary.json.total_visuals` 与去重后的图片数一致。
- `draft.md` 把所有登记图片放到相关结论附近，紧接来源页、抓取日期和“这张图说明什么”。
- `audit-report.json.visual_audit` 逐张检查，`missing` 和 `orphan` 都为空。

静态公开页面可以直接保留官方原图地址，不强制启动 Chrome；动态界面确实需要截图时才走 full 模式。最终仍要执行：

```bash
node scripts/audit-run.mjs "$TASK_DIR" --stage all
```

## 六、浏览器环境测试

基础路径：

```bash
node scripts/check-deps.mjs --mode light --check-only --json
```

需要浏览器时：

```bash
node scripts/check-deps.mjs --mode full --json
```

full 执行模式先要求 Node.js ≥ 24，再允许自动安装或升级 `agent-browser` CLI，但绝不运行 `agent-browser install` 下载测试浏览器。只想诊断、不想改环境时才加 `--check-only`。

`ready:false` 时只提示用户处理 Chrome，不运行启动脚本。用户主动测试启动器时，先保存浏览器内容，再执行：

```bash
node scripts/launch-chrome.mjs --confirm-close-browser
```

没有确认参数时必须退出；Chrome 不正常退出时也必须停止，不能强制结束日常 Chrome。

研究任务的浏览器兜底**不运行上面的启动器**。应验证以下顺序：

1. 模拟 Node.js 18：light 仍可运行，full 必须要求升级到 Node.js 24 且不尝试安装 CLI。
2. 模拟缺少或过旧 `agent-browser`：full 执行模式必须准确调用 `npm i -g agent-browser@latest` 并重新验版本，不能跳过；安装失败或复验失败必须保持 `ready:false`；`--check-only` 必须只报告且没有安装副作用。
3. 模拟 Chrome for Testing、Chrome Dev、Chromium、普通进程参数伪装，以及稳定版 Chrome 加 `~/.sleuth/chrome-live` 非默认用户目录：即使端口可连，full 检查也必须 `ready:false` 并写明拒绝原因。明确指向日常默认目录时不能误拒绝。
4. 提示用户在平时使用、已经登录的 Chrome 打开 `chrome://inspect/#remote-debugging`；禁止要求另开 Chrome，也禁止 Agent 代替用户关闭可疑实例。
5. full 检查只有在 `browser_identity: verified-user-chrome` 时，才允许把同次输出的 `SLEUTH_CDP_PORT` 和完整 `SLEUTH_CDP_WS` 一起注入搜索 prompt；生成后的真实命令必须内联 `ws://127.0.0.1:<port>/devtools/browser/<id>`。
6. 没有同次核验过的端口与完整调试地址，或者两者端口不一致时，搜索 Agent 必须返回 `BROWSER_CONTROL_REQUIRED`，保留 raw 且不写 `agent_done`，不能静默结束。
7. prompt 不得包含 2s / 5s / 10s 固定重试、裸 `agent-browser open`、`agent-browser install`、`--profile` 或 `close --all` 作为可执行兜底。
8. prompt 和当前文档必须统一使用 `agent-browser --cdp '<完整 cdp_ws>' --idle-timeout 1h <command>`；禁止退回只传端口，禁止使用 `--session` 或 `--namespace` 为同一个 Chrome 创建额外后台服务，也禁止启动或复用其他常驻 CDP 代理。

真实环境还要人工确认：连接后看到的是用户原有标签页；目标网站本来已登录时能直接读取；任务结束没有关闭用户原有标签页。

后台连接生命周期需要这样验证：

```bash
SLEUTH_CDP_PORT=9222
SLEUTH_CDP_WS='ws://127.0.0.1:9222/devtools/browser/<full-check-id>'
agent-browser --cdp "$SLEUTH_CDP_WS" --idle-timeout 1h get title
agent-browser --cdp "$SLEUTH_CDP_WS" --idle-timeout 1h get url
ps -axo pid,ppid,etime,command | grep agent-browser
lsof -nP -iTCP:9222
```

两个值必须来自同一次 full 检查，示例中的端口和 `<full-check-id>` 都要替换，不能自己拼接。`agent-browser` 0.33.2 只传端口时会在约 2 秒内结束发现，来不及等待用户点击 Chrome 144 的“允许”；这一步必须改用完整调试地址，让第一次命令持续等待用户确认。合格标准：用户点击一次“允许”后，第一条命令成功；后续命令没有再弹；连续命令复用同一个默认后台服务；9222 只有一条已建立的 `agent-browser` 连接；`~/.agent-browser/` 下没有由当前任务新建的命名 `.sock` 会话；没有其他常驻 CDP 客户端连接 9222；进程中没有 Chrome for Testing、Chrome Dev、Chromium 或新的 Chrome 实例。Chrome 重启或后台服务退出后的新连接仍可能再弹一次，这是正常安全确认，不能承诺永久不弹。

2026-08-10 本机实测基线：`agent-browser` 0.33.2 使用端口模式多次约 2 秒超时；改用 full 检查返回的完整地址后，用户在约 6.6 秒内点击允许，首条命令成功。紧接的 `get url` 与 `tab list` 合计约 0.1 秒完成，没有再弹授权框；系统只看到默认后台服务、默认 `.sock` 和一条连向 9222 的已建立连接，用户原有标签页仍在。

## 七、文档一致性

```bash
node scripts/check-docs.mjs
```

它会检查当前文档是否使用过时报告名，以及 `docs/`、`scripts/`、`references/` 引用的文件是否真实存在。

## 八、记录结果

测试结果只更新 `TEST-ISSUES.md`：

- 日期和当前提交
- 实际执行的命令
- 自动测试通过/失败数量
- `CURRENT-PROBLEM.md` 7 类型专项结果
- 真实行为测试目录（如果执行）
- 真实图片任务中的来源页数、候选图片数、保留图片数和最终审查结果
- 未覆盖的人工环境项

禁止把“没有测试”写成“已修复”。
