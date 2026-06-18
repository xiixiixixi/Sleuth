---
name: sleuth
description: >-
  所有搜索、网页读取、浏览器验证与网络研究任务都应优先通过此 skill 处理。触发场景：用户要求搜索信息、查看网页内容、验证页面或来源、访问动态渲染页面、使用登录态浏览器、读取最新网页信息、或处理任何需要真实网页证据的网络任务。
---

# sleuth

sleuth 是搜索、浏览和研究判断层。不垄断网络入口，也不拦截工具——但必须知道每类工具能证明什么、不能证明什么。

## 建立 session

**sleuth 触发后第一件事：建 session。每次都必须，不跳过。**

```bash
SID=$(node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action start --query "用户问题" --type "技术文档|学术论文|产品评测|政策法规|实时热点|生活消费|其他")
SLEUTH_OUTPUT=$(node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid "$SID")
```

所有后续操作都带 `$SID`。同一对话内多次调用 sleuth 时，每次都建新 session，不复用旧的。

## 响应层级

从最轻的路径开始，不够再升级。不确定时先走低一级。

| 层级 | 适用场景 | 常见做法 |
|------|----------|----------|
| **直答** | 已有知识足够，且无明显时效风险 | 直接回复，session 只做记录 |
| **快速验证** | 一两个高质量来源就能确认 | 搜索发现入口 + 对**一手来源**做一次 fetch 确认（不能停在 snippet） |
| **定向研究** | 需要多步查证，但问题仍集中 | 混合工具；`must_verify` 的事实必须回 WebFetch / 浏览器，不靠搜索摘要 |
| **深度研究** | 多源交叉、冲突、用户需要完整交付物 | 子 Agent + 完整报告 |

## 工具选择

**缺什么，补什么。从最轻的开始，不够再升级。**

- **缺入口**（不知道去哪找）→ WebSearch 发现候选来源
- **缺正文**（知道在哪，但没读内容）→ WebFetch / reader 先拿；拿不到或不满意 → 浏览器
- **缺证据强度**（需要确认内容真实性）→ reader 结果只是线索；核心结论必须回到原始来源验证；不确定 reader 给的是不是真的 → 浏览器
- **缺交互 / 登录态 / 动态内容** → 浏览器
- **其他工具都不可用**（WebSearch 被限、reader 返回空/失败）→ 必须用浏览器，不能因为没有轻量工具就放弃

| 工具 | 适合做什么 | 证据边界 |
|------|------------|----------|
| **WebSearch** | 发现候选、别名、关键词地图 | snippet 有偏置，不能直接当证明 |
| **WebFetch / reader** | 快速读正文、扫静态页面 | 不保证动态内容、登录态、页面真实状态 |
| **agent-browser** | 一手验证、动态渲染、登录、交互 | 适合高价值验证，不适合大范围扫网页 |
| **本地历史 / 书签** | 找用户曾访问、组织内部入口 | 入口记忆，不等于事实证据 |

做搜索时读 `references/search-guide.md`，用浏览器时读 `references/tool-guide.md`。

## 失败与兜底

工具失败不是放弃的理由——按“触发信号 → 一线修复 → 仍失败兜底”处理，绝不拿空结果或搜索摘要冒充一手事实。

| 失败信号 | 一线修复 | 仍失败兜底 |
|---|---|---|
| WebSearch 被限 / 返回空 | 换关键词、别名再搜一次 | 直接上浏览器找入口，不因没有轻量工具就放弃 |
| reader / WebFetch 返回空、登录墙或疑似 JS 壳 | 升级浏览器（`--cdp`）抓真实渲染 | 仍拿不到 → 该来源标“未取得正文”写入缺口，不拿空结果当内容 |
| 页面需登录但登录态未确认 | `check-deps.mjs --ensure-login <登录页>` 登一次再抓 | 仍无法确认 → 停止依赖登录态的抓取，写“登录态未验证”入缺口，不伪造 |
| 浏览器被杀 / 会话丢失 | 重开 session 并重新验证登录态 | 关键结论重验前不得标 success |
| 同一路径反复失败、无新信息 | 换路：换来源 / 换工具 / 换角度 | 仍无突破 → 如实 `--outcome partial` 并披露缺口，不盲目重试 |

## 定向研究

- 至少给用户一个可追溯来源 URL。
- reader 结果是线索不是证据——页面需要动态交互、登录态或真实状态验证时，不要假装 reader 够用，直接切浏览器。

## 深度研究

```bash
SID=$(node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action start --query "问题" --type research)
SLEUTH_OUTPUT=$(node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid "$SID")
```

常见做法：

- **以下情况必须 deliver save**：WebReader 抓到核心证据页面的摘录、浏览器验证完关键事实后的结论、子 Agent 完成某个子任务后的 findings。
- 只有当角度真正独立时，才并行派子 Agent。
- 证据稳定时直接写报告；关键结论仍脆弱、冲突或覆盖不足时，做独立审查或补查。

### 按需起手

不是每次都跑所有脚本。只在能减少重复劳动时才用。

```bash
# 看以前有没有做过类似研究
node "${CLAUDE_SKILL_DIR}/scripts/research-index.mjs" --action recall --query "关键词" --limit 5

# 命名实体无召回命中时，可回填最近资料
node "${CLAUDE_SKILL_DIR}/scripts/research-index.mjs" --action backfill --days 7

# 用户提到"之前看过 / 书签里 / 内部系统"时
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" "关键词" --since 7d
```

recall 命中后：

1. 读最相关的 1-3 个文件，标为"历史线索"，不当当前事实。
2. 会过期或影响决策的事实重新验证原始来源。
3. 有价值时用 `deliver save` 保存本轮摘录，不复制整份旧 session。

### 子 Agent

适合并行的情况：不同来源类型彼此独立；同一主题下彼此不干扰的站点；任务大到主 Agent 上下文混乱。

不适合并行：重复搜索同一角度；主 Agent 还没弄清目标和来源拓扑；新探针只会复读已知结论。

**派子 Agent 前自检（缺任一项不要派）：**

```
□ 合同含「开始前先读 subagent-guide.md」
□ 合同含 must_verify 清单（具体到字段，不是泛泛"核实信息"）
□ 合同含「禁止自建 session，所有 session-logger / deliver 调用带 --role subagent / --main-sid」
□ 合同含「完成记 subagent_done 并上报 searches/fetches/browser/delivers 计数」
□ 每个子 Agent 有独立 browser_session 名
```

子 Agent 纪律靠合同传达。漏抄会导致子 Agent 自建 session 切碎主流程、只搜不验把摘要当事实——脚本护栏（`--role` / `low_verification`）只是兜底，合同写全才是第一道防线。

创建研究子 Agent（合同由脚本生成，不再手抄；把下面命令的整段输出贴进子 Agent prompt）：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs" \
  --sid "$SID" \
  --browser-session "${SID}-pricing" \
  --goal "验证该产品当前公开定价与计费单位" \
  --enough-when "找到官方 pricing / help / docs 中能直接支持价格结论的页面，或明确写出公开价格不存在" \
  --must-verify "价格数字" \
  --must-verify "计费单位" \
  --must-verify "是否需要 sales contact" \
  --known-clue "域名: example.com" \
  --known-clue "可能入口: pricing / docs / help center" \
  --known-clue "已知疑点: 搜索结果里有旧价格"
```

> 合同由脚本生成，主 Agent 不会再漏抄纪律条款。每个并行子 Agent 仍要用独立 `browser_session` 名。

### 独立审查（深度研究强制）

**派了 ≥2 个研究子 Agent 的深度研究，盖 `success` 前必须先过一次独立审查。** 这不是可选项：`session-logger --action finish --outcome success` 会检查本 session 有没有 `review_done`，没有就硬拒（`--force` 也绕不过），只能补审查或如实标 `partial`。简单任务（<2 子 Agent）不受此约束。

审查合同由脚本生成（把整段输出贴进审查子 Agent prompt）：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs" --review --sid "$SID"
```

审查子 Agent 读 `${SLEUTH_OUTPUT}` 下所有交付文件，质疑核心结论，完成时记 `review_done`：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "$SID" --role subagent \
  --operation '{"type":"review_done","is_enough":true}'
```

**这条是硬卡**：审查返回 `is_enough=false` 时，`finish --outcome success` 会被直接拒绝（`--force` 也绕不过）。主 Agent 必须按 `next_actions` 补查后重新派审查到 `is_enough=true` 再标 success，或如实 `--outcome partial` 收尾并在报告披露未解决的缺口。**不要为了过闸把 review_done 当勾选项——闸门看的是 is_enough，不是有没有记。**

### 浏览器

sleuth 按平台自动选最优浏览器连接方式：

| 模式 | 平台 | 用户一次性操作 | 之后 |
|------|------|--------------|------|
| **AppleScript** | macOS | Chrome 菜单 View → Developer → 勾 "Allow JavaScript from Apple Events" | 永久零摩擦，直接操控日常 Chrome（全部登录态） |
| **Approval mode** | Win/Linux | `chrome://inspect/#remote-debugging` 勾 toggle | 每次新 session Chrome 弹窗点 Allow |
| **Managed**（fallback） | 全平台 | 无（自起独立 Chrome） | 需 `--ensure-login` 手动登录每个站点 |

check-deps 自动检测平台和模式可用性。macOS 优先 AppleScript（最简），不可用时降级。Win/Linux 走 Chrome 144+ approval mode（需 Chrome ≥ 144）。都不行时 fallback 到自起隔离 Chrome。

AppleScript / approval mode 都连的是你的**日常 Chrome**——天然带全部登录态，无需重复登录。Managed 模式用的是独立空 profile。
### 关闭 session

**所有子 Agent 完成后、合成报告前，先关闭 session。** 避免写报告时遗忘。

```bash
# 关闭所有浏览器 session
agent-browser --cdp 9222 --session "${SID}-main" close
# 如有子 Agent 未正确关闭
agent-browser session list
agent-browser close --all    # 安全操作，不影响用户手动打开的 Chrome

# 结束 session 日志
# 注意：若有子 Agent 被标 low_verification 且未补验，--outcome success 会被硬拒（exit 3，--force 也绕不过）。
# 只能二选一：① 回原始来源补验后再标 success；② 或如实用 --outcome partial。
# partial 收尾时若交付了报告却零一手核验，会告警并在 session 打 unverified_delivery 标记——
# 必须在交付物里如实披露"结论基于搜索摘要、未一手核验"及覆盖缺口，不要当完整结论交付。
node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid "$SID" --outcome success|partial|fail
```

### 交付

**流程：关闭 session → 读取所有子 Agent 输出 → 合成最终报告 → 交付。**

1. 读取子 Agent 的 deliver save 文件。**优先用 `deliver --action list --sid "$SID"` 按主 SID 汇总**，而不是只 `ls ${SLEUTH_OUTPUT}/docs`：子 Agent 若用了独立 session，证据会落到别处，全局 `registry.jsonl` 才能关联到它们。`deliver save` 出现"证据脱离主流程"告警时，必须回到 registry 补齐，不要漏掉这些文件。**另：`deliver save` 交付 doc 报告时，若本 session 尚无任何一手核验记录（visit / 带 fetch 的子 Agent），会告警——别停在 WebSearch 摘要层，先回 WebFetch/浏览器核验承重结论再交付。**
2. 合成为一份最终报告，不生成多个"final / merged / summary"版本。
3. 报告建议区分：已验证事实、高置信推断、未确认线索、冲突信息、覆盖缺口。**子 Agent 的 `subagent_done` 带 `low_verification` 标记时，其结论只到搜索摘要层，必须降级为"未确认线索"或回原始来源补验后再用。**
4. 每个核心结论内联来源 URL，不要只在末尾堆 sources 列表。
5. **图文并茂（按 query 类型）**：产品对比 / 设计 / 图表解读 / 评测类报告，**必须图文并茂**——呈现型图片按 `references/tool-guide.md` 的"呈现型"流程归档并 `![图注](来源URL)` 内嵌，图注带来源 URL + 日期。纯事实 / 政策类不强求配图。证据型图片仍只附 URL + 标注"视觉分析"。

**输出按优先级：**

1. **用户指定了输出要求** → 严格按照用户要求输出，不做自作主张的调整。
2. **简单问题** → 内联回复 + 可追溯来源 URL。
3. **复杂问题** → 最终 Markdown 报告存入 `~/.sleuth/output/`，同时复制一份到用户 cwd，并内联总结性回复。

```bash
# 直接 pipe 内容保存（不需要先写临时文件）
cat <<'CONTENT' | node "${CLAUDE_SKILL_DIR}/scripts/deliver.mjs" --action save \
  --source /dev/stdin --type doc --name "页面名-摘录" --url "来源URL" --sid "$SID"
## 页面标题

摘录内容、关键数据、证据...
CONTENT

# 保存已有文件（截图等）
node "${CLAUDE_SKILL_DIR}/scripts/deliver.mjs" --action save \
  --type <screenshot|image|data> \
  --source <文件路径> --name <名> --url <URL> --sid "$SID"

# 多个中间交付物需要整理时才 merge（不是最终报告生成器）
node "${CLAUDE_SKILL_DIR}/scripts/deliver.mjs" --action merge --sid "$SID"
```

## 运行边界

- 不提取 cookie、密码或其他敏感凭据。
- 不对敏感页面截图。
- 不绕过付费墙。
- 不执行会产生记录的状态变更操作，除非用户明确要求。
- 不把搜索摘要、二手搬运或 SEO 软文包装成一手事实。
- 不在同一条失败路径上盲目重试；没有新信息就换路。

🔴 **CHECKPOINT · 执行前确认**：任何会产生记录或状态变更的动作——提交表单、发帖/留言、下单付款、改后台配置、点"确认/删除"——**执行前必须先获用户明确同意**。只读浏览（打开、滚动、读取、对非敏感页截图）无需确认。拿不准会不会改状态时，先停下来问，不要替用户按下按钮。
