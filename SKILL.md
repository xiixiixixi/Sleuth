---
name: sleuth
description: >-
  联网检索、网页验证和研究交付 skill。用于查资料、搜东西、调研、验证来源、看网页、站内搜索、登录后内容、动态页面和复杂研究。核心是引导 Agent 做搜索判断，而不是提供固定 intent-router 或默认浏览器流程。
---

# Sleuth — Search Judgment Skill

Sleuth 只保留一个主原则：**搜索不是找链接，而是把用户的模糊问题转化为可验证证据，再转化为可使用判断。**

不要把 Sleuth 当爬虫、搜索 API 包装器、浏览器自动化框架或固定流程表。Agent 必须自主判断：该不该搜、搜哪里、用什么工具、证据是否足够、是否要升级浏览器、何时停止、如何交付。

---

## 0. 一次检索任务的第一性原理

每次任务先回答这九个问题：

1. 用户真正要解决什么？要信息、理解、判断，还是交付物？
2. 这个问题是否依赖当前事实？版本、价格、新闻、政策、产品能力、职位、榜单等都可能过期。
3. 这个事实最可能存在于哪类来源？官方、文档、论文、社区、评论、数据库、私有资料、登录后页面。
4. 当前运行环境有哪些工具？内置搜索、reader/fetch、浏览器、MCP、GitHub、文件、邮件、日历、PDF、图片、代码执行等。
5. 每个工具能发现什么、验证什么、看不到什么、是否需要登录态、是否可能产生状态变更？
6. 哪些结论必须回到原始来源？搜索摘要、SEO 文、转载和单条评论只能做线索。
7. 是否需要反证？重要判断必须找限制、失败、投诉、替代解释、冲突信息和适用边界。
8. 是否需要用户补充人类可达材料？例如私域社群、付费报告、后台、App、销售 demo、访谈、截图、录屏。
9. 什么条件下可以停止？关键问题已答、证据足够、新搜索不再增加有效信息、剩余缺口已披露。

---

## 1. 工具选择原则

先选最轻路径，证据不足再升级。

- 稳定常识、纯写作、翻译、已有文本处理：通常不联网。
- 公共静态页面、官方文档、GitHub 文件：优先专用工具或 reader/fetch，不默认浏览器。
- 跨开放网络发现来源：使用搜索发现类工具，但搜索结果只作入口地图。
- GitHub、邮件、日历、文件、数据库等结构化资源：优先专用连接器。
- 动态渲染、登录态、站内搜索、筛选排序、页面可见状态、交互本身是证据：升级浏览器。
- 封闭渠道、私域、付费墙、App 内内容、线下体验：要求用户提供原料；不能伪造结论。

浏览器是最高保真验证层，不是默认入口。`agent-browser` 是执行层，Sleuth 负责判断何时使用它。

---

## 2. 证据规则

关键结论必须能落到：

```text
Claim → Evidence → Source → Time → Confidence → Conflict
```

输出时区分：

- 已验证事实：来源明确、可复核。
- 来源观点：某机构、用户、作者的说法。
- 高置信推断：基于证据的合理判断，必须说明推断关系。
- 未确认线索：可继续查，但不能当结论。
- 冲突信息：说明谁和谁冲突，可能原因是什么。
- 覆盖缺口：哪些渠道没拿到，哪些需要用户提供。
- 行动建议：基于当前证据的下一步。

不要为了完成任务而填补未知。拿不到就说拿不到。

---

## 3. 查询哲学

不要直接搜用户原话，要搜“答案世界会使用的语言”。

常见转换：

- 口语 → 专业词
- 中文 → 英文
- 问题 → 文档标题
- 现象 → 概念
- 好坏 → evaluation criteria / benchmark
- 问题 → limitations / risks / complaints / failure
- 对比 → vs / alternatives / comparison
- 案例 → case study / examples
- 方法 → guide / playbook / framework

复杂问题拆成多个子问题：背景、定义、事实、数据、案例、反面证据、判断标准、适用边界、对用户意味着什么。

---

## 4. 浏览器使用边界

需要浏览器的情况：

- reader 返回空壳、导航、登录提示、过短内容或明显失真。
- 页面依赖 JS、滚动、展开、筛选、排序或交互。
- 用户问某平台内、后台内、社区内、站内搜索结果。
- 页面真实状态、布局、图表、弹窗、价格表、按钮或可见性本身是证据。
- 登录后内容需要页面级验证。

Managed browser 默认使用独立 profile：`~/.sleuth/cdp-profile/`。不要触碰用户日常 Chrome，除非用户显式选择 real-browser。

```bash
node "${SKILL_DIR}/scripts/check-deps.mjs" --ensure-cdp --sid "$SID" --agent main
node "${SKILL_DIR}/scripts/sleuth-browser.mjs" open-login --url "<login-url>"
```

CDP 连接成功不等于站点登录成功。Profile 存在、cookie 存在、session 名存在，也不等于登录成功。只有页面级验证才算数。

---

## 5. Session 与输出规则

简短回答：直接内联，不创建 session，不写文件。

复杂问题必须创建 session，包括：多源调研、竞品分析、需要浏览器、需要子 Agent、需要长文档、需要复核证据、需要保存截图/页面/数据/报告。

创建 session 的推荐入口是 `check-deps`，而不是单独手写目录：

```bash
SID=$(node "${SKILL_DIR}/scripts/check-deps.mjs" --query "<用户原始问题>" --agent main --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).session_id||""))')
SLEUTH_OUTPUT=$(node "${SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid "$SID" --agent main)
```

输出目录必须严格按 session 和 agent 分层：

```text
~/.sleuth/output/YYYY-MM-DD/<session-id>/
  main/
    docs/
    pages/
    data/
    screenshots/
    images/
    transcripts/
  agents/
    <agent-name>/
      docs/
      pages/
      data/
      screenshots/
```

主 Agent 用 `--agent main`。子 Agent 用稳定名字，例如 `pricing`、`reviews`、`docs`、`risk`。

保存材料统一用 `deliver.mjs`：

```bash
node "${SKILL_DIR}/scripts/deliver.mjs" --action save --sid "$SID" --agent main --type doc --source report.md --name final-report --final
```

长文档/最终报告必须同时存在两份：

1. session output 中的归档版本；
2. 用户当前执行目录 cwd 下的可见版本。

`--final` 用于把文档复制到 cwd。不要把最终长文档只放在 `~/.sleuth/output`。

复杂问题即使交付长文档，也必须在聊天里内联给出：

- 3-7 条核心结论；
- 关键证据与不确定性；
- 最终文件路径。

---

## 6. 子 Agent 规则

只有角度真正独立时才派子 Agent。不要为了显得完整而拆。

适合拆：官方事实、价格、用户反馈、负面风险、技术文档、案例、政策合规、社区声音。  
不适合拆：主问题尚未定义清楚、只是重复搜索同一角度、每路都只能复读搜索结果。

子 Agent 必须读取 `SUBAGENT.md`，并使用独立输出目录：

```bash
node "${SKILL_DIR}/scripts/check-deps.mjs" --sid "$SID" --agent reviews --output-dir
```

子 Agent 返回给主 Agent 的内容必须包含：findings、sources、gaps、red_flags、trust_notes、artifacts。

---

## 7. 交付标准

快速验证：内联答案 + 可追溯来源。  
定向研究：内联结构化结论 + 证据/缺口。  
深度研究：内联摘要 + cwd 中的最终长文档 + session 归档。

最终回答不要只说“已保存”。必须给用户可直接使用的判断。

如果信息不足，输出最小可用结论和下一步验证清单，不要编完整答案。

---

## 8. 禁止事项

- 不把搜索摘要、SEO 软文、二手转载当一手事实。
- 不绕过付费墙、CAPTCHA 或权限控制。
- 不提取 cookie、密码、token 或敏感凭据。
- 不对敏感页面截图。
- 不执行会产生记录的状态变更，除非用户明确要求。
- 不在同一路径无信息增量地重复搜索。
- 不让工具替你判断；工具只提供证据入口。
