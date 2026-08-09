# Sleuth 测试问题账本

> 更新：2026-08-09。每个问题只保留一个当前状态；“代码已改”和“真实环境已验证”分开写。

## 当前结论

核心数据链、跨 Agent 线索、检查门、视觉证据和审查交付已经通过自动化测试和真实任务。轻量工具失败后的浏览器交接、CLI 自动安装、Node 版本边界和“只连接现有登录态 Chrome”已有行为测试。当前 9222 端口已经核验为用户日常使用的稳定版 Google Chrome，Google 页面也显示用户原有登录账号；浏览器兜底不再接受 `~/.sleuth/chrome-live`、Chrome for Testing、Chrome for Dev、Chromium 或其他独立用户目录。重复授权框的代码侧修复已经完成，最后还需用户在一次干净连接中点击“允许”，验证同一个控制进程可以连续执行两条命令且不再重复弹框。

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
| 010 | 明确要求图文的任务没有截图 | 已修复并经视觉实题验证 | `visual_evidence: required` + `--visual-required`；没有合格 `visuals[]` 过不了 raw 门；真实任务保留 3 张官方产品图并通过全阶段检查 |

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
| 021 | 普通调研网页能看到有用图片，但图片在抓取后被静默略过 | 已修复并经真实网页验证 | 默认 `visual_evidence: auto`；`visual_scan.pages[]` 逐页留痕；`visuals[]` 接入归一化、统计、成稿和 `visual_audit`；自动测试覆盖拒绝路径，Intercom 官方页实题完成 17 个候选 → 3 张有用图 → 3 张成稿 → 3 张审查 |

## 2026-08-01 浏览器兜底审查新增问题

| # | 问题 | 当前状态 | 修复证据 |
|---|---|---|---|
| 022 | WebFetch 单 URL 固定等待 2s / 5s / 10s，失败后只记 gap，主 Agent 不知道该请用户开启浏览器 | 已修复 | WebSearch 只允许一次实质改写；WebFetch / reader 失败立即升级；无端口返回 `BROWSER_CONTROL_REQUIRED`，保留 raw 且不写 `agent_done`；prompt 专项测试通过 |
| 023 | 浏览器命令可能裸跑并启动新浏览器，任务结束还允许 `close --all` | 已修复 | 所有命令强制 `--cdp <字面端口>`；禁止 `agent-browser install` / `--profile` / 自动 launcher；只关闭本任务明确新建的标签页；规则与 prompt 测试通过 |
| 024 | full 检查缺 CLI 时提示顺序不清，且没有机器可读的下一步 | 已修复 | JSON 新增 `connectionTarget: existing-user-chrome` 和顺序化 `nextActions`；缺 CLI 时先给 `npm i -g agent-browser@latest`，再引导现有 Chrome 开启控制 |
| 025 | Chrome 文档和许可脚本把 `user-enabled=true` / `RemoteDebuggingAllowed=true` 误写成“压住弹窗” | 已修复到事实边界 | 文档改为“新连接仍可能确认一次”；许可脚本 help/check 不再承诺永久免确认；专项测试防止误导表述回归 |
| 026 | `docs/STATUS.md` 声称当前文档随仓维护，但 `.gitignore` 实际忽略整个 `docs/` | 已修复 | `.gitignore` 改为只忽略 `docs/local/`；`check-docs.mjs` 和契约测试会阻止整个 docs 再次被忽略 |
| 027 | 把 `connected:true` 和历史任务复验说成“完整浏览器测试”，但没有让 Chrome 现场打开网页查询 | 已补做真实浏览器测试 | 在现有 Chrome 新建 Google 标签页，通过页面搜索框输入 `agent-browser GitHub` 并按回车；搜索结果识别到官方 GitHub 仓库，另一个测试标签页成功打开并读取官方仓库标题 |

## 2026-08-02 “神逻辑”深度调研实题新增问题

| # | 问题 | 当前状态 | 修复证据 |
|---|---|---|---|
| 028 | 同一 `claim_key` 跨轮合并时只按字数选正文，导致 R2 把时间下限从 2013 推进到 2012 后，派生结果仍保留更长的 R1 旧结论 | 已修复并经实题验证 | `normalize.mjs` 改为优先采用最新轮次正文，同轮才按信息长度选择；新增“后轮短句替换前轮长旧句”回归测试；实题重新归一化后保留 2012-11-12 更新结论 |
| 029 | `lines_written` 写成“总行数”，4 个搜索角色把 `agent_done` 本身也计入，虽然检查门会拦，但角色反复自称校验通过 | 已修复提示契约 | `references/search.md` 和搜索 prompt 明确只数 `agent_done` 之前的 finding/gap/red_flag；补 4+1 必须写 4 的例子和 prompt 契约测试 |
| 030 | 多个搜索角色并发使用同一现有 Chrome 时，“当前标签页”会串页；`--session` 不能隔离同一 CDP 连接的活动标签 | 已修复调度规则并做真实 CLI 验证 | 主流程改为轻量搜索可并行、浏览器操作必须串行，同一时刻只给一个 Agent 端口；实测两个会话分别打开 example.com / example.org 后都会读到后切换的 example.org；新增唯一标签三步法，测试标签均已关闭 |
| 031 | “深度调研……并说明区别”被 `区别` 抢先误判为 comparison | 已修复 | `deep_dive` 的强信号优先，并新增“深度调研 + 区别”冲突回归测试；同题现返回 `deep_dive` |

## 2026-08-09 浏览器身份与 CLI 自动安装复验

| # | 问题 | 当前状态 | 修复证据 |
|---|---|---|---|
| 032 | full 检查只看 `DevToolsActivePort` 和端口存活，把 `~/.sleuth/chrome-live` 独立实例误报成用户登录态 Chrome；缺 CLI 时也只提示、不自动补齐 | 已修复并完成日常 Chrome 实测 | 新检查核对端口监听进程的真实可执行文件，拒绝 Chrome for Testing / Dev / Chromium / 非默认用户目录 / 手工调试实例 / 普通进程参数伪装；full 执行模式在 Node.js ≥ 24 时自动安装或升级 CLI，`--check-only` 保持只读。历史独立实例被拒绝后，用户正常重开日常 Chrome；当前 9222 返回 `verified-user-chrome`，Google 页面显示原有登录账号，并完成一次现场搜索 |
| 033 | 每条浏览器命令可能新建一个长期驻留的控制进程，其他常驻 CDP 代理也可能持续占用 9222，导致 Chrome 反复弹出远程调试授权框 | 代码和规则已修复，待最后一次授权实测 | 当前环境发现 11 个旧 `agent-browser` 后台进程，以及一个已运行 21 天并仍连接 9222 的其他常驻 CDP 代理；已只停止这些明确的旧控制进程，未关闭 Chrome 或用户标签页。所有浏览器命令现在统一复用默认后台进程，并显式传 `--idle-timeout 1h`；禁止 `--session`、`--namespace` 和启动其他常驻 CDP 代理。专项契约测试已覆盖；还需用户在一次干净连接中点“允许”，再连续执行两条命令确认只授权一次 |

本次旧证据修正：2026-08-02 记录中的 `ready:true` 和 `connected:true` 只能证明 9222 可连接，不能证明它属于用户日常登录态 Chrome。2026-08-09 先查明当时的端口实际由稳定版 Google Chrome 程序配合 `~/.sleuth/chrome-live` 独立用户目录监听，因此那次身份判断作废；用户随后正常重开日常 Chrome，新的身份检查和页面账号核验均已通过。两个阶段必须分开理解，不能把历史误判写成当前状态。

本次按 `TESTING.md` 复验结果：

1. `agent-browser` 已从 0.28.0 升级到 0.33.2；当天重新查询 npm，线上 latest 也是 0.33.2，且官方运行要求为 Node.js ≥ 24。只升级 CLI，未运行 `agent-browser install`。
2. `node --test scripts/__tests__/*.mjs`：139 passed，0 failed；覆盖 Node 版本阻断、浏览器真实身份、CLI 自动安装/升级、轻量失败及时交接、单一后台连接、归一化更新、任务分类和完整检查门。
3. 浏览器生命周期专项测试已按“先失败、再修复”的方式覆盖：必须统一使用 `--cdp <端口> --idle-timeout 1h`，禁止新建命名会话和其他常驻 CDP 代理。
4. `shenluoji-deep-dive-20260802` 真实任务重新执行 `audit-run.mjs --stage all`，raw、深度、边界、草稿和审查门全部通过。
5. 历史独立实例的 full 检查为 `ready:false`、`browser_identity: rejected-non-user-browser`、`rejected_browser_reason: non-default-user-data-dir`；用户正常重开日常 Chrome 后，当前 full 检查为 `ready:true`、`browser_identity: verified-user-chrome`、端口 9222。没有运行启动器，也没有关闭或重启用户 Chrome。
6. 全部 Node / Bash 语法、`git diff --check` 和 25 个 Markdown 文档检查通过；`shenluoji-deep-dive-20260802` 的 raw、归一化、深度、边界、草稿和审查检查门重新全通过。

### 旧浏览器验证记录（其中身份结论已由 #032 作废）

1. `node --test scripts/__tests__/*.mjs`：123 passed，0 failed。
2. `node scripts/check-docs.mjs`：23 个 Markdown 文件通过。
3. 全部 Node 脚本语法、Bash 语法和 `git diff --check` 通过。
4. 两个历史真实任务目录重新执行 `audit-run.mjs --stage all`，对比任务与视觉任务所有检查门继续通过。
5. 当前 full 检查为 `ready:true`，连接目标为 `existing-user-chrome`，端口 9222；执行只读 `agent-browser --cdp 9222 eval "({connected: true})"` 返回 `connected:true`，没有读取正文或截图。
6. 当前安装 `agent-browser v0.28.0`，满足项目最低版本；npm 当日 latest 为 0.31.1。缺失或过旧时统一提示安装 latest，但本次未擅自升级用户的全局工具。

## 2026-08-02 修改后完整复验

严格按 `TESTING.md` 重新执行，不沿用前一天的测试结果：

1. `node --test scripts/__tests__/*.mjs`：123 passed，0 failed。
2. 全部 Node 脚本语法、Bash 语法、`git diff --check` 通过。
3. `node scripts/check-docs.mjs`：23 个 Markdown 文件通过。
4. light 环境检查为 `ready:true`；full 环境检查为 `ready:true`、`connectionTarget: existing-user-chrome`、端口 9222、无待处理动作。
5. 对比实题 `sleuth-live-comparison-20260718` 全阶段通过：15 条 finding、15 条 T1；Round 2 有 6 条跨平台 finding，均通过 `compares` 连接前序结论；最终报告四个指定章节齐全，审查 critical 0、non_critical 0、passed true。
6. 图片实题 `sleuth-live-visual-20260718` 全阶段通过：扫描 17 个候选、保留 3 张、成稿嵌入 3 张、审查 3 张，missing 0、orphan 0、passed true。
7. 只读执行 `agent-browser --cdp 9222 eval "({connected: true})"` 返回 `connected:true`；没有读取页面正文、URL、cookie 或截图。环境检查的 `auth_state` 仍为 `unknown`，因此没有把浏览器可连接冒充为目标网站已登录。
8. 未运行 `launch-chrome.mjs`，没有启动、关闭或重启 Chrome，也没有关闭用户标签页。
9. 用户指出连接检查不等于真实浏览器查询后，补做现场操作：在 Google 首页定位 `textarea[name="q"]`，实际填入 `agent-browser GitHub` 并按 Enter；结果页标题为 `agent-browser GitHub - Google Search`，页面识别到 `https://github.com/vercel-labs/agent-browser`，并成功打开该官方仓库。搜索结果标签页保留在 Chrome 前台供用户核对。

## 2026-08-02 “什么叫神逻辑”完整实题

任务目录：`~/.sleuth/output/shenluoji-deep-dive-20260802/`

题目：解释“神逻辑”的语义、可核验早期用例、推理结构、非谬误边界，以及普通人的识别和回应方法。

实际结果：

1. Scout 产出 9 个关键概念、12 个研究视角/证据路线和 13 条来源线索；任务人工纠正为 `deep_dive`，后续同时修复分类器的冲突信号优先级。
2. Round 1 由 4 个搜索角色覆盖语义、历史、逻辑和回应，产出 18 条事实。论文页 reCAPTCHA、凤凰正文超时和 Google 输入框未渲染都没有固定等待：立即切换现有 Chrome 或更换入口；未启动新 Chrome，也未关闭用户原有标签。
3. Boundary 拒绝 Round 1：2013 只能算当前时间下限，通用逻辑框架也不能冒充中文自然语料的实际结构。Round 2 新增 7 条事实，其中 6 条为新结论；三组 R2 均用 `extends` 指回 R1。
4. 早期用例下限推进到现存页面可直接核验的 2012-11-12，并用 2012-11-14《成都商报》和 2012-11-27 中新网补传播节点；报告始终保留“不能证明绝对首创”的限制。
5. 第二次 Boundary 抓到 #028 的陈旧 claim，阻止合成。修复归一化器并重建后，更新正文、来源和轮次一致，Boundary 才改为 `terminate_recommended:true`。
6. 成稿第一次因第 4 题章节标题不完整被 `7-draft` 拒绝；第一次 Review 又发现 4 个 non_critical：无依据频率判断、2012 直接证据漏链、最终摘要缺内联来源和受阻旧页可信度边界。修订后独立复审为 critical 0、non_critical 0、passed true。
7. 全任务最终为 24 条 finding、14 条 T1；5 张视觉证据全部进入报告并审查 5/5，missing 0、orphan 0。
8. `node scripts/audit-run.mjs ~/.sleuth/output/shenluoji-deep-dive-20260802 --stage all` 全阶段通过。
9. 修改后完整自动测试为 125 passed、0 failed；23 个 Markdown 文件、全部 Node/Bash 语法和 `git diff --check` 通过。

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

本次修改后的最终测试结果记录在下方“真实视觉证据链测试”之后；测试数量仍以实时命令输出为准。

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

## 真实视觉证据链测试

任务目录：`~/.sleuth/output/sleuth-live-visual-20260718/`

题目：核验 Intercom Fin Procedure 的创建流程，并从官方帮助页提取真正有用的产品界面图。

实际结果：

1. Search 真实读取 Intercom 官方帮助页，扫描 17 个图片候选：9 张正文产品界面图、2 张品牌图、6 张页脚社交图标。
2. 按任务相关性和每条 finding 最多 3 张的规则，保留 3 张官方原图，分别说明新建入口、AI 起草和条件分支；品牌图、社交图标和重复步骤图没有充数。
3. `3-raw`、归一化、深度门、`3-findings` 全部通过；`stats-summary.json.total_visuals` 为 3，类型均为 UI。
4. Synthesize 把 3 张图全部放进 `draft.md`，每张紧跟来源页、抓取日期和用途说明；`7-draft` 通过。
5. Review 真实核验 3 张图片和来源页，`visual_audit` 为 checked 3/3、embedded 3/3、missing 0、orphan 0；critical 0、non_critical 0、passed true。
6. `node scripts/audit-run.mjs ~/.sleuth/output/sleuth-live-visual-20260718 --stage all` 全阶段通过。

在提交 `6457457` 的未提交修改上完成最终回归：115 个自动测试全部通过，0 个失败；23 个 Markdown（文档格式）文件通过一致性检查，全部脚本通过语法检查，`git diff --check` 无格式错误。

## 尚未冒充“已验证”的项目

- Chrome 调试许可在电脑重启后是否仍持久。
- macOS / Linux / Windows 的真实 Chrome 启动全过程。

这些项目没有被写成已修复；执行方法见 `TESTING.md`。
