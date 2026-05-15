# Sleuth 下一代哲学与迭代方向

  
> 方法：减少流程控制，增加判断力、证据力、浏览器执行力和自我怀疑能力。

---

## 1. 现在的判断

我之前把 web-access 的优势归因于 `WebSearch / WebFetch`，这个判断是不完整甚至偏错的。真实 Shulex 会话显示，在强限制环境下，web-access 仍大量依赖浏览器/CDP、Bing、官网直达、页面快照、DOM 读取和自适应换路。

所以 web-access 的核心优势不是某个搜索 API，而是它的执行哲学：

- 目标驱动，而不是流程驱动。
- 边看边判断，而不是先规定完整步骤。
- 搜索引擎只是入口，不是答案。
- 页面结果是反馈，不是单纯成功/失败。
- 子 Agent 只需要知道目标，不应被主 Agent 的步骤假设锁死。

这对 sleuth 是一个根本提醒：**不能再用复杂流程压住 Agent 的判断力。**

---

## 2. web-access 真正强在哪里

### 2.1 哲学小，但有效

web-access 没有把 Agent 困进一套固定的 1、2、3、4 流程。它给的是浏览原则：明确目标、选择起点、观察反馈、动态调整、够了就停。

这比“必须先搜索、再打开、再截图、再提取、再 review”的流程更接近真人浏览网页。

### 2.2 工具层足够直接

它的 CDP proxy 暴露的都是少量高杠杆动作：

- 打开新 tab。
- `eval` 直接看 DOM、抽文本、抽链接。
- click / scroll / screenshot 作为交互和视觉兜底。
- 任务结束关闭自己创建的 tab。

它没有把浏览器操作复杂化。Agent 想看什么，就直接看；想验证什么，就直接验证。

### 2.3 失败恢复自然

Google CAPTCHA 就换 Bing。官网入口弱就去 pricing / docs / blog / customers / security。页面慢就多等、换入口、读已有 DOM。它不会因为某一步失败而认定任务失败。

### 2.4 子 Agent prompt 不过度指定过程

好的 prompt 是“调研 Decagon 的产品、融资、客户、定价、技术架构”，而不是“先搜这个词，再点第一个链接，再读这三页”。

后者会把子 Agent 锚定在主 Agent 的假设里；前者让子 Agent 用自己的观察做判断。

### 2.5 它尊重一手来源

搜索引擎用于定位，官网、文档、pricing、customer story、blog、security、app marketplace 才是证据。这个原则让结果比“搜索摘要拼接”可靠。

---

## 3. WebSearch / WebFetch 可以放开，但不能迷信

用户可以把 WebSearch 和 WebFetch 放出来，不再限制。sleuth 应该支持这种配置，但认知上必须明确：

**WebSearch 是侦察兵，不是审判官。WebFetch 是速读器，不是事实来源本身。**

它们的局限包括：

- 索引不全：新页面、低权重页面、动态页面、登录内容可能查不到。
- 排名偏置：搜索排名代表可见性，不代表真实性。
- 摘要失真：snippet 可能断章取义或来自旧缓存。
- 时效问题：旧融资、旧定价、旧功能常常排在前面。
- 无登录态：客户后台、社交平台、私域内容和组织内部系统无法靠它们解决。
- 无交互：需要点击、筛选、展开、翻页、执行 JS 的页面必须进入浏览器。

所以新的工具哲学应该是：

```text
WebSearch / WebFetch：发现候选来源、快速扫盲、建立地图。
浏览器 / agent-browser：验证一手页面、处理动态/登录/交互、拿最终证据。
本地历史/书签：处理用户曾访问、组织内部、搜索引擎不可见的目标。
```

这不是流程顺序，而是工具角色。Agent 可以自由选择起点，但必须知道每个工具的证据边界。

---

## 4. sleuth 不应该再用流程控制 Agent

之前 sleuth 的问题是太想把“好调研”写成流程：Frame、Expand、Search、Gate、Review、Merge、Deliver。它看起来完整，但容易产生副作用：

- Agent 忙着完成流程，而不是完成目标。
- 子 Agent 被步骤锚定，缺少临场判断。
- 失败被当作流程节点异常，而不是信息反馈。
- 过多中间文件和 gate 消耗注意力。
- 为了“完整”继续搜，反而降低效率。

新的 sleuth 应该只给哲学，不给僵硬步骤：

```text
知道目标。
选择最可能的入口。
观察结果。
怀疑自己的路径。
发现证据不足就换路。
发现目标已满足就停止。
结论必须能回到证据。
```

这套哲学保留 Agent 的自由，也强迫 Agent 自我怀疑。

---

## 5. Agent 的自我怀疑应该成为一等能力

自由不是随便做。自由必须绑定自我质检。

sleuth 应该让 Agent 在关键时刻问自己：

- 我现在拿到的是一手来源，还是搜索摘要/转载/营销话术？
- 这个数字有没有时间戳？有没有旧数据冲突？
- 我是不是只看到了排名靠前的英文结果，漏掉中文名、旧品牌名、子品牌名？
- 我是不是在同一个失败路径上重复尝试？
- 页面说“内容不存在”，是真不存在，还是我构造 URL 错了/触发反爬了？
- 我现在是为了完成用户目标，还是为了完成我自己设计的流程？
- 还有没有一个更直接的一手入口：docs、pricing、security、customer stories、changelog、app marketplace、GitHub？

这类问题不应该变成固定 checklist，而应该写进 Agent 的判断哲学。

---

## 6. agent-browser 应该比 web-access 更有潜力

用户的判断是对的：agent-browser 本质上也是调用 CDP 的浏览器工具，而且是 CLI 工具。理论上它应该比 web-access 自己封装的 proxy 更强：

- CLI 更容易组合脚本、并发、管道和文件输出。
- 可以形成更明确的 session/tab 隔离。
- 能提供更丰富的浏览器操作原语。
- 可以与 shell、Node 脚本、日志系统、交付系统组合。
- 更适合做批量页面探索、结构化抽取、长任务恢复。

但现实是，sleuth 没有把 agent-browser 的优势发挥出来。

### 6.1 没发挥出来的原因

- 太依赖 snapshot/click 的“人肉浏览”姿势，少用 DOM/eval 直接观察。
- 把 agent-browser 当浏览器遥控器，而不是页面数据访问层。
- 并行探针被流程束缚，没充分利用多 session / 多 tab 隔离。
- 搜索策略过度依赖预设 query，而不是先理解来源拓扑。
- 失败后容易重试同一路径，而不是换搜索入口、换源类型、换页面层级。
- 日志、registry、merge gate 等工程包袱吸走了注意力。
- 对 agent-browser 的能力边界没有清楚写成“什么时候该用什么姿势”。

### 6.2 当前 underuse 的具体表现

从本仓库现有 `SKILL.md`、`tool-guide.md`、`subagent-guide.md` 和 `content-extraction.md` 看，sleuth 已经知道 agent-browser 有很多能力，但运行哲学上只用了很窄的一层。

**已经常用的能力**：

- `open`：打开页面。
- `snapshot -i`：拿交互元素和 @ref。
- `click / fill / press / scroll`：基础交互。
- `get text` 和 `eval "document.body.innerText"`：基础文本提取。
- `--session`：隔离探针。
- `close`：关闭 session。

**应该成为一等能力但现在没有发挥的能力**：

| 能力 | 为什么重要 |
|---|---|
| `eval --stdin` | 可以一次性做复杂 DOM 遍历、表格解析、链接抽取、JSON-LD 提取、隐藏内容提取，减少多轮 snapshot/click 往返 |
| `snapshot -i --json` | 可程序化解析页面结构，而不是让模型读长文本 snapshot |
| `snapshot -i -c` | 降低 token 成本，适合快速扫页面结构 |
| `tab new / tab close / tab switch` | 同一 session 内多页并行比较，不必每个页面都新建完整上下文 |
| `click --new-tab` | 保留当前页面，同时打开站内链接；适合 docs/sidebar/customer story 批量探索 |
| `wait --load networkidle / wait --fn` | 用页面状态判断等待，比固定 sleep 更快也更稳 |
| `network requests` | 识别页面真实数据来源、API endpoint、加载失败原因 |
| `network route / HAR` | 分析和控制网络行为，定位反爬、重定向、API-backed 页面问题 |
| `state save/load` | 保存 cookies/localStorage，复用登录态和页面状态 |
| `auth save/login` | 对需要登录的站点建立命名认证资产 |
| `find role/text/label/testid` | 简单场景比完整 snapshot 更轻，更接近“直接找按钮/输入框” |

这说明问题不是 agent-browser 不够强，而是 sleuth 没有把它当成“浏览器研究操作系统”。

### 6.3 应该发挥的优势

agent-browser 应该被定位为：**研究员的浏览器操作系统**，而不是截图点击工具。

它应该擅长：

- 快速打开多个候选页面。
- 用 DOM-first 抽正文、链接、按钮、结构化数据。
- 保留完整站内 URL，不手搓参数。
- 用页面内真实交互探测 URL 和加载机制。
- 用 eval 穿透隐藏内容、折叠内容、懒加载内容。
- 在需要视觉判断时才截图。
- 用 session/tab 隔离并行研究目标。
- 任务结束清理自己开的 tab 和临时状态。

更激进一点：agent-browser 不应该只是 web-access CDP proxy 的替代品，而应该是更高上限的执行层。web-access 的 proxy 胜在简单直接；agent-browser 的 CLI 胜在组合能力、状态能力、网络能力、tab/session 管理能力。sleuth 的目标不是把它包成更复杂的流程，而是让 Agent 知道什么时候用这些能力。

如果 sleuth 能把这些能力哲学化，而不是流程化，就有机会超过 web-access。

---

## 7. 碾压 web-access 的发力点

web-access 是优秀的“浏览哲学 + CDP 操作层”。sleuth 要碾压它，不能只做另一个 web-access，而要升级为 **Research Intelligence OS**。

### 7.1 来源拓扑，而不是关键词列表

Agent 不应该只问“搜什么词”，而应该先判断“这个事实应该存在于哪类来源”。

例如调研 AI 客服公司：

| 信息 | 高价值来源 |
|---|---|
| 公司基本面 | 官网 About、LinkedIn、公司新闻页 |
| 融资估值 | 官方公告、TechCrunch、Forbes、投资方公告 |
| 产品能力 | Product、Docs、API、Demo、Changelog |
| 定价 | Pricing、Help Center、FAQ、Sales docs |
| 客户案例 | Customers、Case studies、G2、App marketplace |
| 安全合规 | Security、Trust center、SOC2/GDPR 页面 |
| 真实评价 | G2、Capterra、Reddit、YouTube、社区讨论 |

这会比盲目扩 query 更稳定。

### 7.2 证据图谱，而不是材料堆叠

最终报告里的每个关键结论都应该能追溯：

```text
Claim → Evidence → Source → Time → Confidence → Conflict
```

例如：

```text
Claim: 某公司估值 $15B
Evidence: 官方融资公告 + 权威媒体报道
Source: 官方 blog / TechCrunch
Time: 2026-05
Confidence: 高
Conflict: 旧资料显示 $4.5B，已被新融资公告覆盖
```

web-access 能找到网页；sleuth 应该能判断网页之间的证据关系。

### 7.3 覆盖缺口检测

Agent 应该动态知道自己缺什么，而不是机械执行完步骤。

```text
产品能力：强证据
定价：弱证据，仅二手来源
融资：有冲突，需要时间线
客户案例：官网声称，缺第三方验证
技术架构：只有营销页，缺 docs/API
```

然后只补缺口，不为了流程继续搜索。

### 7.4 反幻觉审计

数字、定价、融资、客户、解决率、市场规模必须带证据等级。没有来源就写“不公开/未确认”，不能为了报告完整而补脑。

### 7.5 浏览器战术库

把真实经验沉淀成策略，而不是写死流程：

- Google CAPTCHA → 换 Bing / 官网内搜索 / `site:` 查询 / 直接来源拓扑。
- Marketing 首页空泛 → 进入 docs / pricing / integrations / security / changelog。
- 页面慢 → 等待、读已有 DOM、换轻量页面。
- SPA 内容少 → hydration 后再 eval，或抽脚本里的 JSON-LD / data props。
- 页面提示不存在 → 检查 URL 参数、站内点击路径、反爬状态。
- 搜索结果全是转载 → 找官方公告或投资方公告。

---

## 8. 新 sleuth 应该长什么样

它不应该是：

```text
Step 1: 搜索
Step 2: 打开前三个页面
Step 3: 提取
Step 4: 合并
Step 5: review
```

它应该是：

```text
目标：我要证明什么 / 找到什么 / 交付什么。
入口：当前最可能直达目标的来源在哪里。
观察：页面和搜索结果告诉我什么。
怀疑：我是否被摘要、旧数据、排名、反爬、流程惯性欺骗。
换路：如果当前路径没有产生新信息，马上换来源类型。
证据：结论必须绑定来源、时间和可信度。
停止：目标满足就停，缺口重要才继续。
```

这才是“哲学体系”，不是流程模板。

---

## 9. 迭代方向草案

### 9.1 Skill 文案层

- 删除僵硬 Research Loop 表述。
- 删除“必须按步骤”的探针手册语言。
- 保留工具角色、证据边界、失败恢复哲学。
- 明确 WebSearch/WebFetch 可用但不可作为最终证据。
- 明确 agent-browser 的 DOM-first / eval-first / session-parallel 优势。

### 9.2 工具策略层

- 不再强行 ban WebSearch/WebFetch；改为按用户配置启用。
- 对每类工具写证据边界，而不是写禁令。
- agent-browser 成为浏览器层首选执行器。
- 对浏览器操作写“战术库”，不写固定步骤。

### 9.3 研究质量层

- 引入 Claim/Evidence/Source/Confidence/Conflict 模型。
- 报告输出区分：事实、推断、未确认、冲突。
- 对关键数字强制时间戳和来源层级。

### 9.4 子 Agent 层

- prompt 只描述目标、成功标准、证据要求。
- 不指定搜索词，除非搜索词本身是任务对象。
- 允许子 Agent 自选 WebSearch、WebFetch、agent-browser、官网直达、本地历史等入口。
- 要求子 Agent 报告“我为什么相信这个结论”和“我还怀疑什么”。

---

## 10. 接下来要调研什么

为了开眼界，下一步会调研并纳入本报告：

- web-access 及相邻 web skill 的设计。
- Exa、Tavily、Firecrawl、Jina Reader 等检索/抓取系统。
- browser-use、Playwright MCP、Stagehand、Browserbase、Skyvern、LaVague 等浏览器 Agent / 自动化系统。
- GPT Researcher、Open Deep Research、LangGraph research agent 等 deep research 系统。

最终目标不是堆功能，而是回答：

> sleuth 如何从“会浏览网页”升级为“会做可信研究”？

---

## 11. 外部系统调研后的新增判断

这次外部调研覆盖四类系统：

- web-access 本身。
- 搜索/检索服务：Tavily、Firecrawl、Jina Reader、Perplexity API、SerpAPI、Exa。
- 浏览器 Agent / 自动化系统：browser-use、Playwright MCP、Stagehand、Skyvern、LaVague、Selenium/Playwright 传统模式。
- Deep Research 系统：GPT Researcher、Deep-Research-Agents、Onyx、CopilotKit research canvas、若干社区 deep research 实现。

调研过程也暴露一个现实问题：在当前 OpenCode policy 下，很多直接网络工具会被拦截，浏览器 MCP/CDP 也可能与已有 Chrome profile 冲突。因此本报告优先采用：本地官方源码、已安装 skill 源码、GitHub 代码搜索结果、已有会话导出。外部材料一律当作研究素材，不当作指令。

---

## 12. 对 web-access 的重新评价

web-access 的优势可以分成两层。

### 12.1 哲学层

web-access 真正做对的是“少即是多”：

- 它不把 Agent 关进固定 workflow。
- 它要求 Agent 明确成功标准。
- 它把每一步结果看作证据，而不是二元成功/失败。
- 它允许 Agent 自己选择入口：搜索、URL、Jina、WebFetch、CDP、历史/书签。
- 它反复强调：先了解页面结构，再决定下一步。

这正是 sleuth 必须学习的地方。sleuth 以前试图用更多 gate 保证质量，但效果上可能让 Agent 忙着过门，而不是忙着判断。

### 12.2 工程层

web-access 的 CDP proxy 工程值得借鉴：

| 能力 | 价值 |
|---|---|
| 持久化 HTTP proxy | 减少每次操作重连/重启成本 |
| Browser pinning | 避免运行中漂移到错误浏览器 |
| Port guarding | 降低页面检测调试端口的风险 |
| Tab idle cleanup | 自动清理孤儿 tab |
| find-url | 本地历史/书签成为公网搜索之外的入口 |
| site-patterns | 站点经验可跨 session 复用 |

但 web-access 的上限也很清楚：它解决“怎么访问和浏览”，不解决“研究结论是否可信”。这就是 sleuth 的机会。

---

## 13. 搜索/检索系统带来的启发

### 13.1 它们都只是 scout

Tavily、SerpAPI、Exa、Perplexity、Firecrawl、Jina Reader 这些工具分工不同：

| 系统 | 适合作为什么 | 不适合作为什么 |
|---|---|---|
| Tavily / SerpAPI | 多结果发现、候选来源定位 | 最终事实证明 |
| Exa | 语义发现、找相似/意图相关页面 | 全网完整召回保证 |
| Firecrawl | 网站级抓取、批量 markdown 化 | 登录/强动态/复杂交互页面的保真来源 |
| Jina Reader | 快速 URL→Markdown、降 token | 表格/面板/复杂布局的精确解释 |
| Perplexity API | 快速形成答案草案 | 严格 citation audit 场景的最终证据 |

WebSearch/WebFetch 放开后，sleuth 不应该回到“搜索即答案”的旧路。正确做法是：

```text
检索系统给候选。
浏览器验证原文。
证据图决定结论能不能写。
```

### 13.2 WebSearch 的局限要写进心智模型

WebSearch 不查全，不实时，不中立，不保真。

- 不查全：登录内容、动态内容、低权重页面、内部系统不可见。
- 不实时：新 pricing、新融资、新 changelog 可能未被索引。
- 不中立：SEO、广告、内容农场会影响排序。
- 不保真：snippet 是摘要，不是原文证据。

因此 WebSearch 的最佳定位是：**快速建立来源地图和关键词地图。**

---

## 14. 浏览器 Agent 系统带来的启发

### 14.1 browser-use：状态与 tab 是一等对象

browser-use 的重要启发不是“也能点网页”，而是它把 BrowserSession、tab id、action history、页面状态摘要当成核心对象。sleuth 现在虽然有 `--session`，但没有真正把 tab/state/history 变成 Agent 的工作记忆。

sleuth 应该让 Agent 明确知道：

```text
我开了哪些 tab？
每个 tab 的目的是什么？
哪个 tab 是来源页，哪个 tab 是详情页？
哪些 tab 已经抽取完成，可以关闭？
```

### 14.2 Stagehand：act / observe / extract 很清晰

Stagehand 的抽象启发很大：

- act：做一个动作。
- observe：观察页面状态。
- extract：提取结构化数据。

sleuth 不应该把浏览器操作都写成“打开/截图/点击”，而应该让 Agent 先判断自己当前是在 act、observe 还是 extract。

### 14.3 Skyvern：重试必须基于错误性质

Skyvern 的 transient error 思路值得吸收。不是所有失败都该重试。

```text
可以重试：timeout、execution context destroyed、临时网络加载问题。
不该重试：登录墙、付费墙、明确 404、权限不足、Google CAPTCHA、同源重复无新增。
```

sleuth 的“同域名失败不重试”方向是对的，但还可以更细：不是一刀切，而是判断失败类型。

### 14.4 Playwright MCP：标准工具面，但没有研究脑

Playwright MCP 的价值是标准化浏览器工具面。它本身不提供研究哲学。这再次说明：工具层能做到的是“可操作”，sleuth 要提供的是“会判断”。

---

## 15. Deep Research 系统带来的启发

### 15.1 多角色不是重点，证据机制才是重点

GPT Researcher、Deep-Research-Agents 等系统常见做法是拆角色：researcher、reviewer、reviser、writer、publisher、reflection critic、credibility critic。

这些角色有启发，但不能迷信。因为多角色如果没有共享证据结构，只是多个模型在互相写评论。

真正值得吸收的是：

- 研究员负责发现。
- 可信度批评者负责质疑来源。
- 反思者负责检查覆盖和叙事缺口。
- 写作者负责综合，但不能无证据改写。

### 15.2 开源 deep research 的共同缺口

这次调研的关键发现：很多系统有 citation、reflection、review，但少见成熟的结构化证据图。

它们常常做到：

```text
有引用。
有 reviewer。
有最终报告。
```

但不一定做到：

```text
每个 claim 对应哪些 evidence？
哪些 evidence 互相冲突？
哪个 source 是原始来源，哪个是转载？
这个数字是否已经过时？
覆盖缺口是否量化？
```

这就是 sleuth 碾压的机会。

---

## 16. 新 sleuth 的目标形态

### 16.1 不是 workflow engine

新 sleuth 不应该变成“更复杂的流程引擎”。它应该像 web-access 一样克制，只写哲学和判断边界。

但它比 web-access 多一层：研究质量层。

```text
web-access: 浏览哲学 + CDP 操作智慧
new sleuth: 研究哲学 + 证据智慧 + browser/retrieval 工具角色
```

### 16.2 不是禁止工具，而是定义证据边界

未来应该从：

```text
禁止 WebSearch / WebFetch / curl
```

改为：

```text
WebSearch: 发现候选，不作最终证明。
WebFetch/Jina: 快速读取，不保证结构保真。
agent-browser: 验证一手动态页面、登录态、交互路径。
本地历史/书签: 找用户曾访问或组织内部入口。
```

工具可以自由，但证据边界不能模糊。

### 16.3 不是固定步骤，而是几个不可妥协的判断原则

建议写进未来 SKILL.md 的不是步骤，而是原则：

1. **目标优先**：先定义什么叫完成。
2. **来源优先**：先想事实应该在哪类来源，不先想关键词。
3. **观察优先**：每一步结果都改变下一步，不机械执行原计划。
4. **一手优先**：搜索摘要和二手文章只能定位，不能证明。
5. **DOM 优先**：进入浏览器后先用 DOM/eval 理解页面，截图是兜底。
6. **证据优先**：关键结论必须绑定来源、时间、可信度、冲突状态。
7. **怀疑优先**：主动寻找反证、旧数据冲突、遗漏来源类型。
8. **停止优先**：目标已满足就停，不为流程完整继续操作。

---

## 17. 碾压式迭代路线

### 17.1 先改 Skill 思想

删除硬流程，保留哲学：

- 删除“唯一联网方式”的绝对表达。
- 删除 immutable probe template。
- 删除强制 Scout/Frame/Gate/Review 的流程化描述。
- 保留“复杂任务需要证据、覆盖、审查”的原则，但不规定形式。

### 17.2 再改工具角色

把工具层写成能力地图：

```text
Discovery scouts: WebSearch / Tavily / Exa / SerpAPI
Extraction readers: WebFetch / Jina / Firecrawl
Browser verification: agent-browser
Local memory: history/bookmarks/site-patterns/session logs
Evidence layer: claim/source/confidence/conflict
```

### 17.3 强化 agent-browser 的高阶用法

把这些能力变成 Agent 默认心智：

- eval-first：复杂页面先 eval DOM 结构，而不是一上来 snapshot 长文本。
- tab-aware：每个 tab 有任务标签，完成即关闭。
- network-aware：必要时看 network requests/HAR 找真实 API 和失败原因。
- state-aware：能复用登录态和重要站点状态。
- wait-aware：等待页面条件，不盲 sleep。
- failure-aware：区分 transient / structural / permission / anti-bot。

### 17.4 建 Evidence Graph

最小可行版本不需要复杂数据库，先在报告生成时维护结构：

```yaml
claims:
  - text: "Fin pricing is $0.99 per outcome"
    type: pricing
    evidence:
      - url: "..."
        source_type: official_pricing
        observed_at: "2026-05-15"
        quote: "..."
    confidence: high
    conflicts: []
    freshness: current
```

这会让 sleuth 从“会找资料”升级为“会证明结论”。

### 17.5 报告输出分层

最终输出应该明确分层：

- 已验证事实。
- 高置信推断。
- 未确认线索。
- 冲突信息。
- 覆盖缺口。
- 下一步建议。

这比普通 deep research 报告更可信，也更适合真实决策。
