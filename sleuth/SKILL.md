---
name: sleuth
description: 梦里寻 — 联网检索与浏览器操作。触发场景：搜索信息、查看网页、登录访问、社交媒体抓取、动态页面渲染等一切需要真实浏览器的网络任务。
---

# sleuth — 梦里寻

## 前置检查

在开始联网操作前，先判断问题复杂度，再按需执行环境检查：

### 问题分类

先检查 `~/.sleuth/output/` 是否有相关历史文件可复用。

| 维度 | 简单问题 | 复杂问题 |
|------|---------|---------|
| 答案结构 | 单一事实、一句话能答 | 需要多源整合、对比分析 |
| 来源需求 | 不需要或单一来源 | 需要交叉验证、一手来源 |
| 交互需求 | 不涉及登录/反爬 | 需要登录态、动态渲染 |

**简单问题** → **直接回复**，跳过 check-deps 和 session 日志。如需确认：打开一个搜索+一个页面，读完即关 tab。问题含「最新」「现在」「实时」等时间词 → 必须打开页面确认。

简单路径故障：页面不可达换来源，搜索为空扩词或中英文各搜一次，两次失败则降级回复。

**不确定** → 先按简单处理，发现不够再升级为完整流程。

**复杂问题** → 走完整流程：环境检查 → 多角度搜索 → 子 Agent 循环调研 → 交叉验证 → 结果交付。

### 缓存优先

处理任何请求前检查 `~/.sleuth/output/` 历史交付物。详细判定规则见 `references/cache-guide.md`。

```bash
find ~/.sleuth/output/ ~/.sleuth/sessions/ -type f \( -name "*.json" -o -name "*.txt" -o -name "*.md" \) 2>/dev/null | head -30
```

文件多时用 Explore subagent 搜索缓存：
```
Agent({ subagent_type: "Explore", prompt: "在 ~/.sleuth/output/ 和 ~/.sleuth/sessions/ 中搜索「关键词」。返回：是否找到、路径、修改时间、时效性评估。不返回内容。" })
```

### 环境检查与初始化（仅复杂问题）

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

自动检测 agent-browser、Chrome CDP 端口、站点经验列表，清理过期输出。Chrome 未开 CDP 时自动重启（保留登录态）。

通过后创建 session 和输出目录：

```bash
SID=$(node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action start --query "原始问题" --type 查询类型)
SLEUTH_OUTPUT=$(node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid $SID)
```

确定目标域名后匹配站点经验：
```bash
node "${CLAUDE_SKILL_DIR}/scripts/match-site.mjs" "<域名>"
```

> 温馨提示：部分站点对浏览器自动化检测严格，存在账号封禁风险。Agent 继续操作即视为接受。

**隐私**：不对敏感页面截图（银行、邮箱、私信），不提取 cookie/密码，不在不知情下执行会产生记录的操作。

## 核心原则

- **任务驱动**：每一步围绕目标做决策，不预设完整路径
- **边看边判**：点进去看了才知道哪个来源好
- **遇阻则绕**：弹窗/登录墙/死链，先判断是否真挡住了，内容可能已在 DOM 中
- **失败即信号**：重试无改善时换方向，不在同一方式上反复
- **达成立止**：确认成功标准后立即停止

## 强制规则

1. **复杂问题必须用 `deliver.mjs --action save` 保存文件**。不等全部完成，每积累一批重要发现就保存一次。
2. **每访问一个重要页面必须用 `session-logger --action log` 记录**。这是站点经验生成的数据源。
3. **子 Agent 结果增量整合**：收到一个子 Agent 结果就立即写入最终文件，不要等全部子 Agent 完成再一次性整合。每个子 Agent 返回后立刻 Read + Edit。

## 搜索与发现

sleuth 是你（包括子 Agent）唯一的联网工具。不使用 WebSearch、WebFetch 等外部工具。完整命令参考 `references/tool-guide.md`。

### 搜索策略

- **多角度**：任何主题至少 4-5 个角度互为补充，读到的关键词作为下一角度的搜索词
- **读全文**：搜索引擎摘要可能过时/截断，必须点进原文
- **Broad → narrow**：先宽搜看量级，太多加限定，太少扩词或中英文各搜
- **探索式循环**：搜索 → 点进 2-3 个链接 → 不够换词重搜 → 够了停止。同一页 3 个链接不理想就换词

### 可信度与归因

**一手 > 二手**。搜到来源后必须读原文。同一事实需 3 个以上独立来源（4 个为佳）。注意循环印证假象——追溯传播链源头。

所有信息标注来源 URL。不给无来源表述。

### 本地资源

用户指向本人访问过的页面时，先检索 Chrome 书签/历史：
```bash
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" [关键词...] [--only bookmarks|history] [--limit N]
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

中等复杂度任务（如对比两个产品）主 Agent 自行搜索，不启动子 Agent。

### 子 Agent 调用方式

**核心原则**：
- **子 Agent 禁止使用 Agent 工具**，所有搜索自己用 agent-browser 完成
- **禁止加载 sleuth skill**，改为读取 subagent-guide.md
- 描述目标不指定手段，用「获取」「调研」而非「搜索」「抓取」
- 给上下文，子 Agent 不需要从头开始
- **必须传入 SID、SKILL_DIR、SLEUTH_OUTPUT 三个变量**

```
SKILL_DIR="/Users/xxx/.claude/plugins/marketplaces/sleuth/sleuth"  # 从 check-deps 输出获取绝对路径
SID="2026-04-30-xxxx"       # session-logger start 返回的 SID
SLEUTH_OUTPUT="~/.sleuth/output/2026-04-30/xxxx"  # check-deps --output-dir --sid $SID 返回

Agent({
  description: "3-5 词描述任务",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: `
    你是一个调研执行者。先 Read references/subagent-guide.md，严格遵循其中的指引。

    禁止使用 Agent 工具。禁止加载 sleuth 主 skill。你只能自己用 agent-browser 搜索。

    关键变量（原样使用，不要自己创建新 session）：
    - SKILL_DIR=${SKILL_DIR}
    - SID=${SID}
    - SLEUTH_OUTPUT=${SLEUTH_OUTPUT}

    任务：${目标描述}
    已知上下文：${主 Agent 提供的已知信息}
    浏览器隔离：所有 agent-browser 命令带 --auto-connect --session ${SID}

    要求：
    1. 只返回摘要（关键发现 + 来源 URL），不要返回原始页面内容
    2. 完成时必须用 deliver.mjs --action save --sid ${SID} 保存关键发现
    3. 每访问一个重要页面，必须用 session-logger --action log --sid ${SID} 记录
    4. 完成后必须用 session-logger --action finish --sid ${SID} 结束
    5. 关闭自己创建的 tab
  `
})
```

**增量整合**：每收到一个子 Agent 的 background notification 结果，**立即** Read 最终文件 → Edit 写入该子 Agent 的发现。不要等所有子 Agent 完成再整合——每个结果都是一次编辑窗口。

主 Agent 等待 background notification 收集结果，每收到一个立即整合，最后去重 + 交叉验证。

## 浏览器操作

**强制：所有 agent-browser 命令必须带 `--auto-connect`。** 不带会启动独立的 Chrome for Testing，丢失登录态。

不操作用户已有 tab，所有操作在新 tab 中进行。完整命令参考 `references/tool-guide.md`。

### Snapshot-first 工作流

1. `open <url>` → `wait --load networkidle`
2. `snapshot -i` → 获取 @ref
3. `click @e3` / `fill @e5` → `wait --load networkidle`
4. `snapshot -i` → 页面变化后必须重新 snapshot

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

文本提取优先。详细场景（视频、音频、PDF、图片）见 `references/content-extraction.md`。

```bash
agent-browser --auto-connect eval "document.body.innerText"         # 全页文本（首选）
agent-browser --auto-connect eval --stdin <<'EOF'                   # 复杂提取
const rows = document.querySelectorAll("table tbody tr");
Array.from(rows).map(r => ({ name: r.cells[0].innerText, price: r.cells[1].innerText }));
EOF
```

截图仅用于：用户要求、内容在图片中无法文字提取、调试。

## 障碍处理

详细处理方式见 `references/obstacle-handling.md`。

- **登录**：先 eval 穿透遮罩，拿不到内容再请用户登录
- **CAPTCHA**：暂停，告知用户，5 分钟无响应换渠道
- **限流**：暂停该域名，换渠道或等 30 秒，重试仍限流则放弃
- **故障**：agent-browser 非零退出 → check-deps；页面超时 → 加 timeout；连续失败 → 换方式

## 任务收尾

1. 复杂问题通过 `deliver.mjs --action save` 保存文件
2. 关闭自行创建的 tab（Stop hook 兜底清理残留）
3. `session-logger --action finish --sid $SID --outcome success|partial|fail`
4. 发现新模式时写入站点经验

## 结果交付

**简单问题**直接内联回复。**复杂问题必须通过 deliver.mjs 保存至少一个文件。**

| 内容类型 | 交付方式 |
|---------|---------|
| 调研报告/总结 | **docs/（必须）** + 内联预览 |
| 网页文本/摘要 | 内联 + 来源 URL |
| 图片 | images/ |
| 视频字幕 | transcripts/ |
| 截图证据 | screenshots/ |
| 结构化数据 | data/（>10 行写文件） |

```bash
node "${CLAUDE_SKILL_DIR}/scripts/deliver.mjs" --action save \
  --type <doc|screenshot|image|transcript|data|page> \
  --source <源文件> --name <文件名> --sid $SID
```

## 站点经验

详细说明见 `references/site-experience.md`。确定目标域名后用 `match-site.mjs` 查找经验。发现新模式时主动写入 `~/.sleuth/site-patterns/<域名>.md`。

## References 索引

| 文件 | 内容 |
|------|------|
| `references/tool-guide.md` | agent-browser 完整命令速查 |
| `references/subagent-guide.md` | 子 Agent 叶子执行者手册 |
| `references/cache-guide.md` | 缓存判定与时效性规则 |
| `references/content-extraction.md` | 内容提取（视频/音频/PDF/图片） |
| `references/obstacle-handling.md` | 障碍处理（登录/CAPTCHA/限流/故障） |
| `references/site-experience.md` | 站点经验文件格式与统计 |
| `~/.sleuth/site-patterns/{domain}.md` | 域名经验（match-site.mjs 匹配） |
| `~/.sleuth/output/` | 交付文件 |
