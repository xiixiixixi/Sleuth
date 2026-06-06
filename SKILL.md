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
| **快速验证** | 一两个高质量来源就能确认 | 搜索 + 验证 |
| **定向研究** | 需要多步查证，但问题仍集中 | 混合工具，按需升级 |
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

创建研究子 Agent：

```text
你是独立研究子 Agent。

开始前先读：${CLAUDE_SKILL_DIR}/references/subagent-guide.md

SID: ${SID}
SLEUTH_OUTPUT: ${SLEUTH_OUTPUT}
browser_session: ${SID}-pricing

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

返回：findings、sources、gaps、red_flags、trust_notes。
```

### 独立审查

不是每个任务都需要。适合：结论影响决策且来源多冲突多；报告范围大主 Agent 有沉没成本；关键数字容易过时或被营销话术污染。轻量验证主 Agent 自检即可。

决定做审查时，派审查子 Agent：

```text
你是独立审查子 Agent。

开始前先读：${CLAUDE_SKILL_DIR}/references/subagent-guide.md

SID: ${SID}
SLEUTH_OUTPUT: ${SLEUTH_OUTPUT}

goal: 审查已有研究结论是否足够可信，是否有未暴露的关键缺口。
enough_when: 完成对所有核心结论的质疑，给出 is_enough 判断。
审查对象: ${SLEUTH_OUTPUT} 下的交付文件

审查重点：
- 目标覆盖：用户的问题答了没有
- 来源强度：核心结论是否过度依赖单一来源、低级来源或营销页
- 一手验证：价格、版本、融资等关键事实是否回到了原始来源
- 冲突处理：冲突是明确写出了，还是被强行抹平
- 时效性：旧数据有没有冒充新结论
- 视角覆盖：是否只有官方视角

返回：
  is_enough: true / false
  coverage: 已答问题 / 未答问题
  weak_claims: 证据脆弱或单一来源的结论
  missing_perspectives: 缺失的来源类型或立场
  red_flags: critical / warning 级风险
  conflicts: 未解释清楚的冲突
  next_actions: 需要补的动作（只列关键的）
```

审查返回 `is_enough=false` 时，主 Agent 根据 next_actions 委派新的研究子 Agent 补查（用正常研究合同）。缺口不可得时在最终报告里披露。

### 浏览器

所有命令带 `--cdp 9222 --session <name>`，主 Agent 用 `${SID}-main`，子 Agent 用各自独立 session。

并行原则：不同域名/子问题可以并行开独立 session；同一账号后台或会产生状态变更的流程不并行。

登录态原则：首次进入需登录态的任务时先确认页面确实已登录；未登录时停止依赖登录态的抓取，把"登录态未验证"写入缺口；浏览器被杀后重新打开也必须重新验证。

### 关闭 session

**所有子 Agent 完成后、合成报告前，先关闭 session。** 避免写报告时遗忘。

```bash
# 关闭所有浏览器 session
agent-browser --cdp 9222 --session "${SID}-main" close
# 如有子 Agent 未正确关闭
agent-browser session list
agent-browser close --all    # 安全操作，不影响用户手动打开的 Chrome

# 结束 session 日志
node "${CLAUDE_SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid "$SID" --outcome success|partial|fail
```

### 交付

**流程：关闭 session → 读取所有子 Agent 输出 → 合成最终报告 → 交付。**

1. 读取子 Agent 的 deliver save 文件。**优先用 `deliver --action list --sid "$SID"` 按主 SID 汇总**，而不是只 `ls ${SLEUTH_OUTPUT}/docs`：子 Agent 若用了独立 session，证据会落到别处，全局 `registry.jsonl` 才能关联到它们。`deliver save` 出现"证据脱离主流程"告警时，必须回到 registry 补齐，不要漏掉这些文件。
2. 合成为一份最终报告，不生成多个"final / merged / summary"版本。
3. 报告建议区分：已验证事实、高置信推断、未确认线索、冲突信息、覆盖缺口。**子 Agent 的 `subagent_done` 带 `low_verification` 标记时，其结论只到搜索摘要层，必须降级为"未确认线索"或回原始来源补验后再用。**
4. 每个核心结论内联来源 URL，不要只在末尾堆 sources 列表。图片分析结论附原始图片 URL，标注"视觉分析"。

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
