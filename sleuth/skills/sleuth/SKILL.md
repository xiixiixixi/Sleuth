---
name: sleuth
description: >-
  全能联网搜索、网页浏览、深度研究与来源验证 skill。Use for any request involving search, web search, online research, latest information, open/browse/check a website, verify a source, compare products, company research, pricing, docs, changelogs, social platforms, reviews, dynamic pages, logged-in pages, browser automation, screenshots, or multi-source fact checking. Triggers: 搜索, 搜一下, 查一下, 联网查, 网上查, 调研, 研究一下, 查资料, 最新, 官网, 网页, 网站, 浏览器, 登录态, 验证来源, search, google, look up, research, investigate, latest, browse, open website, official site, pricing, docs, source verification, deep research.
---

# sleuth — 梦里寻

sleuth 是搜索、浏览和研究判断层，不垄断网络入口，也不拦截工具。你可以使用 WebSearch、WebFetch、agent-browser、本地历史、书签和站点经验，但必须知道每类工具能证明什么、不能证明什么。

如果这个 skill 是由路由 hook 注入触发的，先执行本文件的判断步骤，再决定工具；不要因为已经有 WebSearch、Fetch、浏览器或 MCP 工具可用就跳过 sleuth。

```bash
# 插件根目录 — 所有脚本和参考文档的基础路径
SKILL_DIR="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)"
```

## 先想清楚目标，不先背流程

收到联网任务后，先用一句话写清：

- 用户真正要解决什么问题。
- 什么证据足够让你停止。
- 哪些结论必须回到原始来源。
- 哪些内容只是候选线索，不该直接写成事实。

主 Agent 和子 Agent 共用同一套搜索判断：`references/search-guide.md`。

## 工具角色与证据边界

| 工具 / 入口 | 适合做什么 | 证据边界 |
|-------------|------------|----------|
| **WebSearch / Search APIs** | 发现候选页面、别名、关键词地图、来源拓扑 | 不完整，受排序和 snippet 偏置影响，不能直接充当最终证明 |
| **WebFetch / Jina / Firecrawl / curl-like readers** | 快速读取正文、扫静态页面、降 token | 不保证布局、交互、登录态、动态内容和页面真实状态 |
| **agent-browser** | 验证一手页面、处理动态渲染、登录、交互、DOM/eval、tab/network/state | 适合高价值验证，不适合把所有网页都重成本浏览一遍 |
| **本地历史 / 书签 / site-patterns** | 找用户曾访问、组织内部、搜索引擎不易发现的入口 | 是入口记忆，不自动等于事实证据 |

判断原则很简单：

- 需要找入口、找别名、找来源地图时，先侦察。
- 需要快速扫正文时，用 reader。
- 需要确认真实页面状态、动态内容、登录态、交互路径时，回到浏览器。
- 关键结论一律回到原始来源，不让摘要替你下结论。

## 按需起手，不做无意义前置

不是每次都把所有脚本跑一遍。只在它们能减少重复劳动时才用。

```bash
# 历史召回：先看以前有没有做过类似研究
node "${SKILL_DIR}/scripts/research-index.mjs" --action recall --query "关键词" --limit 5

# 命名实体无召回命中时，可回填最近资料
node "${SKILL_DIR}/scripts/research-index.mjs" --action backfill --days 7

# 用户提到“之前看过 / 书签里 / 内部系统”时
node "${SKILL_DIR}/scripts/find-url.mjs" "关键词" --since 7d

# 需要浏览器时再做环境检查
node "${SKILL_DIR}/scripts/check-deps.mjs"

# 目标域名已明确时，读取站点经验
node "${SKILL_DIR}/scripts/match-site.mjs" "<域名>"
```

### recall 命中后怎么借用

`recall` 只返回历史 artifact 路径和相关 session 线索，不会自动把旧文档复制到新 session，也不会自动把旧内容注入上下文。

命中后按效果处理：

1. 先读 `direct_hits` / `useful_artifacts` 中最相关的 1-3 个文件。
2. 把旧内容标为“历史线索”或“先前结论”，不要直接当作当前事实。
3. 对会过期或会影响决策的事实重新验证原始来源。
4. 如果旧 artifact 对本轮研究仍有价值，用 `deliver save` 保存本轮的摘录/链接/新判断，而不是复制整份旧 session。

借用的本质是“参考旧证据并重新判断”，不是“把旧 session 搬进新 session”。

## 响应层级

从最轻的路径开始，不够再升级。

| 层级 | 适用场景 | 常见做法 |
|------|----------|----------|
| **直答** | 已有知识足够，且无明显时效风险 | 直接回复 |
| **快速验证** | 一个或两个高质量来源就能确认 | 侦察 + 原始来源验证 |
| **定向研究** | 需要多步查证，但问题仍集中 | 混合搜索、速读、浏览器验证 |
| **深度研究** | 多源交叉、范围较大、存在冲突、用户需要完整交付物 | 建来源地图、必要时并行子 Agent、最后写一份连贯报告 |

不确定时先走低一级。只有当证据不够、来源冲突或用户明确要求完整交付时，再升级到更重的模式。

## 快速验证 / 定向研究

- 搜索逻辑统一看 `references/search-guide.md`。
- 侦察结果只能帮你决定去哪，不直接变成结论。
- 至少给用户一个可追溯来源 URL；关键事实尽量给原始来源。
- 如果页面明显需要动态交互、展开、筛选或登录，不要假装 reader 结果已经足够，直接切到浏览器。

## 深度研究

深度研究的目标不是完成一套仪式，而是产出一份可信、连贯、能回到证据的结果。

开始时建立 session：

```bash
SID=$(node "${SKILL_DIR}/scripts/session-logger.mjs" --action start --query "问题" --type research)
SLEUTH_OUTPUT=$(node "${SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid "$SID")
```

常见做法：

- 写清目标、enough 条件、关键子问题。
- 用 `search-guide.md` 建立来源拓扑和候选入口。
- 按证据边界混合使用侦察、reader、浏览器和本地入口。
- 重要发现、难复现发现、跨轮次会丢的发现及时 `deliver save`。
- 只有当角度真正独立时，才并行派子 Agent。
- 证据已经稳定时，直接写报告；如果关键结论仍脆弱、冲突或覆盖不足，再做独立审查或补查。

### 什么时候需要子 Agent

适合并行的情况：

- 不同来源类型彼此独立，例如 pricing、客户案例、负面反馈。
- 同一主题下存在彼此不干扰的站点或入口。
- 任务足够大，主 Agent 一个人做会让上下文混乱。

不适合并行的情况：

- 只是重复搜索同一角度。
- 主 Agent 自己还没弄清目标、实体或来源拓扑。
- 新探针只会复读已知结论。

### 给子 Agent 的合同

让子 Agent 先读：`references/subagent-guide.md`。

然后给它一个可调整的合同，而不是不可改模板。合同至少包含：

- `goal`：这一路到底要证明或找到什么。
- `enough_when`：什么情况下可以停止。
- `must_verify`：哪些事实必须给原始来源。
- `known_clues`：已知别名、域名、已有来源、疑点。
- `browser_session`：例如 `${SID}-pricing`。
- `output_shape`：`findings / sources / gaps / red_flags / trust_notes`。

示例骨架（按任务改写）：

```text
你是独立研究子 Agent。

开始前先读：${SKILL_DIR}/references/subagent-guide.md

goal: 验证该产品当前公开定价与计费单位。
enough_when: 找到官方 pricing / help / docs 中能直接支持价格结论的页面，或明确写出公开价格不存在。
must_verify:
- 价格数字
- 计费单位
- 是否需要 sales contact
known_clues:
- 域名: example.com
- 可能入口: pricing / docs / help center
- 已知疑点: 搜索结果里有旧价格
browser_session: ${SID}-pricing

返回：findings、sources、gaps、red_flags、trust_notes。
```

### 独立审查何时有价值

不是每个任务都必须派审查子 Agent。以下情况更值得做独立审查：

- 结论会影响决策，且来源多、冲突多。
- 报告范围大，主 Agent 已经有明显沉没成本。
- 关键数字、定价、融资、客户、版本等事实容易过时或被营销话术污染。

如果只是一次轻量验证，主 Agent 自己做自检即可；不要为形式强行加审查。

## 浏览器执行姿势

浏览器相关细节看 `references/tool-guide.md`。核心姿势如下：

- 所有 agent-browser 命令带 `--auto-connect --session <name>`。
- 主 Agent 通常用 `${SID}-main`，子 Agent 用各自独立 session；独立任务不要挤在同一个浏览器 session 里排队。
- **观察 / 提取优先用 DOM 和 eval**。
- **交互优先用 snapshot / @ref**。
- **截图只在视觉证据重要时使用**。
- **tab / network / state / auth 在需要时就是一等工具**，不是附属功能。

并行浏览原则：

- 不同域名、不同子问题、不同登录态风险的网页验证，可以并行开独立 session，例如 `${SID}-pricing`、`${SID}-reviews`、`${SID}-docs`。
- 同一账号、同一敏感后台、同一会产生状态变更的流程，不并行操作；只做只读验证。
- 并行不是同时乱点。每一路都要有自己的目标、停止条件和输出形状。

登录态原则：

- Sleuth 只能复用已存在的 Chrome profile / CDP 状态，不能保证自动登录成功。
- 首次进入需要登录态的任务时，先确认页面确实处于登录状态。
- 如果不是登录态，停止依赖登录态的抓取；可以继续做公开页面研究，但必须把“登录态未验证”写入缺口。
- 中途浏览器被杀后，重新打开也要重新验证登录态；不要假设 session 名相同就仍然已登录。

## 内容提取

- 文本优先：先拿可见文本和 DOM 内容。
- 表格、JSON-LD、隐藏结构、链接列表，优先 `eval --stdin` 做结构化抽取。
- 视频、音频、PDF、图片等特殊场景看 `references/content-extraction.md`。

## 交付

### 默认交付合同

- **快速验证 / 定向研究**：内联回复 + 可追溯来源 URL。
- **深度研究**：默认交付一份写到用户当前工作目录（cwd）的完整报告，同时内联给简要结论。
- **用户指定格式 / 路径 / 文件名**：完全按用户要求输出。

深度研究默认只给用户一份最终文件，不要生成多个“final / merged / summary”版本让用户分不清。
最终报告文件默认放在用户启动任务的项目目录，不放进插件目录或 `~/.sleuth/output/`。`~/.sleuth/output/` 只存中间 artifact、截图、页面、数据和 session 可召回材料。

常见收尾动作：

```bash
# 只有在你已经存了多个中间交付物、且 merge 对整理有帮助时才用
node "${SKILL_DIR}/scripts/deliver.mjs" --action merge --sid "$SID"
```

`deliver merge` 不是最终报告生成器。它只把本 session 的多个中间 Markdown artifact 拼接成整理材料，方便你读完后由模型重新写一份连贯最终报告。若中间文档有多版草稿、重复结论或不同口径，直接 merge 会制造混乱，此时不要 merge。

最终报告建议明确区分：

- 已验证事实
- 高置信推断
- 未确认线索
- 冲突信息
- 覆盖缺口

### deliver save（发现沉淀）

```bash
node "${SKILL_DIR}/scripts/deliver.mjs" --action save \
  --type <doc|screenshot|image|transcript|data|page> \
  --source <源> --name <名> --url <URL> --sid "$SID"
```

重要、昂贵、难复现的发现及时保存；搜索结果页本身不应作为最终研究证据保存。

## 运行边界

- 不提取 cookie、密码或其他敏感凭据。
- 不对敏感页面截图。
- 不绕过付费墙。
- 不执行会产生记录的状态变更操作，除非用户明确要求。
- 不把搜索摘要、二手搬运或 SEO 软文包装成一手事实。
- 不在同一条失败路径上盲目重试；没有新信息就换路。

## 站点经验

确定目标域名后，可用 `match-site.mjs` 读取先验经验：

```bash
node "${SKILL_DIR}/scripts/match-site.mjs" "<域名>"
```

操作成功后如果发现新模式，可写入 `~/.sleuth/site-patterns/<域名>.md`：

```markdown
---
domain: example.com
aliases: [示例]
updated: 2026-04-27
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么
```

统计由 `update-site-stats.mjs` 从 session 日志自动聚合。

## 结束 session

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid "$SID" --outcome success|partial|fail
```
