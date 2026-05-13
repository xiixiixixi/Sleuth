---
name: sleuth
description: 梦里寻 — 联网检索与浏览器操作。触发场景：搜索信息、查看网页、登录访问、社交媒体抓取、动态页面渲染等一切需要真实浏览器的网络任务。
---

# sleuth — 梦里寻

## 前置检查

在开始联网操作前，先召回历史交付物，再判断问题复杂度并按需执行环境检查：

### 问题分类

先用 `research-index recall` 检查是否有相关历史交付物可复用。

| 维度 | 简单问题 | 复杂问题 |
|------|---------|---------|
| 答案结构 | 单一事实、一句话能答 | 需要多源整合、对比分析 |
| 来源需求 | 不需要或单一来源 | 需要交叉验证、一手来源 |
| 交互需求 | 不涉及登录/反爬 | 需要登录态、动态渲染 |

**简单问题** → **直接回复**，跳过 check-deps 和 session 日志。如需确认：打开一个搜索+一个页面，读完即关 tab。问题含「最新」「现在」「实时」等时间词 → 必须打开页面确认。

简单路径故障：页面不可达换来源，搜索为空扩词或中英文各搜一次，两次失败则降级回复。

**不确定** → 只在答案显然是一句话事实时按简单处理；只要涉及「调研 / 深度 / 公司 / 产品 / 竞品 / 多源 / 最新 / 对比 / 客户案例 / 定价 / 融资 / 人员」等关键词，默认复杂流程。

**复杂问题** → 走完整流程：环境检查 → 多角度搜索 → 按复杂度启用子 Agent → 交叉验证 → 结果交付。

### 历史复用优先

处理任何请求前先召回历史交付物。`~/.sleuth/output/<date>/<sid>/` 是归档目录，真正的跨日期复用入口是 `research-index recall`。

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/research-index.mjs" --action recall --query "原始问题关键词" --limit 5
```

结果包含 `direct_hits`（最相关历史产物）、`related_sessions`（相关历史会话）和 `useful_artifacts`（可读取文件路径）。有命中时先 Read 相关交付文件，判断哪些内容可复用，只搜索增量信息。没命中再正常完整搜索。

如果 query 是公司、产品、人物、项目、论文等命名实体，且 `recall` 无命中，必须先回填最近 7 天，再执行一次 `recall`：

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/research-index.mjs" --action backfill --days 7
node "${CLAUDE_SKILL_DIR}/../../scripts/research-index.mjs" --action recall --query "原始问题关键词" --limit 5
```

### 环境检查与初始化（仅复杂问题）

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs"
```

自动检测 agent-browser、Chrome CDP 端口、站点经验列表，清理过期输出。Chrome 未开 CDP 时：如果是 sleuth 启动的 Chrome 则自动重启（保留登录态）；如果是用户自己的 Chrome 则提示用户手动退出后重试。

通过后创建 session 和输出目录：

```bash
SID=$(node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action start --query "原始问题" --type 查询类型)
SLEUTH_OUTPUT=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" --output-dir --sid $SID)
```

确定目标域名后匹配站点经验：
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/match-site.mjs" "<域名>"
```

### 知识库查询

需要实体级事实时，再查知识库：

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/research-index.mjs" --action query --query "原始问题关键词"
```

`query` 只返回实体匹配和相关交付文件；默认复用入口仍然是 `recall`。

> 温馨提示：部分站点对浏览器自动化检测严格，存在账号封禁风险。Agent 继续操作即视为接受。

**隐私**：不对敏感页面截图（银行、邮箱、私信），不提取 cookie/密码，不在不知情下执行会产生记录的操作。

## 核心原则

- **任务驱动**：每一步围绕目标做决策，不预设完整路径
- **边看边判**：点进去看了才知道哪个来源好
- **遇阻则绕**：弹窗/登录墙/死链，先判断是否真挡住了，内容可能已在 DOM 中
- **失败即信号**：重试无改善时换方向，不在同一方式上反复
- **达成立止**：确认成功标准后立即停止

## 强制规则

1. **任何联网/调研前必须先执行 `research-index recall`**。有命中时必须先 Read 相关交付文件，再决定只做增量搜索还是完整搜索。
2. **复杂问题必须用 `deliver.mjs --action save` 保存文件**。不等全部完成，每积累一批重要发现就保存一次。
3. **每访问一个重要页面必须用 `session-logger --action log` 记录**。这是站点经验生成的数据源。
4. **只有主 Agent 能结束 session**。子 Agent 禁止执行 `session-logger --action finish`；主 Agent 在最终 merge、交付和清理后再 finish。
5. **子 Agent 整合方式**：子 Agent 各自 deliver 独立文件到 docs/。**必须等待所有子 Agent 的 background notification 全部收到后**，才能执行 `deliver merge`。merge 前先执行 `deliver list --sid $SID`，确认每个子任务都有对应文件。提前 merge 会遗漏尚未完成的子 Agent 文件。合并后再 Read 合并文件做最终编辑（去重、调整结构、补写总结）。

## 搜索与发现

sleuth 是你（包括子 Agent）唯一的联网工具。不使用 WebSearch、WebFetch 等外部工具。完整命令参考 `${CLAUDE_SKILL_DIR}/../../references/tool-guide.md`。

### 搜索哲学

**核心信念：信息有栖息地。** 每条信息都有它最可能存在的地方。搜索前先想：这类信息通常住在哪里？

- 技术实现 → 官方文档、GitHub issues、StackOverflow（人在哪里踩坑，答案就在哪里）
- 产品评价 → 用户自己的阵地（Reddit、Twitter、独立博客），而不是官网或产品页
- 商业情报 → 数据的权威来源（Crunchbase 融资、LinkedIn 人员、法院/监管文件）
- 新闻时效 → 离事件发生地最近的渠道（英文新闻先于中文，官方博客先于媒体转载）
- 争议观点 → 要看正反两面，不能只看一边

**搜索前三问：**

1. "我要找的信息，最有可能最先发布在哪里？" → 决定搜索渠道
2. "这个信息的权威来源是谁？" → 一手来源 > 二手转载 > 三手总结
3. "第一个渠道没找到，下一个最可能的地方是哪里？" → 决定搜索顺序，不要机械地轮一遍所有引擎

**搜索纪律：**

- **读全文**：搜索引擎摘要可能过时/截断，必须点进原文
- **Broad → narrow**：先宽搜看量级，太多加限定，太少扩词或中英文各搜
- **探索式循环**：搜索 → 点进 2-3 个链接 → 不够换词重搜 → 够了停止。同一页 3 个链接不理想就换词
- **站内搜索**：找到目标网站后用 `site:域名 关键词` 深挖
- **多引擎**：英文用 Google，中文用百度。同一关键词不同引擎结果差异大

**反面原则——不要做的事：**

- 不要所有问题都用同一套搜索引擎组合
- 不要用中文关键词搜只有英文来源的信息（反之亦然）
- 不要搜技术问题时优先看新闻媒体
- 不要用通用搜索去找结构化数据（融资数据、人员信息）
- 不要只搜一次就放弃——换个角度、换个语言、换个平台

### 可信度与归因

**一手 > 二手**。搜到来源后必须读原文。同一事实需 3 个以上独立来源（4 个为佳）。注意循环印证假象——追溯传播链源头。

所有信息标注来源 URL。不给无来源表述。

### 本地资源

用户指向本人访问过的页面时，先检索 Chrome 书签/历史：
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/find-url.mjs" [关键词...] [--only bookmarks|history] [--limit N]
```

## 结构化调研（Plan Mode）

满足任一条件时先制定计划再执行：
- 明确是复杂调研
- 预计需要 3+ 个子 Agent
- 涉及多源交叉验证

**两阶段结构**：
1. **广度探索**：多角度并行搜索，每个角度一个子 Agent。追求覆盖面
2. **深度定向**：基于阶段 1 发现，对有料方向定向深入。补齐一手来源、交叉验证

## 递进式分治：子 Agent 循环调研

**主 Agent 是总指挥，不是一次性任务分发器。** 模式：发一轮 → 收结果 → 分析缺口 → 再发一轮 → 循环至充足。

**硬性规则：只有主 Agent 能调用 Agent 工具。子 Agent 禁止嵌套派发。**

### 多轮信号

以下任一出现就需要再发一轮：
- 发现了新关键词/术语/人名 → 必须追
- 来源质量不够（多为二手） → 发子 Agent 追一手
- 语言信息不对称 → 补另一语言
- 关键事实来源不足（<3 个独立来源）

### 停止信号

- 信息饱和（新一轮新增 <20%）
- 交叉验证达标（3+ 独立来源）
- 收益递减

### 主 Agent 职责

1. **分解**：拆成并行的搜索角度
2. **发令**：给每个子 Agent 清晰目标
3. **判断**：收结果后评估质量
4. **整合**：合并成完整结论

中等复杂度任务（如只对比两个明确产品）主 Agent 可以自行搜索。凡是「深度调研公司 / 产品线 / 市场 / 客户案例 / 定价 / 融资 / 人员 / 多语言来源」之一，必须至少拆出 2 个并行角度；预计 3+ 个角度时进入结构化调研。

### 子 Agent 调用方式

**核心原则**：
- **子 Agent 禁止使用 Agent 工具**，所有搜索自己用 agent-browser 完成
- **禁止加载 sleuth skill**，改为读取 subagent-guide.md
- 描述目标不指定手段，用「获取」「调研」而非「搜索」「抓取」
- 给上下文，子 Agent 不需要从头开始
- **必须传入 SID、SKILL_DIR、SLEUTH_OUTPUT、BROWSER_SESSION 四个变量**

```
SKILL_DIR="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)"  # sleuth 插件根目录；必须是绝对路径
SID="2026-04-30-xxxx"       # session-logger start 返回的 SID
SLEUTH_OUTPUT="~/.sleuth/output/2026-04-30/xxxx"  # check-deps --output-dir --sid $SID 返回
# 每个子 Agent 用不同的 BROWSER_SESSION 实现浏览器 tab 隔离，避免并行冲突
BROWSER_SESSION="${SID}-<唯一标识>"  # 如 "${SID}-product", "${SID}-pricing"

Agent({
  description: "3-5 词描述任务",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: `
    你是一个调研执行者。先 Read ${SKILL_DIR}/references/subagent-guide.md，严格遵循其中的指引。

    禁止使用 Agent 工具。禁止加载 sleuth 主 skill。你只能自己用 agent-browser 搜索。

    关键变量（原样使用，不要自己创建新 session）：
    - SKILL_DIR=${SKILL_DIR}
    - SID=${SID}
    - SLEUTH_OUTPUT=${SLEUTH_OUTPUT}
    - BROWSER_SESSION=${BROWSER_SESSION}

    任务：${目标描述}
    已知上下文：${主 Agent 提供的已知信息}
    浏览器隔离：所有 agent-browser 命令带 --auto-connect --session ${BROWSER_SESSION}

    要求：
    1. 只返回摘要（关键发现 + 来源 URL），不要返回原始页面内容
    2. 完成时必须用 deliver.mjs --action save --sid ${SID} 保存关键发现
    3. 每访问一个重要页面，必须用 session-logger --action log --sid ${SID} 记录
    4. 完成后记录 subagent_done，不要 finish 主 session：
       node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "${SID}" --operation '{"type":"subagent_done","name":"${BROWSER_SESSION}"}'
    5. 关闭自己创建的 tab
  `
})
```

**结果整合**：所有子 Agent 完成后，先执行 `deliver list --sid $SID`，确认每个子任务都已 deliver 文件；再执行 `deliver merge` 合并 docs/ 下所有文件，然后 Read 合并文件，做最终编辑（去重、调整章节、补写总结）。如果需要在子 Agent 完成过程中就查看结果，可以提前 Read 单个子 Agent 的 deliver 文件。

主 Agent 等待 background notification 收集结果，全部完成后 list 校验 + merge + 编辑。

## 浏览器操作

**强制：所有 agent-browser 命令必须带 `--auto-connect --session <会话名>`。** 主 Agent 使用 `${SID}-main`；子 Agent 使用主 Agent 传入的 `${BROWSER_SESSION}`，禁止子 Agent 使用 `${SID}-main`。不带 `--auto-connect` 会启动独立的 Chrome for Testing，丢失登录态。不带 `--session` 会和用户已有 tab 混在一起。

不操作用户已有 tab，所有操作在新 tab 中进行。完整命令参考 `${CLAUDE_SKILL_DIR}/../../references/tool-guide.md`。

### Snapshot-first 工作流

1. `open <url>` → `wait --load networkidle`
2. `snapshot -i` → 获取 @ref
3. `click @e3` / `fill @e5` → `wait --load networkidle`
4. `snapshot -i` → 页面变化后必须重新 snapshot
5. **提取完成后记录 visit**：
   ```bash
   # 成功提取内容
   node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action log --sid $SID --operation '{"type":"visit","url":"<URL>","domain":"<域名>","extraction_success":true}'
   # 提取失败或页面不可用
   node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action log --sid $SID --operation '{"type":"visit","url":"<URL>","domain":"<域名>","extraction_success":false}'
   ```

**@ref 会过期**：页面变化后立即失效，不确定时多 snapshot 一次。

### 等待策略

- 预期元素出现：`wait @ref` 或 `wait --text "..."`
- URL 变化：`wait --url "**/new-page"`
- SPA 兜底：`wait --load networkidle`
- 避免裸 `wait 2000`

### Tab 管理

批量打开每次不超 5 个。任务结束后关闭自行创建的 tab。

### 交互方式

- **程序化**（构造 URL、eval DOM）：快但可能触发反爬
- **GUI 交互**（点击、填写）：确定性最高，程序化受阻时可靠兜底

## 内容提取

文本提取优先。详细场景（视频、音频、PDF、图片）见 `${CLAUDE_SKILL_DIR}/../../references/content-extraction.md`。

```bash
agent-browser --auto-connect --session ${SID}-main eval "document.body.innerText"         # 全页文本（首选）
agent-browser --auto-connect --session ${SID}-main eval --stdin <<'EOF'                    # 复杂提取
const rows = document.querySelectorAll("table tbody tr");
Array.from(rows).map(r => ({ name: r.cells[0].innerText, price: r.cells[1].innerText }));
EOF
```

截图仅用于：用户要求、内容在图片中无法文字提取、调试。

## 障碍处理

详细处理方式见 `${CLAUDE_SKILL_DIR}/../../references/obstacle-handling.md`。

- **登录**：先 eval 穿透遮罩，拿不到内容再请用户登录
- **CAPTCHA**：暂停，告知用户，5 分钟无响应换渠道
- **限流**：暂停该域名，换渠道或等 30 秒，重试仍限流则放弃
- **故障**：agent-browser 命令失败时的处理流程：
  1. 运行 `check-deps` 修复环境（自动检测并重启 Chrome 开启 CDP）
  2. 修复后重试原 agent-browser 命令
  3. 仍然失败 → 换渠道（换搜索引擎、换关键词），不要跳过浏览器操作
  4. 页面超时 → 加 timeout；连续失败 → 换方式

**遇到障碍时必须记录**（用于站点经验系统）：
```bash
# CAPTCHA
node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action log --sid $SID --operation '{"type":"captcha","url":"<URL>","domain":"<域名>"}'
# 登录墙
... --operation '{"type":"login_wall","url":"<URL>","domain":"<域名>"}'
# 付费墙
... --operation '{"type":"paywall","url":"<URL>","domain":"<域名>"}'
# 死链
... --operation '{"type":"dead_link","url":"<URL>","domain":"<域名>"}'
# 反爬
... --operation '{"type":"anti_bot","url":"<URL>","domain":"<域名>"}'
```

## 任务收尾

**必要步骤**：
1. 复杂问题通过 `deliver.mjs --action save` 保存文件
2. 所有子 Agent 完成后，合并结果并做最终编辑：
   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/deliver.mjs" --action list --sid $SID
   node "${CLAUDE_SKILL_DIR}/../../scripts/deliver.mjs" --action merge --sid $SID
   ```
   `list` 用于确认每个子任务都有 deliver 文件；merge 后 Read 合并文件，去重、调整结构、补写总结
3. 关闭自行创建的 tab（Stop hook 兜底清理残留）
4. `session-logger --action finish --sid $SID --outcome success|partial|fail`

`finish` 会自动索引本次调研到 `~/.sleuth/output/registry.jsonl` 和知识库；失败只警告，不影响交付。发现新模式时写入站点经验。

## 结果交付

**三种交付模式，按用户需求选择：**

### 简单问题 → 直接内联回复

不需要文件交付，直接在对话中给出答案。标注来源 URL。

### 复杂问题（用户未指定格式）→ 完整内容回复

复杂问题必须通过 deliver.mjs 保存文件到 output 目录。**但回复不能只给文件路径**，必须把核心内容完整展示给用户：

1. 用 deliver save 保存完整报告到 output
2. Read 保存的报告文件
3. 在回复中**完整呈现**报告内容（不是摘要，不是路径）
4. 格式清晰：标题、分段、表格、来源 URL

### 复杂问题（用户指定格式）→ 生成文档到当前目录

用户明确要求 ppt、pdf、md 等格式时：

1. 先按正常流程完成调研、deliver save 到 output
2. 在**用户当前工作目录**生成指定格式的文件：
   - md → 直接 Write 到 cwd
   - html → 用 Write 生成 HTML 文件到 cwd
   - 其他格式 → 说明限制，建议 md 或 html 替代
3. 回复中告知文件路径和简要内容摘要

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/deliver.mjs" --action save \
  --type <doc|screenshot|image|transcript|data|page> \
  --source <源文件> --name <文件名> --url <来源URL> --sid $SID
```

`--url` 是该文件内容来源的网页 URL，用于站点经验系统关联域名。

## 站点经验

详细说明见 `${CLAUDE_SKILL_DIR}/../../references/site-experience.md`。确定目标域名后用 `match-site.mjs` 查找经验。发现新模式时主动写入 `~/.sleuth/site-patterns/<域名>.md`。

## References 索引

| 文件 | 内容 |
|------|------|
| `${CLAUDE_SKILL_DIR}/../../references/tool-guide.md` | agent-browser 完整命令速查 |
| `${CLAUDE_SKILL_DIR}/../../references/subagent-guide.md` | 子 Agent 叶子执行者手册 |
| `${CLAUDE_SKILL_DIR}/../../references/cache-guide.md` | 缓存判定与时效性规则 |
| `${CLAUDE_SKILL_DIR}/../../references/content-extraction.md` | 内容提取（视频/音频/PDF/图片） |
| `${CLAUDE_SKILL_DIR}/../../references/obstacle-handling.md` | 障碍处理（登录/CAPTCHA/限流/故障） |
| `${CLAUDE_SKILL_DIR}/../../references/site-experience.md` | 站点经验文件格式与统计 |
| `~/.sleuth/site-patterns/{domain}.md` | 域名经验（match-site.mjs 匹配） |
| `~/.sleuth/output/` | 交付文件 |
