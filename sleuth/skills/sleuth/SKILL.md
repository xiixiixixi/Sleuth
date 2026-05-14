---
name: sleuth
description: 联网检索与浏览器操作。触发场景：搜索信息、查看网页、登录访问、社交媒体抓取、动态页面渲染等一切需要真实浏览器的网络任务。使用场景：用户提到搜索、查一下、search、look up、联网、最新信息、网页内容提取；任何需要打开浏览器访问网页的任务。
---

# sleuth — 梦里寻

sleuth 是唯一联网方式。禁止 WebSearch、WebFetch、Fetch、curl、wget 及任何 MCP web 工具。所有联网通过 agent-browser 连接用户日常 Chrome。浏览器问题通过 `check-deps.mjs` 修复，不降级。

## 路由

收到联网需求后判断响应层级：

```
我能确信答案正确吗？
  ├─ 能，且无时效性 → 直答（不联网）
  ├─ 能，但需确认是否过时 → 快速验证（开一个页面确认）
  └─ 不能 →
      用户要单点事实还是全景？
        ├─ 单点 → 定向搜索（搜索 + 2-3页）
        └─ 全景 → 深度调研（Research Loop）
```

例：「React 最新版本号」→ 快速验证。「React vs Vue 2026 全面对比」→ 深度调研。两者都含「最新」但深度不同。

不确定时从低层级开始，不够再升级。

## 前置

所有层级（除直答）：

```bash
# 历史召回
node "${CLAUDE_SKILL_DIR}/../../scripts/research-index.mjs" --action recall --query "关键词" --limit 5
# 有命中先 Read，只搜增量

# 环境检查
node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs"

# 站点经验（确定域名后）
node "${CLAUDE_SKILL_DIR}/../../scripts/match-site.mjs" "<域名>"

# 本地 URL 检索（用户提到"之前看过"、"书签里"、"内部系统"时）
node "${CLAUDE_SKILL_DIR}/../../scripts/find-url.mjs" "关键词" --since 7d
```

命名实体无召回命中时先 backfill：
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/research-index.mjs" --action backfill --days 7
```

## 快速验证 / 定向搜索

无需 session。搜索方法见 `references/search-guide.md`。结果内联回复 + 来源 URL。

故障：页面不可达换来源，搜索为空扩词或中英文各搜，两次失败告知用户。

## 深度调研（Research Loop）

```bash
SID=$(node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action start --query "问题" --type research)
SLEUTH_OUTPUT=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" --output-dir --sid $SID)
```

| # | 阶段 | 产出 |
|---|------|------|
| 1 | **Frame** | 问题清单 + 成功标准 |
| 2 | **Expand** | 六方向盲区（`search-expansion.md`） |
| 3 | **Search** | 主线 + 探针并行 |
| 4 | **Review** | 派审查 subagent |
| 5 | **Patch** | 缺口补查 → 再审查（最多2轮） |
| 6 | **Deliver** | 合并 + 交付 |

搜索方法见 `references/search-guide.md`。

**启动时先输出**：Frame + Expansion + Search Plan（主 Agent vs 探针分工）。

### Review → Patch 循环

```
Search 完成 → deliver 齐全
  → 派审查 subagent（读 review-checklist.md）
  → is_enough?
      是 → Deliver
      否 → 派补查探针（scope 限定缺口）→ 再审查 → 最多2轮
```

- 审查由 subagent 执行，主 Agent 不自审
- Patch 只针对具体缺口，不重搜
- 每次 Patch 后必须再审查
- 最多 3 轮总（1 主搜 + 2 Patch）
- 达上限仍有缺口 → 交付但披露未覆盖范围

### 探针合并

探针完成后、审查前：
1. `deliver list --sid $SID` — 确认每个探针都有文件
2. `deliver merge --sid $SID` — 合并
3. Read 合并文件做编辑
4. 派审查 subagent

### 状态维护

长任务（3+ 轮或多探针）在对话中维护轻量状态块，防遗忘：

```
## State
- goal: 用户要解决什么
- questions: Q1 / Q2 / Q3...
- findings: [置信度] 结论 + URL
- gaps: 未覆盖
- red_flags: 矛盾/危险
```

更新时机：Frame 后写 goal/questions，每轮搜索后更新 findings/gaps，Review 后更新。不需要写入文件 — deliver 文件本身就是持久化。

## 探针调度

| 角色 | 何时 | 浏览器 |
|------|------|--------|
| 搜索探针 | 角度独立可并行 | 是 |
| 审查者 | 搜索完成后 | 否 |
| 补查探针 | 审查发现缺口 | 是 |

### 搜索探针模板

```
SKILL_DIR="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)"
SID="<session-id>"
SLEUTH_OUTPUT="~/.sleuth/output/YYYY-MM-DD/<session-id>"
BROWSER_SESSION="${SID}-<标识>"

Agent({
  description: "3-5 词",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: `
    你是调研探针。
    先 Read ${SKILL_DIR}/references/subagent-guide.md，严格遵循。

    禁止 Agent 工具。禁止加载 sleuth skill。

    变量：
    - SKILL_DIR=${SKILL_DIR}
    - SID=${SID}
    - SLEUTH_OUTPUT=${SLEUTH_OUTPUT}
    - BROWSER_SESSION=${BROWSER_SESSION}

    任务：${目标}
    已知：${已知信息}
    浏览器：所有命令带 --auto-connect --session ${BROWSER_SESSION}

    完成后：
    1. deliver.mjs --action save --sid ${SID} 保存发现
    2. session-logger --action log --sid ${SID} 记录 subagent_done
    3. 返回结构化摘要（findings/sources/leads/gaps/red_flags）
  `
})
```

**补查探针 = 搜索探针模板**，区别：任务描述改为审查者输出的 `patch_tasks` 内容，scope 限定为具体缺口。

### 审查者模板

```
SKILL_DIR="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)"

Agent({
  description: "审查覆盖度",
  subagent_type: "general-purpose",
  run_in_background: false,
  prompt: `
    独立审查员。只读文件，不搜索，不开浏览器。禁止 Agent 工具。

    1. Read ${SKILL_DIR}/references/review-checklist.md
    2. Read 交付文件：${文件列表}
    3. 对照问题清单：${Frame 问题 + 标准}
    4. 输出 coverage / weak_claims / missing_perspectives / red_flags / is_enough / patch_tasks
  `
})
```

## 浏览器

命令带 `--auto-connect --session <名>`。主 Agent 用 `${SID}-main`。参考 `references/tool-guide.md`。

## 内容提取

文本优先（`eval "document.body.innerText"`）。特殊场景见 `references/content-extraction.md`。

## 交付

- **快速验证/定向搜索**：内联回复 + 来源 URL
- **深度调研**：deliver save → 回复完整呈现内容（不是路径）→ 披露低置信度和缺口
- **指定格式**：调研完成后在用户工作目录生成 md/html

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/deliver.mjs" --action save \
  --type <doc|screenshot|image|transcript|data|page> \
  --source <源> --name <名> --url <URL> --sid $SID
```

## 硬规则

1. 联网前必须 recall。有命中必须 Read 再决定增量。
2. 深度调研必须 deliver save，每批发现就存。
3. 每访问重要页面必须 session-logger log。
4. 只有主 Agent 能 finish session。
5. 交付前必须派审查 subagent，主 Agent 不自审。
6. 不对敏感页面截图，不提取 cookie/密码，不执行产生记录的操作（除非用户要求）。

## 站点经验

确定目标域名后通过 `match-site.mjs` 查找先验知识：

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/match-site.mjs" "<域名>"
```

操作成功后发现新模式，写入 `~/.sleuth/site-patterns/<域名>.md`：

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

统计由 `update-site-stats.mjs` 从 session 日志自动聚合（访问次数、成功率、Bayesian 可信度）。

## 结束 session

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/session-logger.mjs" --action finish --sid $SID --outcome success|partial|fail
```
