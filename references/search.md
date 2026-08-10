# 搜索执行

**总体策略**：先阔再深，简短关键词起步，明确范围；缺什么补什么；不为节省 token 牺牲完整性。

---

## 1. 必搜 vs 必不搜

**必搜**：
- 时效信息（新闻、价格、比分、版本号、融资）
- 陌生专有名词——产品、公司、人物、事件（unrecognized capitalized word 几乎肯定是名字）
- "现任 X"、"最新 Y"、"今天 Z"
- 用户引用 URL（要 fetch，不是 search）
- 高风险话题（金融/医疗/法律）必须多源核对

**必不搜**：
- 既定事实（数学定理、历史确确日期）
- 用户已在对话里提供过的内容
- 创意写作、闲聊、问候
- 已去世人物的身份查询（除非问"最近做过什么"）

**关键判断**：用户的问题是不是依赖"可能已经变了"的信息？是 → 搜。不是 → 直答。

---

## 2. 起步查询规则

**形式约束**：
- 1-6 词短查询优先；先 broad（1-2 词），不够再 narrow
- 双语：用户中文问 → 发中文 + 英文两个 query
- 禁用 `-` 排除、`site:` 限定、引号精确匹配、长句塞搜索框（query 不是 prompt）

**正向规则（每条 query 必须能回答"为什么发这条"）**：
- 正确示例：单名词（`anthropic pricing`）、组合（`claude 3.5 sonnet vs gpt-4o`）、动词+名词（`claude api rate limits`）
- 错误示例：把用户原话整句塞搜索框、用问句（`how much does claude cost`）、塞多个意图
- **隐式 reason**：每条 query 在心里要能说出"发这条是为了补什么 gap / 验证什么假设"，说不出来就别发

**多查询并行**：仅在问题需要按"含义不同"维度分解时（"对比 A 和 B 的定价"），才同时发多个 query。否则单查询优先。

---

## 3. 工具选择决策树（缺什么补什么）

- **缺入口**（不知道去哪找）→ 网络搜索 发现候选来源
- **缺正文**（知道在哪但没读内容）→ 网页读取工具先拿；返回空、登录墙、脚本空壳或超时 → 立即用浏览器操控工具，不要对同一 URL 固定等待后反复抓
- **缺证据强度**（需要确认真实性）→ 网页读取工具 结果只是线索；核心结论必须回原始来源验证；不确定 网页读取工具 给的是不是真的 → 浏览器
- **缺交互 / 登录态 / 动态内容** → 浏览器
- **其他工具都不可用**（网络搜索被限，WebFetch / reader 返回空或失败）→ 必须用浏览器，不能因为没有轻量工具就放弃；浏览器未就绪时立即请求主 Agent 引导用户开启，不把它静默写成最终缺口

| 能力 | 适合做什么 | 证据边界 |
|------|------------|----------|
| **网络搜索** | 发现候选、别名、关键词地图 | snippet 有偏置，不能直接当证明 |
| **网页读取** | 快速读正文、扫静态页面 | 不保证动态内容、登录态、页面真实状态 |
| **浏览器操控** | 一手验证、动态渲染、登录、交互 | 适合高价值验证，不适合大范围扫网页 |
| **本地历史 / 书签** | 找用户曾访问、组织内部入口 | 入口记忆，不等于事实证据 |

工具证据边界见上方表格；失败兜底表见下方「失败兜底」段；具体浏览器命令见 `references/tool-guide.md`。

**升级时限（硬规则）**：网络搜索失败后只允许一次有实质变化的查询改写，不允许靠 sleep 等它恢复；网页读取失败不做 2s / 5s / 10s 之类的定时重试，直接升级浏览器。浏览器是最终兜底，不是放弃信号。

**登录态（硬规则）**：浏览器必须通过同次 full 检查返回的完整调试地址连接用户当前正在使用、已经登录的 Chrome：`agent-browser --cdp 'ws://127.0.0.1:<port>/devtools/browser/<id>' --idle-timeout 1h <command>`，而且检查结果中的 `browser_identity` 必须是 `verified-user-chrome`。端口只用于核对浏览器身份；禁止只传端口等待授权，也禁止猜测、拼接或复用旧的完整地址。Chrome 重启或连接地址失效时，保留已有 raw、不写 `agent_done`，返回 `BROWSER_CONTROL_REQUIRED`，由主 Agent 重新执行 full 检查。所有命令复用默认后台服务；禁止使用 `--session` 或 `--namespace` 创建额外后台服务，禁止启动或复用其他常驻 CDP 代理。Chrome for Testing、Chrome Dev、Chromium、独立 `--user-data-dir` 或手工调试启动实例即使端口可连也不允许使用。禁止裸跑 `agent-browser open`，禁止 `--profile`，禁止运行 `agent-browser install` 下载新的测试浏览器，也禁止自动调用 `launch-chrome.mjs` 重开 Chrome。

---

## 4. 核心循环（硬约束——不允许搜一轮就返回）

搜索 Agent 必须跑完整迭代循环，直到满足退出条件：

```
搜 → 读页面 → 反思 → 够不够？
 ↑                  ↓
 └── 不够，改写 query ──┘
```

**循环条件**：gap analysis 显示还有未验证的 must-verify 项 → 继续搜

**退出条件**（必须满足第 1 条，或第 2+3 条同时成立）：
1. 所有 must-verify 项已验证（回原始来源确认）
2. 连续 2 次搜索返回类似信息（无新 claim 产出）
3. **每个 must-verify 维度至少有 2 条 ≥200 字符的 finding**（浅断言不算数——见下方 finding 密度要求）

**绝对不允许**搜一轮就返回——那是浪费主 Agent 的派发。
### 4.1 gap 反哺（硬规则）

每轮搜完做 gap analysis，按固定步骤：
1. **列 gap**：当前轮拿到了什么、还缺什么（具体到字段，如"还缺价格数字"、"还缺时间戳"）
2. **改写 query**：针对每个 gap 写 1-3 条新 query，每条带隐式 reason（为什么这条能补这个 gap）
3. **再搜**
4. **预警**：最近 2 次搜索返回类似信息 → 不再发相似 query，不会产生新结果

### 4.2 反思（硬规则）

**每次 search 后必须反思，写入中间记录才能进入下一步**。反思不是泛泛"想想"，必须输出 4 个字段：

- 当前 gap：还缺什么
- 是否同路径重复：最近 2 轮是不是搜了相似 query / 看了相似站点
- 是否需换路：当前路径是不是只剩 SEO 文 / 营销页 / 网页读取工具 失真
- 下一步 query 怎么改：具体的改写方向（不是"再搜一次"，是"换来源类型" / "加时间限定" / "换语言"）
- **已试方向记录**：本任务已搜过哪些方向（主题角度 / 来源类型 / 工具）。新方向必须与已试不同——这是反认知循环的硬规则。

### 4.3 中间记录格式（JSONL，直写 raw/ 文件）

搜索 Agent **不返回 stdout 给主 Agent**。唯一例外是浏览器兜底尚未就绪时返回 `BROWSER_CONTROL_REQUIRED`，让主 Agent 取得用户动作；此时保留部分 raw 且不写 `agent_done`。正常研究中，每搜到一条 finding/gap/red_flag，立刻写入自己独占的 `<task-dir>/raw/search-r<round>-<agent-name>.jsonl`。

**直写流程**（Write 工具是覆盖不是追加，所以要先 Read 再拼接）：
1. Read 你的 raw 文件（`<task-dir>/raw/search-r<round>-<agent-name>.jsonl`，不存在则视为空）
2. 把新行追加到末尾
3. Write 全量覆盖回去

每行一个 JSON 对象（**硬约束——字段和值不允许自创**）：

**finding 密度指导**：claim 应回答“是什么 + 为什么 + 有什么限制 + 场景影响”，不要只甩结论。少于 200 字符会被深度门提醒，但真正的硬检查是来源、字段归属和跨轮递进，不能靠堆字数过门。

```jsonl
{"type":"finding","claim":"Claude API 输入定价及其适用条件……","claim_key":"1:claude:api_pricing","subquestion_ids":["1"],"fields_covered":["输入价格","输出价格","长上下文加价"],"sources":[{"url":"https://www.anthropic.com/pricing","tier":"T1","stance":"supports","observed_at":"2026-07-18T00:00:00Z","source_date":"2026-07-01"},{"url":"https://example.org/independent-review","tier":"T2","stance":"supports","observed_at":"2026-07-18T00:00:00Z"}],"dimensions_seen":[{"dimension":"价格/合同条款","observation":"长上下文需要额外付费"}],"visuals":[]}
{"type":"gap","what":"还缺企业定价","reason":"销售页要求联系，未公开","subquestion_ids":["1"]}
{"type":"red_flag","claim":"第三方文章价格疑似过期","reason":"发布日期早于时效要求","subquestion_ids":["1"],"sources":[{"url":"https://example.org/old-price","tier":"T3","stance":"supports","observed_at":"2026-07-18T00:00:00Z","source_date":"2024-01-01"}]}
```

❌ **反面教材**（不要这样写）：`"claim":"Claude API 定价 $3/M"`——只有结论，没有上下文、对比、限制、场景影响。这种浅断言浪费一次搜索。

**退出前必写 agent_done sentinel**——用 Write append 最后一行：
```jsonl
{"type":"agent_done","agent":"<agent-name>","lines_written":<agent_done 之前的 finding/gap/red_flag 行数>,"ts":"<当前 ISO 时间>","visual_scan":{"status":"captured 或 none_useful","candidates_seen":<各页候选合计>,"useful_saved":<visuals 总数>,"reason":"全部没有保存时说明总原因","pages":[{"url":"<被采用的来源页>","candidates_seen":<该页候选数>,"useful_saved":<该页保存数>,"reason":"该页没有保存时说明原因"}]}}
```

`lines_written` **不包含 `agent_done` 本身**。例如文件里有 4 条 finding + 1 条 agent_done，必须写 `"lines_written": 4`，不是 5。
不写这行 = 归一化器认为你被杀了，触发重派。

**不要返回 stdout 给主 Agent**——你的所有正常产出在 raw 文件里。唯一例外是浏览器控制未就绪时返回 `BROWSER_CONTROL_REQUIRED`；归一化器（`normalize.mjs`）会在任务真正完成后从全部 raw 文件确定性重建 findings.jsonl。

**`type` 字段——只允许以下 3 个值**（加 agent_done sentinel）：
- `finding`：已验证或已提取的事实（**不允许** `funding_round` / `valuation` / `investor` 等自定义类型——把分类信息放进 `dimensions_seen`）
- `gap`：还缺什么（字段用 `what` + `reason`，不用 `claim` / `url`）
- `red_flag`：疑似过期 / 矛盾 / 不可靠（字段用 `claim` + `reason` + `sources`）。结构化来源用于证明“为什么要排除”，禁止只把 URL 塞在 reason 里。

**finding 和 red_flag 的 `sources` 必须保留全部独立证据**。每个来源包含 `url`、`tier`、`stance`、`observed_at`，知道发布日期时再加 `source_date`。同一事实多个来源合并进数组，禁止只保留一个网址。

**`tier`——字符串 `"T1"` / `"T2"` / `"T3"`，不是整数**：
- `"T1"`：官方文档、官方博客、监管文件、同行评议
- `"T2"`：行业分析、第三方评测、GitHub issues、成熟评论站
- `"T3"`：搜索摘要、SEO 文、未署名新闻稿、单条论坛评论
- ❌ `1` / `2` / `3`（整数不接受）
- ❌ `"primary"` / `"secondary"` / `"tertiary"`

**归属与覆盖字段**：
- `subquestion_ids`：必须填写主 Agent 派发时指定的子问题编号；一条证据可以属于多个子问题。
- `fields_covered`：只填写证据真正覆盖的 `required_fields`；无法覆盖就留空，禁止为了过门乱标。
- `claim_key`：使用“子问题:实体:字段”稳定命名。同一事实换种说法仍用同一个 key，让多轮去重和新发现率可信。
- `confidence`、`claim_id`、`round` 和 `agent` 由归一化器根据来源和文件名生成，搜索 Agent 不写。
- `context_links`：Round 2+ 收到 `[source_claim_keys: ...]` 线索后，相关 finding 必须引用前序 `claim_key`，并标明 `compares / extends / follows / causes / contradicts / complements / bounds` 之一。它是“这一轮真的利用了跨 Agent 线索”的机器证据。

**`dimensions_seen` 必须是对象数组**（不是字符串数组）：
- ✅ `[{"dimension":"视角覆盖","observation":"Reddit 用户吐槽价格涨幅","source_url":"https://reddit.com/..."}]`
- ❌ `["amount","date"]`（扁平字符串不接受——分类信息放 `dimension` 字段，具体观察放 `observation` 字段）
- `dimension`：必须是 `references/boundary.md` 的 4 固定维度之一（`来源类型多样性` / `视角覆盖` / `时间覆盖` / `地域/语境覆盖`）或已声明的扩展名（`价格/合同条款` / `安全/合规` / `性能基准` / `法务/监管` / `可信度/权威性` / `可重现性/方法学` / `集成/互操作` / `社区生态/采用度`）
- `observation`：该维度的具体观察（一句话，附 URL 最好）
- `source_url`：观察来源（可选但推荐）

**`visuals`（每条 finding 必须有数组，没有有用图片时写 `[]`）**：

```json
[{"kind":"diagram","image_url":"https://example.com/architecture.png","source_page_url":"https://example.com/architecture","caption":"官方架构图，展示请求经过三个处理层","observed_at":"2026-07-18T00:00:00Z"}]
```

- `kind`：只允许 `chart / table / diagram / ui / infographic / photo / other`。
- `image_url` 与 `screenshot_path` 必须二选一。网页已有清晰原图时优先 `image_url`；只有动态状态、交互结果或原图无法取得时才截图。
- `source_page_url` 必须同时出现在该 finding 的 `sources[]`，防止图片失去出处。
- `caption` 必须解释“图里是什么、为什么对结论有用”，不能只写“截图 1”。
- 每条 finding 最多 3 张，只登记报告中值得展示的图片；logo、头像、背景、广告和重复缩略图不要登记。

**写 raw 文件前必须去重**：同维度多条观察合并；不允许返回 5 条都是「视角覆盖」的 dimensions_seen。

### 4.4 已试方向记录（directions.json）

主 Agent 维护 `~/.sleuth/output/<task-name>/directions.json`，记录每轮派发的搜索方向。搜索 Agent 通过 `--task-dir` 读取该文件，避免重做已试方向。

**directions.json 格式**：

```json
[
  {"round":1,"direction":"OpenAI 商业模式","source_type":"官方","agent":"search-1","ts":"..."},
  {"round":2,"direction":"社区对 OpenAI 的批评","source_type":"社区","agent":"search-3","ts":"..."}
]
```

字段：
- `round`: 哪一轮派的方向
- `direction`: 方向描述（一句话，主题角度）
- `source_type`: 来源类型枚举（`官方` / `第三方` / `社区` / `学术` / `新闻`）
- `agent`: 派发的 agent 名
- `ts`: ISO 时间戳

**重复判定规则**（搜索 Agent 读后必走）：
- 新方向的 `direction` + `source_type` 组合已在列表里 → **重复**，必须换路
- `direction` 相似 → 判断实质是否重复——两次搜索是否大概率产出重叠结果。若高度重叠，即使 `source_type` 不同也视为重复，换角度而非换标签
- `direction` 完全不同 → 不算重复

### 4.5 返回前 cleanup（硬约束）

返回 findings 之前，必须做一次清理压缩。不返回 raw HTML、不返回搜索摘要原文、不返回 tool call 日志。

清理步骤：
1. **删失败结果**：删掉失败的 tool call、404 页面、登录墙挡住的空结果
2. **删跑题内容**：和 must-verify 无关的页面内容删掉
3. **合并重复**：同一事实多个源 → 合成一条 finding，全部来源保留在 `sources` 数组
4. **补全字段**：每条 finding 必须有 claim + claim_key + subquestion_ids + fields_covered + sources + dimensions_seen + visuals
5. **提取 follow_up_questions**：搜索过程中发现的新实体 / 新概念 / 未覆盖方向，提取成具体问题

follow_up_questions 规则：
- 每条 finding 可以带 0-N 个 follow_up_questions
- 只在发现了**新实体/新概念**时才提（不是“再搜一次”）
- 每个必须是具体的问题（例：“Genesys 是否也有 AOP 机制？”）

写入 raw 文件的 JSONL 里，finding 类型可以带 follow_up_questions 字段：

    {"type":"finding","claim":"...","claim_key":"1:genesys:aop","subquestion_ids":["1"],"fields_covered":["机制"],"sources":[{"url":"https://...","tier":"T1","stance":"supports","observed_at":"2026-07-18T00:00:00Z"}],"dimensions_seen":[],"visuals":[],"follow_up_questions":["Genesys 是否也有 AOP 机制？"]}

**cleanup 是写入前的最后一道工序——不清理就写等于把垃圾丢进 raw/。**
---

## 5. 终止信号

**可以停**（满足任一）：
1. 能全面回答用户问题——核心事实都有源支撑
2. 已有 3+ 个相关的独立来源——不是 3 个转载同一个源
3. 最近 2 次搜索返回类似信息——再搜也是冗余

**不能停**：
- 关键结论只有单一脆弱来源
- 存在明显冲突但还没说明
- 重要数字没有时间戳或来源
- 只是"流程做完了"但问题还没真正回答

**判断哲学**：停不停看"用户能不能拿这个报告做决策"，不是"搜了几轮"。再加一轮不会改变用户决策就停；会改变就继续。无 hard cap。

---

## 6. 多模态提取策略

策略本身在这里讲，具体 浏览器操控命令看 `references/tool-guide.md`「特殊内容类型」段。

### 6.1 文本

reader 是线索不是证据。核心结论必须回原始来源（浏览器或官方一手页）验证。

### 6.2 图片（每个采用的一手页面都要扫描）

文字抓取能看见页面正文，不代表图片已经进入证据库。每个最终采用的一手页面都必须做一次视觉候选检查：能直接取得 HTML 时检查 `img / picture / svg / figure`；动态页面或懒加载页面再使用浏览器；图片明显是核心证据但页面提取看不到时，使用图片搜索定位同一官方来源。

- **证据型**（定价表、性能图、流程图）：分析图中事实，把结论写入 claim，同时把原图或截图写进 `visuals[]`，让读者可以复核。
- **呈现型**（产品 UI、架构图、官方信息图）：分析它帮助理解的部分，写入 `visuals[]`，成稿会自动内嵌。
- 网页已有清晰原图 → 优先保存 `image_url`，不必重复截屏。
- 只有动态状态、交互结果、画布或原图无法直接取得 → 浏览器截图，搬到 `<task-dir>/screenshots/` 后保存 `screenshot_path`。

**什么时候必须登记为有用图片**——遇到以下内容且与任务结论有关时：
1. 定价 / 套餐表（数字密集，截图比文字转录准）
2. 对比表 / 规格表（多列横向对比，文字转录易错）
3. 架构图 / 流程图 / 示意图（无法用文字还原）
4. UI 界面 / 产品截图（评测类、选型类报告必需）
5. 官方 benchmark 图表（性能数据可视化）

**回写 JSONL（关键）**：有用图片必须写入对应 finding 的 `visuals[]`：
```jsonl
{"type":"finding","claim":"官方流程图展示请求依次经过路由、执行和人工接管","claim_key":"1:product:workflow","subquestion_ids":["1"],"fields_covered":["流程"],"sources":[{"url":"https://example.com/workflow","tier":"T1","stance":"supports","observed_at":"2026-07-18T00:00:00Z"}],"visuals":[{"kind":"diagram","image_url":"https://example.com/workflow.png","source_page_url":"https://example.com/workflow","caption":"官方流程图，展示路由到人工接管的完整路径","observed_at":"2026-07-18T00:00:00Z"}],"dimensions_seen":[]}
```

退出前的 `agent_done.visual_scan` 必须逐页记录：`pages[]` 覆盖每个 finding 的每个来源 URL，分别写看过多少候选、保存多少有用图片；某页没有保存时写具体理由。顶层数量必须等于逐页合计。这样“页面有图但被全部略过”会定位到具体来源页，不能用一句笼统理由带过。

**不做**：不对敏感 / 登录后页面截图；归档仅作研究留证，尊重版权。

### 6.3 视频 / 音频 / PDF

- 视频：字幕优先——用 `scripts/extract-subtitles.sh <URL>` 提取 YouTube 字幕，再用 `scripts/srt_to_transcript.py` 转成文本。无字幕时操控 `<video>` + screenshot 采帧（短视频 5-8 帧，中等 10-15 帧）
- 音频/播客：优先提取已有字幕和 shownotes，搜 `"播客名" transcript`。均失败告知用户无公开字幕，不伪造转录
- PDF：eval 找链接 `document.querySelectorAll('a[href$=".pdf"]')`，下载后用 Read 工具读取；arXiv 论文直接访问 `arxiv.org/pdf/<论文ID>`

### 6.4 DOM 提取

折叠区块、懒加载、Shadow DOM、iframe 的提取技巧见 `references/tool-guide.md`「DOM 技巧」段。

---


---

## 失败兜底

工具失败不是放弃的理由——按「触发信号 → 一线修复 → 仍失败兜底」处理，绝不拿空结果或搜索摘要冒充一手事实。

| 失败信号 | 一线修复 | 仍失败兜底 |
|---|---|---|
| 网络搜索被限 / 返回空 / 超时 | 只改一次关键词或别名，不固定等待 | 立即用 `--cdp <port>` 连接现有 Chrome 找入口 |
| WebFetch / reader 返回空、登录墙、疑似 JS 壳或超时 | 不重复等同一 URL，立即用 `--cdp <port>` 抓真实渲染 | 仍拿不到 → 该来源标「未取得正文」写入缺口，不拿空结果当内容 |
| 浏览器控制未就绪 | 保留已写 raw，不写 `agent_done`；立即向主 Agent 返回 `BROWSER_CONTROL_REQUIRED: <目标 URL + 失败原因>` | 主 Agent 安装或升级 CLI、引导用户开启现有 Chrome 控制，再以同一 Agent 名续跑 |
| 页面需登录但现有 Chrome 未登录 | 停在该页面，请用户在这个现有 Chrome 标签页手动登录，完成后继续 | 仍无法确认 → 写「登录态未验证」入缺口，不伪造；禁止另开浏览器或提取凭据 |
| 浏览器连接丢失 | 立即返回 `BROWSER_CONTROL_REQUIRED`，让主 Agent 恢复同一个 Chrome 的控制 | 关键结论重验前不得当已确认事实；禁止自行重启 Chrome |
| 同一路径反复失败、无新信息 | 换路：换来源 / 换工具 / 换角度 | 仍无突破 → 如实在报告里披露未解决的缺口，不盲目重试 |

**失败是反馈，不是命令你原地重试。**
## 反模式

- **永远在搜，不返回 dimensions_seen**——dimensions_seen 是给主 Agent / 边界 Agent 判断覆盖度的关键数据，不返回等于让全局判断瞎了一只眼
- **每轮都换完全不同的方向**——没有积累，每轮从零开始。应该有积累，每轮基于上一轮的 gap
- **只搜正面材料**——核心结论要经得起反证。对每个关键事实主动搜反证（complaint / lawsuit / limitation / vs alternative）
- **抄源结构**——不要用 bullet list 重现原文章结构（版权问题 + 没加价值）。重新组织
- **同一路径反复试**——连续两轮没新信息就换路（换来源类型 / 换工具 / 换角度）
- **把浏览器没准备好当普通 gap**——这会让主 Agent 不知道需要用户动作。必须返回 `BROWSER_CONTROL_REQUIRED`，等现有登录态 Chrome 接通后续跑
