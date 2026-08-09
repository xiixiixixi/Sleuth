# Sleuth 当前架构

> 版本：2026-08-01；状态：已实现。运行规则以 `SKILL.md` 和脚本检查结果为准。

## 1. 产品定位

Sleuth 是网络研究的判断层，不是搜索引擎。它解决五个问题：

1. 去哪里找：搜索、网页读取或浏览器。
2. 什么能信：线索和证据分开，多来源保留。
3. 还缺什么：边界 Agent 逐问题评估。
4. 什么时候停：完成标准、语义边界和信息增益共同决定。
5. 哪些图不能丢：逐页检查视觉内容，把有用图片接入证据、成稿和审查。

## 2. 角色

| 角色 | 读取 | 产出 | 禁止 |
|---|---|---|---|
| 主 Agent | 小型状态文件 | 调度与用户交付 | 自己搜索、合成、手改报告 |
| Scout | 用户目标、侦察规则 | `landscape.json` | 深挖、浏览器操作 |
| Search | task_spec、directions、hints | 独占 raw JSONL | 读 findings、写别人的文件 |
| Boundary | task_spec、stats、findings、follow-ups | `boundary-report.json` | 新搜索、审查引用 |
| Synthesize | task_spec、stats、findings | `draft.md` | 网络请求、补写无证据事实 |
| Review | draft、findings | `audit-report.json` | 新研究、改草稿 |

每个子 Agent 直接写自己的文件，回复只报告状态。主 Agent 不再承担“把返回文字搬进文件”的隐形职责。

## 3. 数据真相

### 3.1 原始账本

```text
raw/search-r<round>-<agent>.jsonl
```

- 每个 Agent 独占一个文件，避免并发冲突。
- 文件名必须带轮次和唯一 Agent 名。
- 结束时必须有且只有一个 `agent_done`。
- `agent_done.visual_scan.pages[]` 必须覆盖每个 finding 的每个来源页，逐页记录候选图片数、保留数和未保留原因。
- raw 是唯一原始账本，保留历史。

### 3.2 派生结果

`normalize.mjs` 每次读取全部 raw，从零确定性重建：

- `findings.jsonl`
- `stats-summary.json`
- `parse_errors.log`（有问题时）

禁止向旧 findings 追加。同一批 raw 重跑，findings 必须逐字一致。

### 3.3 finding 核心字段

```json
{
  "claim": "带上下文、限制和影响的结论",
  "claim_key": "1:entity:field",
  "subquestion_ids": ["1"],
  "fields_covered": ["价格"],
  "sources": [
    {
      "url": "https://example.com",
      "tier": "T1",
      "stance": "supports",
      "observed_at": "2026-07-18T00:00:00Z",
      "source_date": "2026-07-01"
    }
  ],
  "context_links": [
    {"claim_key":"1:other:field","relationship":"compares"}
  ],
  "visuals": [
    {
      "kind": "diagram",
      "image_url": "https://example.com/workflow.png",
      "source_page_url": "https://example.com",
      "caption": "官方流程图展示三个处理阶段",
      "observed_at": "2026-07-18T00:00:00Z"
    }
  ]
}
```

`confidence` 不由搜索 Agent 自评，而由来源机械推导：

- 多个独立域名支持且至少一个 T1 → 已验证事实
- 单个 T1/T2 → 高置信推断
- 只有 T3 → 未确认线索
- 同时有支持与反对来源 → 冲突信息

`red_flag` 也必须有结构化 `sources`。它记录旧版、矛盾或不可靠页面，目的是让成稿能内联说明“为什么排除”，不是把这些来源计入当前有效事实。草稿检查门允许引用 finding 和 red_flag 的结构化来源；Review 必须确认 red_flag 始终以限制或否定语义出现。

### 3.4 视觉证据链

`task_spec.md` 必须声明 `visual_evidence`：普通研究默认 `auto`，依赖界面、图表或流程图的任务用 `required`，只有用户明确不要图片或页面敏感时才可用 `off` 并说明原因。

搜索 Agent 对每个已采用来源页检查 `img / picture / svg / figure` 等视觉候选。网页已有清晰原图时登记 `image_url`；动态交互、Canvas（画布）或无法取得原图时才保存 `screenshot_path`。每张图必须带 `source_page_url`、解释性图注和抓取时间；logo、头像、广告、背景图不算视觉证据。

`normalize.mjs` 会去重并统计 `total_visuals`。Synthesize（合成）必须把所有已登记图片放进 `draft.md`，草稿门拒绝漏图和来源不明图片；Review 通过 `visual_audit` 逐张核对来源、可达性、图注、相关性和是否已嵌入。

## 4. 完成标准

每个子问题声明：

- `min_sources`
- `min_t1`
- `required_fields`
- `max_age_days`
- `known_limit`（只有确实无法取得时使用）

统计只认 finding 的显式 `subquestion_ids` 和 `fields_covered`，不根据中文标题猜归属。过期来源不计入完成标准。一个全局“已知限制”不能放行多个未完成问题。

## 5. 7 种深度形态

| task_type | 下一轮需要的关系 | 机器标记 |
|---|---|---|
| comparison | 跨实体参照 | `compares` |
| deep_dive | 基于上层继续下钻 | `extends` |
| timeline | 追踪后续事件 | `follows` / `causes` |
| causal | 补充或反驳解释 | `causes` / `complements` / `contradicts` |
| problem_solving | 解法边界与适用条件 | `bounds` / `compares` / `complements` |
| enumeration | 已有成员基础上补漏 | `complements` |
| debate | 补正反方或相互反驳 | `contradicts` / `complements` |

主 Agent 先运行 `classify-task.mjs` 根据明确措辞初判；没有清晰信号时返回 `general / needs_judgment`，由主 Agent结合用户真实意图判断，不伪装成高置信自动分类。

Boundary 从全局 findings 提炼 3-5 条 hint，每条必须带 `source_claim_keys`。`inject-hints.mjs` 把它们注入下一轮。Round 2+ finding 再用 `context_links` 指回前序结论，`check-depth.mjs` 按任务类型验证关系。

这条链路解决 `CURRENT-PROBLEM.md` 的核心问题：Agent 互不通信，但下一轮能获得前序结论，而且是否使用可以被检查。

## 6. 收敛

`calc-novelty.mjs` 是唯一收敛计算来源：

- Rule A：连续两轮没有新事实。
- Rule B：至少五轮，最近三轮新增数不升，且末轮信息增益低于 20%。

结果写进 `progress.json.convergence`，其他检查门只读取，不复制一套简化规则。

收敛只表示“继续搜索收益很低”，不表示未完成问题自动完成。未完成问题必须逐项写 `known_limit` 才能进入合成。

## 7. 检查门

| phase | 真正检查什么 |
|---|---|
| 1.5 | landscape JSON、实体、视角和来源数量 |
| 2 | task_spec 的逐题标准、图片策略和 progress |
| 2-typecheck | task_type 合法 |
| 3-raw | 轮次文件名、结束标记、证据字段与来源、逐页图片扫描和结构化视觉证据 |
| 3-findings | findings 与 stats 数量一致、图片统计一致、无未分配或未知轮次 |
| 4 | boundary JSON 结构与语义是否自洽；不该停就硬拦 |
| 7-ready | 每题完成或逐题限制、无实体错误 |
| 7-draft | 每题有章节、URL 全部有结构化来源、限制已披露、所有有用图片已嵌入且无孤儿图片 |
| 8-audit | 严重和普通问题都清零、抽样足够、图片全审、passed=true |

报告使用 JSON，是因为本项目坚持零依赖；JSON 可以由 Node.js 严格读取，YAML 文本匹配做不到可靠验收。

## 8. 浏览器边界

- 先分流，再检查环境。
- `--mode light` 不要求浏览器。
- 网络搜索返回空、受限或超时后，只允许一次有实质变化的查询改写；禁止固定等待。
- WebFetch / reader 返回空、登录墙、脚本空壳或超时后，立即升级浏览器，不对同一 URL 做 2s / 5s / 10s 重试。
- `--mode full` 要求 Node.js ≥ 24、`agent-browser` ≥ 0.28 和可连接 Chrome；Node 版本不足时必须先报错且不安装不兼容包。版本合格后，执行模式缺少或过旧 CLI 时必须自动运行 `npm i -g agent-browser@latest`，`--check-only` 保持只读并只报告下一步。
- 浏览器只连接用户当前使用、已经登录的 Chrome：用户在现有 Chrome 开启 `chrome://inspect/#remote-debugging`，Agent 的所有命令都带 `--cdp <字面端口>`。
- 所有浏览器命令复用同一个默认 `agent-browser` 后台服务，并使用 `agent-browser --cdp <字面端口> --idle-timeout 1h <command>`。禁止使用 `--session` 或 `--namespace` 创建额外后台服务，禁止启动或复用其他常驻 CDP 代理；闲置退出只断开控制，不关闭用户 Chrome。
- full 检查不能只验证端口或模糊搜索命令参数；还必须核对监听进程的真实可执行文件。只有日常稳定版 Google Chrome 且未使用非默认 `--user-data-dir`、手工调试启动参数时才返回 `browser_identity: verified-user-chrome`。Chrome for Testing、Chrome Dev、Chromium、独立自动化目录和把 Chrome 路径塞进参数的普通进程一律拒绝。
- 禁止裸跑 `agent-browser open`、禁止 `--profile`、禁止 `agent-browser install`、禁止自动启动或关闭 Chrome。
- Search 没有可用端口时返回 `BROWSER_CONTROL_REQUIRED`，保留未完成 raw 且不写 `agent_done`；主 Agent 引导用户接通后以同一 Agent 名续跑。
- `launch-chrome.mjs` 不是研究兜底，只是用户明确选择并接受重启 Chrome 后才可运行的独立诊断工具。

## 9. 测试策略

测试必须证明行为，而不是只检查文档里出现某句话：

- 同一批 raw 重跑不会重复。
- 两轮同一事实合并并保留 `rounds_seen`。
- 中文子问题、required_fields 和来源日期正确计算。
- 7 种 task_type 的第二轮关系全部通过端到端夹具。
- boundary false、孤儿 URL、未清零审计都能被拒绝。
- red_flag 缺结构化来源会在 raw 门失败；以限制语义引用其来源可以通过草稿门。
- 漏扫任一已采用来源页、漏放已登记图片、混入孤儿图片或缺少视觉审查都会失败。
- Rule A 和 Rule B 独立测试。
- 用户未确认时，Chrome 启动脚本不得执行关闭动作。
- 搜索/读取失败契约不能包含 2s / 5s / 10s 固定重试；没有端口时必须产生 `BROWSER_CONTROL_REQUIRED` 交接。
- full 检查缺 CLI 时必须给出安装命令，并明确目标是现有登录态 Chrome；搜索任务禁止 `close --all`。
- 浏览器任务契约必须包含 `--idle-timeout 1h`，禁止 `--session` / `--namespace` 生成额外控制连接。

具体命令见 `TESTING.md`。

## 10. 当前限制

- 机器可以验证“跨轮连接存在”，但连接是否在语义上精彩仍由 Boundary 和 Review 复核。
- 真正的反爬、登录态和跨平台 Chrome 行为仍需要人工环境测试。
- 自动测试能证明提示与任务契约存在，但不能替代逐站确认“现有 Chrome 在目标网站确实已登录”。
- `find-url.mjs` 依赖本机 Chrome 历史数据库，自动测试只能覆盖参数和无数据路径。
