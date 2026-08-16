# Sleuth

让 AI Agent 在网络研究中知道该去哪里找、什么能当证据、还缺什么，以及什么时候可以停止。

Sleuth 不是搜索工具，而是研究判断层。它把搜索摘要当线索，把原始页面当证据，并用机器检查门阻止重复记账、浅层搜索、无来源合成和未经审查的交付。

## 两条路径

| 路径 | 适用情况 | 做法 |
|---|---|---|
| 轻任务 | 1-2 次搜索、单一来源即可回答 | 直接研究，核心结论回一手来源核验 |
| 完整研究 | 多实体、多维度、多源或需要多轮 | 侦察 → 搜索 → 边界反馈 → 继续搜索 → 合成 → 审查 |

完整研究包含 5 个子 Agent：

- Scout（侦察）：画信息源地图，写 `landscape.json`
- Search（搜索）：每轮独占一个 raw 文件，写结构化证据
- Boundary（边界）：判断缺口并提炼跨 Agent 线索，写 `boundary-report.json`
- Synthesize（合成）：只基于证据写 `draft.md`
- Review（审查）：检查引用和可信度，写 `audit-report.json`

主 Agent 只负责调度和运行检查门，不自己补研究结论。

> `scripts/spawn-subagent.mjs` 只负责生成角色 prompt（提示文本），不会自动创建或派发 Agent（子智能体）。主 Agent 必须把生成出的完整提示交给当前运行平台的 Agent 工具。

## 关键保障

- `raw/` 是唯一原始账本；整理程序每次重建结果，不会重复追加。
- 每条证据明确绑定子问题、覆盖字段、来源日期和稳定 `claim_key`。
- 同一结论保留多个支持或反对来源，置信度由程序计算。
- 风险标记也保留结构化来源，让报告能解释“为什么排除旧资料”，又不会把旧资料算成当前事实。
- 7 种任务类型使用不同的跨轮关系：对比、纵深、时序、因果、问题解决、清单、争议。
- Round 2+ 必须用 `context_links` 证明使用了前序线索。
- 默认逐页检查已采用来源里的图片；有用的原图或截图进入 `visuals[]`，并记录来源页、图注和抓取时间。
- 每张已登记图片都必须进入报告，Review（审查）逐张核对；漏图、来源不明图片和装饰图都会被检查门拦住。
- 边界、草稿和审查都由严格 JSON 检查，不靠关键词猜测。
- 最终审查通过只证明审查报告自身合格；交付前还必须单独执行 `node scripts/audit-run.mjs <task-dir> --stage all`，检查它的退出状态，并且禁止用管道隐藏失败。

## 安装

```bash
npx skills add xiixiixixi/Sleuth
```

安装命令结束不等于完整可用。Sleuth 除了 `SKILL.md`，还依赖 `references/` 和 `scripts/`；安装后先检查关键文件：

```bash
test -f references/search.md
test -f scripts/validate-state.mjs
test -f scripts/audit-run.mjs
```

三条命令都必须返回成功。如果只得到 `SKILL.md`，请改用完整仓库克隆，并让运行平台的 Skill（技能）目录指向该仓库；不要在缺少 `references/` 或 `scripts/` 时继续研究。

基础研究要求 Node.js ≥ 18。需要动态页面、登录态或交互时，`agent-browser` ≥ 0.28 官方要求 Node.js ≥ 24，因此浏览器兜底还要求 Node.js ≥ 24 和 Chrome；版本不足时 full 检查会先明确报错，不会盲目安装。

```bash
# 普通研究检查
node scripts/check-deps.mjs --mode light --check-only

# 确实需要浏览器时
node scripts/check-deps.mjs --mode full
```

网络搜索失败后只改写一次查询；网页读取返回空、登录墙、脚本空壳或超时后不原地等待，浏览器是最终兜底。full 执行模式缺少或版本过旧时会自动运行：

```bash
npm i -g agent-browser@latest
```

这里只安装 CLI，不会下载测试浏览器；`--check-only` 仍是纯诊断。Sleuth 会先核对端口背后的程序身份，再使用同次 full 检查返回的完整调试地址 `ws://127.0.0.1:<port>/devtools/browser/<id>` 连接用户当前使用、已经登录的 Chrome。Chrome for Testing、Chrome Dev、Chromium、独立用户目录或手工调试启动实例即使端口可连也会被拒绝。用户在日常 Chrome 打开 `chrome://inspect/#remote-debugging` 开启控制即可。搜索 Agent 继续并行，浏览器操作统一走 `scripts/shared-browser.mjs exec`：只有单条浏览器命令短暂排队，脚本在命令前后都选回调用者自己的唯一标签，再核对最终 URL 和标题。默认后台服务使用 `--idle-timeout 0` 保持连接；Chrome 未退出且连接健康时不会主动断开。禁止新建无归属标签，禁止只传端口反复等待，禁止使用 `--session` 或 `--namespace` 另建后台服务，也禁止裸跑 `agent-browser open`、运行 `agent-browser install` 或自动启动、关闭、重启 Chrome。`scripts/launch-chrome.mjs` 只保留为用户主动选择的独立诊断工具，不属于研究兜底路径。

## 什么叫真正完成

开发过程中可以分段检查：

```bash
node scripts/audit-run.mjs <task-dir> --stage raw
node scripts/audit-run.mjs <task-dir> --stage research
node scripts/audit-run.mjs <task-dir> --stage draft
node scripts/audit-run.mjs <task-dir> --stage final
```

但最终交付只能使用严格完整验收：

```bash
node scripts/audit-run.mjs <task-dir> --stage all
```

`all`（全部阶段）会先要求 `boundary-report.json`、`draft.md` 和 `audit-report.json` 全部存在，再固定重跑 raw、research、draft、final（原始证据、研究、草稿、最终审查）。任何文件缺失或任何阶段失败都会返回非零状态；单独 `8-audit` 通过不能代替它。完整命令必须单独运行并检查退出状态，禁止接 `| tail` 等管道后宣称完成。

## 测试

```bash
node --test scripts/__tests__/*.mjs
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f" || exit 1; done
bash -n scripts/extract-subtitles.sh
git diff --check
node scripts/check-docs.mjs
```

2026-08-16 的验证基线：152 项自动测试全部通过；一个 GitHub Actions（GitHub 自动化工作流）/ GitLab CI/CD（GitLab 持续集成）/ CircleCI（持续集成平台）两轮真实对比任务通过严格完整验收；一个 `visual_evidence: required`（视觉证据必需）的 Kubernetes（容器编排系统）官方架构图任务通过逐图审查；用户日常 Chrome（浏览器）的 A/B 双标签并发打开和再次读取没有串页，只关闭了两个测试标签。

尚未把以下事项写成已验证：macOS（苹果桌面系统）重启后的调试授权持久性、Linux（操作系统）/ Windows（操作系统）的真实 Chrome（浏览器）启动链，以及需要登录的网站正文读取。

## 当前已知限制

- `task_spec.md`（任务契约）的冻结、变更记录和勾选状态仍主要依赖调度纪律，尚未形成完整的决策账本。
- 固定逻辑 Agent 总量、跨任务查询去重和矛盾结论沿革仍属于后续治理能力。
- 搜索 Agent 仍需手写 JSONL（逐行 JSON）与视觉扫描汇总；格式会被检查门拒绝，但机械写入尚未完全工具化。
- 运行平台没有搜索、网页读取或现有登录态浏览器能力时，Sleuth 只能明确交接和保留证据，不能把平台能力缺失伪装成已完成。

## 目录

```text
SKILL.md                         主 Agent 的精简操作流程
references/scout.md             侦察规则
references/search.md            搜索、证据与多模态规则
references/boundary.md          覆盖评估与跨 Agent 线索
references/review.md            证据链审查
references/tool-guide.md        浏览器操作参考
scripts/normalize.mjs           确定性重建证据与统计
scripts/classify-task.mjs       根据用户问题初判 7 种深度类型
scripts/check-depth.mjs         结构与跨轮深度检查
scripts/validate-state.mjs      流程检查门
scripts/audit-run.mjs           分阶段检查与最终严格完整验收
scripts/calc-novelty.mjs        统一收敛判断
scripts/inject-hints.mjs        下一轮线索注入
scripts/spawn-subagent.mjs      生成 5 种子 Agent 的任务提示，不自动派发
```

## 安全边界

- 不提取 cookie、密码或敏感凭据
- 不绕付费墙、不对敏感页面截图
- 不替用户提交表单、下单、发帖、改配置或删除内容
- 不静默放弃用户指定的实体或范围

MIT License
