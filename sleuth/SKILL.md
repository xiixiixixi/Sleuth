---
name: sleuth
description: 梦里寻 — 联网检索与浏览器操作。触发场景：搜索信息、查看网页、登录访问、社交媒体抓取、动态页面渲染等一切需要真实浏览器的网络任务。
---

# sleuth — 梦里寻

## 前置检查

在开始联网操作前，先判断问题复杂度，再按需执行环境检查：

### 问题分类

在开始任何操作前，先判断问题类型。如果 sleuth-output/ 中有相关历史文件，优先评估能否复用。判断维度：

| 维度 | 简单问题 | 复杂问题 |
|------|---------|---------|
| 答案结构 | 单一事实、一句话能答 | 需要多源整合、对比分析 |
| 来源需求 | 不需要来源或单一来源即可 | 需要交叉验证、一手来源 |
| 时效性 | 不需要实时数据或单次确认即可 | 需要持续追踪最新动态 |
| 交互需求 | 不需要登录、不涉及反爬平台 | 需要登录态、动态渲染、反爬平台 |

**简单问题** — 事实查询、单一答案、不需要多源交叉验证。例如：「法国的首都是什么」「npm install 报 EACCES 怎么修」「React 18 的 concurrent mode 是什么」。

→ **直接回复**，跳过完整前置检查（不运行 check-deps，不创建会话日志，不写交付文件）。如需确认，走轻量验证：agent-browser 打开一个搜索+一个页面，读完即关 tab。

「用一个搜索」指 agent-browser 打开 Google/Bing/百度，输入关键词，snapshot 看结果，点进最相关的一个页面读取——不是多角度多轮搜索。

如果问题中包含「最新」「现在」「今天」「当前」「实时」等时间指向词，或答案在任何过去 30 天内可能发生变化（版本号、价格、状态），则需要打开页面确认。

**简单路径故障恢复**：
- 页面不可达（超时/404/50x）→ 换一个来源（换搜索词或搜索引擎）再试一次
- 搜索结果为空 → 扩宽搜索词，或用中英文各搜一次
- 内容不匹配 → 在页面内搜关键词（eval document.body.innerText.match），或点进第二个结果
- 两次尝试均失败 → 降级回复并告知用户可启动完整检索流程

**不确定属于哪类**：先按简单问题处理——打开一个页面发现信息不够，再升级为完整流程。升级时先关闭简单路径打开的 tab，然后从「环境检查与初始化」开始。

**复杂问题** — 需要多源调研、对比分析、一手来源验证、跨平台信息整合。例如：「调研当前 AI 安全领域的最新进展」「比较这 5 款产品的优缺点」「找 XX 政策的一手原文并交叉验证」。

→ 走完整流程：环境检查 → 多角度搜索 → 子 Agent 循环调研 → 交叉验证 → 结果交付。

### 缓存优先判定

处理任何请求前，先检查 sleuth-output/ 是否有相关历史交付物。这比重新搜索快得多。

```bash
find ./sleuth-output/ ~/.sleuth/output/ ~/.sleuth/sessions/ -type f \( -name "*.json" -o -name "*.txt" -o -name "*.md" -o -name "*.png" \) 2>/dev/null | head -30
```

或定向搜索相关关键词：

```bash
grep -rl "关键词" ./sleuth-output/ ~/.sleuth/output/ ~/.sleuth/sessions/ 2>/dev/null | head -20
```

当 sleuth-output/ 文件较多时，用 Explore subagent 搜索缓存，避免大量文件路径占满主 context：

```
Agent({ subagent_type: "Explore", prompt: "在 sleuth-output/ 和 ~/.sleuth/sessions/ 中搜索关于「关键词」的相关文件。返回：是否找到、文件路径、修改时间、时效性评估。不要返回文件内容。" })
```

**找到相关文件后，按问题时效性分级处理：**

| 时效性 | 特征 | 缓存策略 | 示例 |
|--------|------|---------|------|
| **低** | 不随时间变化或变化极慢 | 7 天内的缓存直接用 | 历史事实、学术论文、技术文档、操作指南、API 参考 |
| **中** | 可能变化但周期较长 | 24 小时内的缓存直接用；超过 24 小时标注「以下来自 X 天前的缓存，可能有更新」 | 版本更新、产品评测、行业动态、一般新闻 |
| **高** | 需要当前时刻的最新数据 | 缓存仅供背景参考，**必须重新搜索**获取最新数据 | 实时股价、天气、汇率、赛事比分、今日突发新闻、热搜 |
| **确认/验证** | 用户要求重新确认旧结论 | 始终重新搜索，用旧会话日志中的搜索词和 URL 作为起点，新旧结果对比汇报差异 | 验证上一轮调研结论是否仍成立 |

**覆盖规则**：用户问题中包含「最新」「现在」「即时」「实时」「今日」等时间指向词 → 无论主题默认分类，直接按高时效处理。

**混合查询**：如果查询包含多个子问题，按子问题拆分时效性判断。高时效子问题走完整搜索，低时效子问题可直接从缓存或训练数据回答，最终合并。

**判定规则**：
1. 先用 `stat` 或 `ls -la` 查看文件修改时间
2. 对照上表判断时效性级别
3. **低时效** → 直接读取文件内容回复，附注来源时间
4. **中时效** → 文件在窗口期内直接复用；超出窗口期先复用再简要验证（打开一个聚合/对比页，检查 2-3 个关键条目是否仍一致）
5. **高时效** → 不依赖缓存，→ 跳转到下方的「环境检查与初始化」开始完整搜索流程，但可参考缓存中的上下文（如之前使用的搜索词、已访问的 URL）
6. **确认/验证** → 始终重新搜索，新旧对比汇报

不确定属于哪个级别时，按高时效处理——宁可多搜一次，不给过时信息。

**保留策略**：sleuth-output/ 下的文件保留 **7 天**。check-deps.mjs 每次运行自动清理过期日期目录。也可手动运行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/cleanup-output.mjs" [--days N] [--dry-run]
```

在启动完整搜索流程前，运行 `update-site-stats.mjs` 获取最新域名可信度。只读取得分 >0.6 或 <0.3 的站点经验文件。

### 环境检查与初始化（仅复杂问题）

运行环境检查：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

脚本自动检测 agent-browser 是否安装、Chrome 远程调试端口是否可用（跨平台：macOS/Linux/Windows）、已有的站点经验列表，并自动清理超过 7 天的过期输出文件。

**Chrome CDP 自动修复**：如果 Chrome 未开启 CDP 端口，check-deps 会自动关闭并重启 Chrome（保留登录态和 cookies）。如果自动重启失败，按提示手动执行。

**如果 check-deps.mjs 运行失败**（Node.js 未找到、权限错误等），向用户报告具体错误。如果问题不需要实时浏览（如已知事实、代码问题），从训练数据尝试回答。同时提供手动修复步骤（安装 agent-browser、开启 Chrome remote debugging）。

检查通过后创建会话日志和输出目录：

```bash
SID=$(node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action start --query "用户的原始问题" --type 查询类型)
SLEUTH_OUTPUT=$(node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid $SID)
```

记下会话日志 `$SID`，后续操作通过 `--sid $SID` 记录到同一会话日志。所有交付文件保存到 `$SLEUTH_OUTPUT/` 对应子目录。

确定目标域名后，通过 match-site.mjs 匹配站点经验：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/match-site.mjs" "<目标域名>"
```

检查通过后向用户展示以下须知，再执行浏览器操作：

> 温馨提示：部分站点对浏览器自动化操作检测严格，存在账号封禁风险。已内置防护措施但无法完全避免，Agent 继续操作即视为接受。

**隐私与安全**：
- 不对含敏感个人信息的页面截图（银行、邮箱、私信等）
- 不提取或外传浏览器 cookie 和已保存密码
- 访问内部/企业系统前先提醒用户确认
- 不在用户不知情的情况下创建账号或执行任何会产生记录的操作（发帖、评论、购买）

→ 环境就绪，进入「搜索与发现」开始搜索。

## 核心原则

- **任务驱动**：每一步围绕「我要达成什么」做决策。带着目标进入，边看边判断，不预设完整路径
- **边看边判**：打开页面后根据实际内容判断方向——不预判哪个来源最好，点进去看了才知道
- **遇阻则绕**：弹窗、登录墙、死链——先判断是否真的挡住了目标。内容可能已在 DOM 中，优先尝试穿透遮罩提取；挡住了才处理，没挡住就绕过
- **失败即信号**：搜索没命中不等于方法不对，可能目标不存在。API 报错、重试无改善时重新评估方向，不在同一方式上反复尝试
- **达成立止**：确认任务成功标准后立即停止，不过度操作

## 搜索与发现

sleuth 是你（包括你派出的子 Agent）唯一的联网工具——不把任务派给 WebSearch、WebFetch 等外部工具。搜、读、判断、深入，全程在浏览器内进行。完整 agent-browser 命令参考见 `references/tool-guide.md`。

### 结构化数据速查（实时数据、表格数据）

金融数据（股价、汇率、指数）、天气、体育比分等需要当前时刻数据的查询，跳过通用搜索：
- 直连数据源：东财 eastmoney.com、新浪财经、中国气象局、ESPN 等
- open 后 wait --load networkidle → snapshot + eval 提取表格
- 遇阻直接换下一个数据源，不走多角度搜索

### 搜索策略

**多角度搜索**。任何主题至少 4-5 个角度互为补充——一个角度结果中读到的新关键词，即为下一角度的搜索词：
- 核心概念/概览：What is X, X overview
- 最新动态/新闻：X latest, X 2026
- 技术细节/实现：X architecture, how X works
- 对比/替代方案：X vs Y, X alternatives
- 应用/案例：X use cases, X in production

**站内图片搜索**：Google Images (`tbm=isch`)、百度图片 (`image.baidu.com`)、小红书搜笔记 (`type=3`)。

**读全文，不读 snippet**。搜索引擎摘要可能过时、截断、误导——必须点进原文读完整内容。

**Broad → narrow 迭代**：
- 先宽搜看量级：50+ 结果覆盖面够，< 10 需拓宽搜索词
- 太多结果（>200）加限定词、时间范围、网站限定
- 太少则去掉限定、换同义词、中英文各搜一轮

**探索式循环**：搜索 → 看结果 → 点进 2-3 个最有希望的链接读全文 → 不够则回退点下一个 → 搜索结果耗尽用新关键词重新搜索 → 够了就停止。同一页点了 3 个链接不理想就换搜索词；仍无进展换搜索引擎（Google ↔ Bing ↔ 百度 ↔ 平台内搜索）。

**复杂调研迭代推进**：搜索宽泛词 → 读有希望的结果 → 识别信息缺口 → 用精确词再搜索 → 交叉验证 → 得出结论。不试图一次性并行覆盖所有方向。

**Token 预算意识**：优先使用 `snapshot -i -c`（compact 模式）节省 token。上下文窗口紧张时，只精读最有希望的 2-3 个结果而非全部。

**模糊查询做选择**：用户描述模糊时，先广撒网找到几个可能方向，然后问「找到了 A、B、C，你看哪个更接近？」——让用户做选择而不是填空。

### 可信度与归因

**一手 > 二手**。搜索引擎是发现工具而非验证工具，搜到来源后必须读原文。

| 信息类型 | 一手来源 |
|----------|---------|
| 政策/法规 | 发布机构官网 |
| 企业公告 | 公司官方新闻页 |
| 学术论文 | 原始论文/机构官网 |
| 工具能力/用法 | 官方文档、源码 |
| 产品数据 | 产品官网/用户实际截图 |

**交叉验证**：同一事实在 3 个以上独立来源中出现才算可信（4 个为佳）。注意：多个媒体引用同一错误来源会造成循环印证假象——追溯传播链源头，而非数引用次数。

找不到一手来源时，权威媒体原创报道（非转载）可作为次级依据，但必须声明：「未找到官方原文，以下来自[媒体名]报道，存在转述误差可能。」

**归因**：所有信息标注来源 URL。不给「据说」「有观点认为」等无来源表述。

### 本地资源

用户指向**本人访问过的页面**或**组织内部系统**时，先检索本地 Chrome 书签/历史：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" [关键词...] [--only bookmarks|history] [--limit N] [--since 1d|7h|YYYY-MM-DD] [--sort recent|visits]
```

找到 URL 后用 agent-browser 直接打开。

## 结构化调研（Plan Mode）

满足以下任一条件时，先进入 Plan Mode 制定调研计划，用户确认后再执行：
- 用户问题明确是复杂调研（「对比 X」「调研 X 领域」「全面了解 X」）
- 预计需要 3 个以上子 Agent 并行搜索
- 涉及多源交叉验证

Plan 必须采用**两阶段结构**：

**阶段 1 — 广度探索**：多角度并行搜索，每个角度一个子 Agent。目的：快速摸清信息地图，发现哪些方向有料、哪些是死路。此阶段不追求深度，追求覆盖面。

**阶段 2 — 深度定向**：基于阶段 1 的发现，只对「有料」的方向定向深入。目的：补齐一手来源、交叉验证关键事实、填平信息缺口。

每个阶段列出：
1. 搜索角度 + 渠道分配
2. 子 Agent 分配（哪个 Agent 搜什么）
3. 成功标准（需要几个独立来源、覆盖哪些子问题）
4. 交付物列表

Plan 中标注「由 Agent 自行判断」的环节，用户只需确认大方向。

## 递进式分治：子 Agent 循环调研

复杂调研任务不能靠一次并行搜索完成。**主 Agent 是总指挥，不是一次性任务分发器。** 核心模式是：发一轮 → 收结果 → 发现新方向 → 再发一轮 → 循环至信息充足。

### 总指挥模型

```
主 Agent（总指挥 — 负责判断、整合、决策）
    │
    ├─ 第 1 轮：广撒网（并行）
    │   ├─ 子 Agent A: 渠道 A + 搜索角度 1
    │   ├─ 子 Agent B: 渠道 B + 搜索角度 2
    │   └─ 子 Agent C: 渠道 C + 搜索角度 3
    │
    ├─ 汇总第 1 轮结果
    │   · 哪些方向有料？哪些方向死路？
    │   · 发现了什么新关键词、新术语、新人名？
    │   · 信息缺口在哪？（缺一手来源？缺中文视角？缺数据？）
    │
    ├─ 第 2 轮：定向深入（并行，基于第 1 轮发现）
    │   ├─ 子 Agent D: 用新关键词重新搜索
    │   ├─ 子 Agent E: 对缺口定向补充（换渠道、追一手）
    │   └─ 子 Agent F: 交叉验证第 1 轮的关键发现
    │
    ├─ 汇总第 2 轮结果
    │   · 关键事实有 3 个以上独立来源（4 个为佳）了吗？
    │   · 还有没有未覆盖的重要角度？
    │   · 信息量是否已经饱和（新搜索不再带来新发现）？
    │
    ├─ 第 N 轮：补缺验证（按需）
    │   └─ 只派仍有缺口的方向
    │
    └─ 确定信息充足 → 汇总输出
```

### 什么时候发下一轮

以下信号出现任一个就说明需要再发一轮：
- **发现了新关键词**：子 Agent 的阅读结果中出现了之前不知道的术语、产品名、人名 → 这些是新线索，必须追
- **来源质量不够**：找到的信息多是二手报道、博客、社交媒体帖子，缺乏一手来源 → 发子 Agent 专门追一手
- **不同语言信息不对称**：英文渠道找到了丰富内容但中文渠道空白（或反之）→ 发子 Agent 补另一语言
- **关键事实来源不足**：某个重要结论只有 1-2 个来源支撑，未达到 3 个以上独立来源（4 个为佳）的交叉验证门槛
- **用户追问**：用户对汇报的初步结论提出质疑或追问细节 → 针对质疑重新分配子 Agent

### 什么时候停止

- **信息饱和**：新发一轮搜索不再产生超过 20% 的新信息——这说明主流来源已穷尽
- **交叉验证达标**：所有关键事实都有 3 个以上独立来源（4 个为佳）支撑
- **一手来源到位**：每个事实链都能追溯到一手信息，而非停在三手转述
- **收益递减**：再发一轮的成本（时间、token）超过预期新增信息的价值

### 主 Agent 的职责

对于大规模并行调研，主 Agent 将搜索工作委托给子 Agent。对于中等复杂度的任务（如对比两个产品），主 Agent 直接使用「搜索与发现」中的策略自行搜索，不启动子 Agent。

主 Agent 核心做四件事：
1. **分解**：把调研任务拆成多个并行的搜索角度/渠道组合
2. **发令**：给每个子 Agent 清晰的目标描述（要什么，不限定怎么做）
3. **判断**：收结果后判断信息质量——够了还是需要再深入
4. **整合**：所有轮次完成后，把分散的发现整合成完整结论

### 子 Agent Prompt 写法与 Claude Code 调用方式

**核心原则**：
- 必须在子 Agent prompt 中写「必须加载 sleuth skill 并遵循指引」
- **描述目标，不指定手段**：「获取 X 项目的最新进展和社区反馈」而不是「搜索 X 项目」
- **避免动词暗示**：「搜索」会锚定到搜索引擎首页；「抓取」暗示用程序化方式。用「获取」「调研」「了解」
- **给上下文**：把当前已知信息和本轮要解决的问题说清楚，子 Agent 不需要从头开始
- 在 prompt 中显式包含：`Chrome CDP 端口：<当前端口号>`，子 Agent 用它直连 Chrome

**并行调研 → Background subagent**：

每个子 Agent 用 Claude Code 的 Agent 工具以 `run_in_background: true` 派出，主线程不阻塞。每个子 Agent 带 `--session <name>` 隔离浏览器 tab，完成后自行关闭 tab。

```
Agent({
  description: "3-5 词描述任务",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: `
    你是一个调研助手。必须加载 sleuth skill 并遵循其指引。

    任务：${目标描述}
    已知上下文：${主 Agent 提供的已知信息}
    Chrome CDP 端口：9222
    浏览器隔离：所有 agent-browser 命令加 --session ${session-name}
    Session ID：${SID}
    输出目录：${SLEUTH_OUTPUT}

    要求：
    1. 只返回摘要（关键发现 + 来源 URL），不要返回原始页面内容
    2. 重要文件通过 deliver.mjs 保存
    3. 遇到反爬/CAPTCHA/登录墙，记录到 session log（type: "captcha" / "login_wall" / "paywall"）
    4. 完成后关闭自己创建的 tab
  `
})
```

**汇总指引**：主 Agent 等待 background notification 收集各子 Agent 结果，做去重（同一 URL 只保留一份）和交叉验证。

## 浏览器操作

agent-browser 直连用户日常 Chrome，通过 `--cdp <port>` 或 `--auto-connect` 指定。若无用户明确要求，不主动操作用户已有 tab——所有操作在 agent-browser 自己管理的 tab 中进行。完整命令参考 `references/tool-guide.md`。

### Snapshot-first 工作流

```
1. open <url> → wait --load networkidle
2. snapshot -i                       # 获取交互元素 @ref
3. click @e3 / fill @e5 "text"       # 基于 ref 操作
   → wait --load networkidle
4. snapshot -i                       # 页面变化后必须重新 snapshot
```

当目标内容已提取完毕，跳出此循环，进入「内容提取」或「结果交付」。

**@ref 会过期**：每次 snapshot 重新编号，页面发生任何变化（导航、提交、动态渲染、弹窗）后 @ref 立即失效。不确定变化程度时宁可多 snapshot 一次。

### 等待策略

Agent 失败更多是因为等待不当，而非选择器错误。页面变化后选一种等待：
- 预期出现的特定元素：`wait @ref` 或 `wait --text "..."`
- URL 变化：`wait --url "**/new-page"`
- SPA 页面导航后兜底：`wait --load networkidle`

避免裸用 `wait 2000`——让操作变慢且不稳定。默认超时 25 秒。

### Tab 管理

- 批量打开页面每次不超过 5 个
- 同一域名两次操作间至少间隔 1-2 秒
- 任务结束后关闭自行创建的 tab，不关闭用户原有 tab

### 交互方式

两种方式灵活选择：
- **程序化**（构造 URL、eval 操作 DOM）：速度快、精确，但可能触发反爬
- **GUI 交互**（点击、填写、滚动）：确定性最高，网站不会限制正常 UI 操作

GUI 交互也是程序化方式的有效探测——通过真实交互观察站点行为（URL 模式、参数、跳转逻辑），为程序化操作提供依据。程序化受阻时 GUI 是可靠兜底。站点内交互产生的链接携带平台所需完整上下文，手动构造的 URL 可能缺失隐式参数导致被拦截。

## 内容提取

sleuth 覆盖所有内容类型：文本、图片、视频、音频、PDF、文档。以文本提取优先（效率最高，token 成本最低）。

### 文本提取

```bash
agent-browser --cdp <port> get text @ref                          # 定向提取可见文字
agent-browser --cdp <port> get attr @ref href                     # 获取链接地址
agent-browser --cdp <port> eval "document.body.innerText"         # 全页文本（首选）
agent-browser --cdp <port> eval "document.documentElement.outerHTML"  # 原始 HTML
```

复杂 JS 提取用 heredoc 避免引号转义问题：

```bash
agent-browser --cdp <port> eval --stdin <<'EOF'
const rows = document.querySelectorAll("table tbody tr");
Array.from(rows).map(r => ({
  name: r.cells[0].innerText,
  price: r.cells[1].innerText,
}));
EOF
```

结构化数据超过 10 行或用户要求保存时写入 `sleuth-output/data/`，JSON 优先，CSV 备选。

### 截图

绝大部分场景不需要截图——文本提取效率更高，token 成本更低。截图仅用于：
- 用户明确要求看页面样子
- 内容在图片/图表中无法用文字提取
- 调试时 Agent 无法通过文本理解页面状态（用 `/tmp`，任务结束删）

`screenshot --annotate` 可在截图上标注 @ref 编号，方便多模态模型定位元素。

### 图片内容

两种方式获取：
1. **DOM 提取**：`eval "Array.from(document.querySelectorAll('img')).map(i => i.src).filter(Boolean)"` 拿 URL 后下载读取
2. **直接截图**：`screenshot --full` 捕获全页

### 视频内容

**字幕下载（推荐，最完整）**：YouTube 用 `download_subtitles.sh`（人工 > 中文 > 英文 > 自动生成，三级降级）+ `srt_to_transcript.py` 清洗为文本。依赖 `yt-dlp`。

**帧采样**（无字幕时）：通过 eval 操控 `<video>` 元素 + screenshot 采帧。短视频（<5 分钟）5-8 帧，中等长度 10-15 帧，长视频 15-20 帧，均匀分布。

**平台内搜索**：在 B站、YouTube 站内直接搜索关键词。搜索结果页的标题、简介、评论也包含摘要信息。

### 音频和播客

优先提取已有字幕和 shownotes，流程同视频字幕。搜索 `"播客名" transcript`。以上均失败则告知用户无公开字幕——sleuth 不做本地语音转录。

### PDF 和文档

```bash
agent-browser --cdp <port> eval "Array.from(document.querySelectorAll('a[href$=\".pdf\"]')).map(a => a.href)"
```

获取 PDF 链接后下载到本地通过 Read 工具读取。arXiv 论文可直接拼接 URL（`arxiv.org/pdf/论文ID`）。

### 站内搜索

任何有搜索框的网站都可以用——电商、文档站、论坛、SaaS 后台、学术数据库：

```bash
agent-browser --cdp <port> open "https://目标网站.com" → snapshot -i → fill @e1 "搜索词" → press Enter → wait --load networkidle → snapshot -i
```

站内操作同理——任何点击、筛选、翻页、切换 tab、展开折叠的交互都通过 snapshot → @ref → click/fill/select 完成。

### 技术事实

- 页面中大量已加载但未展示的内容（轮播非当前帧、折叠区块文字、懒加载占位元素）存在于 DOM 中，以数据结构为单位思考可直接触达
- Shadow DOM 和 iframe 边界在 snapshot 中展开一级，eval 可递归穿透所有层级
- `scroll down` 到底部触发懒加载；提取图片 URL 前需确保已触发
- 公开媒体资源直接下载读取；需登录态的资源在浏览器内导航 + 截图
- 平台返回的「内容不存在」不一定反映真实状态，可能是访问方式问题而非内容本身不存在

## 障碍处理

### 登录判断

用户 Chrome 已登录大多数常用网站，直接访问即可。核心判断只有一个：**目标内容拿到了吗？**

许多网站的登录弹窗只是覆盖在内容之上的遮罩——优先用 eval 穿透：

```bash
agent-browser --cdp <port> eval "document.body.innerText.substring(0, 2000)"
```

eval 能拿到目标文本则内容已在 DOM，无需登录继续提取。确认 eval 和 snapshot 均无法获取且登录能解决时，告知用户：

> "当前页面在未登录状态下无法获取[具体内容]，请在你的 Chrome 中登录 [网站名]，完成后告诉我继续。"

对于**需要注册的新网站**：先尝试绕过（直接导航到目标内容页）；内容价值高且注册简单时告知用户自行注册；不让用户在对话中通过 Agent 处理密码。

**付费墙**：先提取墙前可见片段，检查缓存版本（Google 缓存、archive.org），告知用户内容在付费墙后及已获取片段。不尝试绕过付费墙。

### CAPTCHA

遇到验证码立即暂停自动化，告知用户需人工处理。告知用户后等待输入。若用户超过 5 分钟未响应，跳过该来源，从替代渠道继续，最终交付时标注该来源因 CAPTCHA 未能获取。备用方案：换渠道找相同内容；找替代来源；关键来源无法替代时请用户自行验证后继续。不尝试自动解题。

### 操作节奏

- 触发限流信号（HTTP 429、验证码页面、空响应、connection refused）→ 立即暂停该域名，换渠道或等 30 秒
- 重试后仍限流 → 放弃该域名

### 故障恢复

**临时故障（重试最多 2 次）**：
- agent-browser 返回非零退出码 → 运行 check-deps 确认 Chrome 连接
- CDP 连接断开 → 重新运行 check-deps 获取新端口
- 页面加载超时 → `wait --load networkidle --timeout 30000`，仍超时则跳过
- SPA 持续轮询导致 networkidle 超时 → 改用 `wait --load domcontentloaded` 或 `wait --text "预期关键词"`

**结构性故障（立即换方案，不重试）**：
- snapshot 返回空但页面标题正常 → eval 检查 `document.body.innerText.length`：有文本则提取，无文本则页面无内容
- eval 报语法错误 → 检查引号和特殊字符，改用 `--stdin` heredoc
- 同一操作连续失败 2 次 → 换定位方式或 GUI 交互

### 任务收尾

1. **结果交付**：按「结果交付」节规范输出，复杂问题必须通过 deliver.mjs 保存文件
2. **关闭 tab**：子 Agent 自行关闭；Stop hook 兜底关闭残留（见"Tab 管理"）
3. **结束会话日志**：`node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid $SID --outcome success|partial|fail`。Stop hook 会自动 finish 遗漏的 session（标记 partial），手动 finish 更及时
4. **更新站点经验**：发现新模式或陷阱时写入 `~/.sleuth/site-patterns/<域名>.md`，运行 `update-site-stats.mjs`。Stop hook 会为复杂站点自动创建 stub；定性经验仍需手动写入

agent-browser daemon 持续运行，不建议主动停止。

## 结果交付

**核心原则：简单问题直接内联回复，不写任何文件；复杂问题能内联的在聊天中总结，不能内联的持久化到 sleuth-output/。**

### 简单问题

→ 按「问题分类」中的简单问题流程处理，直接内联回复，附来源 URL。

### 复杂问题

**强制规则：复杂问题必须通过 `deliver.mjs --action save` 保存至少一个交付文件。** 纯内联回复不算完成——调研结果必须有文件落地，否则后续缓存复用无法生效。

| 内容类型 | 交付方式 | 说明 |
|---------|---------|------|
| 调研报告/总结 | **docs/（必须）** | 复杂问题的最终结论必须写文件；内联可作为预览 |
| 网页文本/摘要 | 内联 + 来源 URL | 始终内联，无需单独文件 |
| 链接列表 | 内联列表 | 始终内联 |
| 图片 | images/ | 独立图片资源必须写文件 |
| PDF 文档 | docs/ | 需阅读/存档时写文件 |
| 视频字幕 | transcripts/ | 始终写文件（内容长）；可内联前 500 字预览 |
| 截图证据 | screenshots/ | 任务关键证据；调试用 → /tmp |
| 结构化数据 | data/ | >10 行或需复用时写文件；≤10 行可内联 |
| 页面 PDF | pages/ | 用户需页面存档时 |

输出目录结构（自动创建，不可写时降级至 `~/.sleuth/output/<YYYY-MM-DD>/`）：

```
sleuth-output/
└── YYYY-MM-DD/                    # 按日期隔离（清理边界）
    └── <session-id>/              # 每条 session 独立目录
        ├── screenshots/            # 截图
        ├── images/                 # 下载的图片
        ├── docs/                   # PDF、文档
        ├── transcripts/            # 字幕/转录
        ├── data/                   # 结构化数据（JSON、CSV）
        ├── pages/                  # 页面 PDF
        ├── traces/                 # HAR 网络追踪
        └── recordings/             # 录屏
```

文件交付通过 `deliver.mjs` 记录，自动处理目录定位、文件名冲突（加时间戳精确到毫秒）、会话日志记录：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/deliver.mjs" --action save \
  --type <screenshot|image|doc|transcript|data|page|trace|recording> \
  --source <源文件路径> --name <有意义的文件名> --sid $SID
```

## 站点经验与统计

系统通过会话日志记录和自动统计实现跨任务的经验积累。

### 站点经验文件

特定网站经验按域名存储在 `~/.sleuth/site-patterns/` 下。确定目标域名后，通过 `match-site.mjs` 查找匹配的站点经验文件——这是查询站点模式的主要方式。读取匹配文件获取先验知识（平台特征、有效模式、已知陷阱）。经验标注发现日期，当作可能有效的提示而非保证——按经验失败时回退通用模式。

操作成功后，发现有必要记录的新站点或新模式（URL 结构、平台特征、操作策略、选择器），主动写入站点经验文件。只写验证过的事实，不写未确认的猜测。

```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-04-27
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式等事实

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么
```

写入后运行 `update-site-stats.mjs --domain <域名>` 刷新自动统计。

### 自动统计

`update-site-stats.mjs` 读取 `~/.sleuth/sessions/` 下所有会话日志，按域名聚合计算：访问次数、成功率、死链数、CAPTCHA 次数、平均停留时间、Bayesian 可信度评分。统计结果写入站点经验文件的 `## 自动统计` 节。

```bash
node "${CLAUDE_SKILL_DIR}/scripts/update-site-stats.mjs"
```

Agent 在新任务开始时应：
1. 读取相关站点经验文件（含自动统计），了解域名可靠性
2. 多渠道可选时优先选择历史成功率更高的渠道
3. 某域名历史死链率高或频繁触发 CAPTCHA 时，预期可能再次遇到并准备替代方案

## References 索引

| 文件 | 何时加载 |
|------|---------|
| `references/tool-guide.md` | agent-browser 完整命令速查（优先查此文件） |
| `~/.sleuth/site-patterns/{domain}.md` | 确定目标网站后通过 match-site.mjs 匹配并读取 |
| `sleuth-output/` | 用户可打开交付文件 |
