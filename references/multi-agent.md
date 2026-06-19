# 多 Agent 协同

什么时候读这份：**任务有多个独立目标，可以并行**。主 agent 派子 agent 分头干，自己合成。

如果子问题之间有依赖（B 需要 A 的结果才能开始），不要派子 agent——直接主 agent 串行走 `deep-research.md`。

## 角色分工

```
主 Agent（supervisor）
  ├── 规划 + 派发 + 合成
  ├── 不亲自搜索（除非验证子 agent 的关键结论）
  │
  └── 子 Agent A ──┐
      子 Agent B ──┼── 各自独立研究，返回摘要 + 来源 URL
      子 Agent C ──┘
```

### 主 Agent（supervisor）的职责

1. **判断要不要派**（见下文"分治判断"）
2. **写好每个子 agent 的 prompt**（见下文"派发 prompt 写法"）
3. **等所有子 agent 返回**
4. **合成最终报告**（见下文"合成阶段"）

**主 agent 不亲自搜索**——你派子 agent 就是为了并行加速 + 上下文隔离。如果你又自己搜，等于白派。

例外：合成阶段发现某子 agent 的关键结论需要补验证，主 agent 可以自己上手补一刀，不要重新派子 agent。

### 子 Agent（researcher）的职责

1. **加载 sleuth skill**——主 agent 在 prompt 里写"必须加载 sleuth skill 并遵循指引"，子 agent 加载后，sleuth 的所有判断逻辑（响应层级、工具选择、失败兜底、可信度分层）对它自动生效
2. **完成单一目标**——一个子 agent 只负责一个独立的研究目标，不要让一个子 agent 跨多个不相关主题
3. **返回结构化摘要**——不是返回原始页面内容，而是 findings（已验证结论 + URL）+ gaps + red_flags
4. **关自己的浏览器 tab**——`agent-browser --session <name> close`，或 `agent-browser close --all` 兜底

**子 agent 不写最终报告**——它只交付研究发现。最终报告由主 agent 合成。

## 分治判断

**适合派子 agent**：
- 目标相互独立，结果互不依赖（对比 N 个产品 → 每个产品一个子 agent）
- 每个子任务量足够大（多页抓取、多轮搜索、需要浏览器）
- 主 agent 上下文紧张（继续自己干会塞满 context window）

**不适合派子 agent**：
- 目标有依赖关系（下一个需要上一个的结果）
- 简单单页查询（几次 WebSearch 就能答完）
- 主 agent 还没弄清要查什么（先自己探一遍拓扑再决定分治）
- 子任务之间高度重叠（会重复搜索同一来源）

**数量建议**：
- 2-3 个子 agent：典型对比场景（A vs B vs C）
- 4-6 个子 agent：多实体调研（"列出这个领域的 5 个玩家"）
- **不要超过 6 个**——合成阶段会爆炸，主 agent 处理不过来

**反例**：把同一个事实拆成多个子 agent 从不同角度搜（"X 的定价"、"X 的价格"、"X 多少钱"）。这是假并行，浪费 token。

## 派发 prompt 写法（目标导向）

用 `spawn-subagent.mjs` 生成 prompt：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawn-subagent.mjs" \
  --goal "验证产品 X 的当前公开定价" \
  --must-verify "价格数字" \
  --must-verify "计费单位" \
  --must-verify "是否需要 sales contact" \
  --known-clue "域名: x.com" \
  --known-clue "可能入口: /pricing, /docs"
```

把整段输出贴进子 agent 的 prompt。

### 关键原则：说要什么，不说怎么做

✅ 描述目标："验证 X 的定价"、"调研 Y 的融资历史"、"了解 Z 的核心功能"
❌ 指定路径："搜 pricing 页"、"爬 GitHub"、"查 Crunchbase"

为什么：指定路径会把子 agent 锁死到你的预设。有些事实需要走浏览器或 API，不是搜索能拿到的。子 agent 加载 sleuth skill 后有自己的判断力，让它自己选工具。

### must-verify 的写法

- **具体到字段**："价格数字"、"计费单位"、"是否需要 sales contact"
- **不要泛泛**："核实信息"、"查清楚"——子 agent 不知道要查什么
- **每条一个事实**：不要一条塞多个事实（"价格和计费单位"→ 拆成两条）

### known-clue 的价值

主 agent 自己探一遍拓扑后，把已知线索传给子 agent，避免子 agent 重复探索：
- 域名、可能入口（/pricing, /docs, /help）
- 已知疑点（搜索结果里有旧价格、官方页面疑似过期）
- 已排除的路径（已经试过 A 路径不行）

**没传 known-clue 时**，子 agent 会按最保守方式解释任务范围，不自行扩题——这是 spawn-subagent 的默认行为。

## 子 Agent 返回什么

每个子 agent 完成后返回：

```
findings:
  - <已验证结论 1> [来源 URL]
  - <已验证结论 2> [来源 URL]
  - ...

gaps:
  - <没取得的内容>
  - <为什么没取得：付费墙/登录墙/搜索空>

red_flags:
  - <可疑信息：疑似过期、营销话术、单一来源、SEO-heavy>
```

**不要返回原始页面内容**——主 agent 不需要看子 agent 抓的网页，只需要看结论。这是上下文隔离的核心价值。

**每个 finding 必须带 URL**——没 URL 的结论主 agent 不能直接用，要么丢弃，要么自己补验证。

## 合成阶段

主 agent 收齐所有子 agent 的摘要后：

### 1. 去重 + 去冲突

- 多个子 agent 报告同一事实 → 合并成一条，列出所有 URL
- 多个子 agent 报告冲突 → 不要抹平，明确写出冲突，标时间戳，给判断依据
- 子 agent A 的 finding 和子 agent B 的 red_flag 矛盾 → 主 agent 自己上手验证（这是例外情况）

### 2. 按 5 级可信度分类

```
已验证事实  ← 多个子 agent 一致 + T1 来源
高置信推断  ← 单子 agent + T1/T2 来源
未确认线索  ← 单子 agent + T3 来源，或子 agent 标了 red_flag
冲突信息    ← 子 agent 之间矛盾
覆盖缺口    ← 所有子 agent 的 gaps 汇总
```

### 3. 写最终报告

按 `deep-research.md` 的"阶段 5：合成"规则：
- 每个核心结论内联 URL
- 区分可信度
- 不要自指
- 用用户问题的语言

**主 agent 在报告里要披露分治情况**：
- "本报告基于 N 个子 agent 的并行研究"
- 列出每个子 agent 负责的目标
- 列出汇总的覆盖缺口

## 反模式

- **派太多子 agent**——超过 6 个时合成阶段爆炸。要么砍掉次要目标，要么串行做。
- **子 agent 之间共享状态**——子 agent 应该完全独立。如果一个需要另一个的结果，串行做，不要派。
- **主 agent 在合成时重新搜**——合成阶段用子 agent 给的材料。如果缺关键事实，主 agent 自己补一刀，不要重新派子 agent（会失去合成时机）。
- **子 agent 写最终报告**——子 agent 写的是研究发现，主 agent 才写最终报告。如果让子 agent 写报告，主 agent 失去合成视角，报告会割裂。
- **抹平冲突**——子 agent A 说 X，子 agent B 说 Y，不要选边。明确写出冲突，让用户判断。

## 跟单 agent deep research 的关系

`deep-research.md` 是单 agent 多轮研究——主 agent 自己从头干到尾。
本文档是多 agent 并行——主 agent 派子 agent 分头干。

**什么时候用哪个**：
- 子问题独立、量大 → 多 agent（本文档）
- 子问题有依赖、或单一复杂问题 → 单 agent deep research

**不要混用**——要么全程单 agent，要么全程多 agent。中途切换会让上下文混乱。
