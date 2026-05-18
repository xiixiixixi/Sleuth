---
name: sleuth
description: >-
  联网研究与网页验证 skill。用于查资料、搜东西、调研、验证来源、看网页、站内搜索、登录后内容、动态页面、深度研究。
  目标不是替代所有工具，而是帮助 Agent 判断该用什么工具、证据是否足够、何时升级到浏览器、何时停止。
---

# sleuth — 搜索判断与浏览器验证合同

```bash
# 自动探测 skill 根目录，兼容 Claude Code / OpenCode / 手动安装
if [ -n "${CLAUDE_SKILL_DIR}" ]; then
  SKILL_DIR="${CLAUDE_SKILL_DIR}"
elif [ -n "${SKILL_DIR}" ]; then
  :
else
  SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi
```

## 核心定位

Sleuth 是研究判断层，不是大而全爬虫。

- 负责：目标定义、工具边界识别、来源拓扑、证据要求、浏览器升级判断、停止条件、交付约定。
- 不负责：替代所有搜索工具、维护大型站点 selector 库、把浏览器变成默认入口、绕过权限或付费墙。
- agent-browser 是浏览器执行层；Sleuth 只判断何时应该使用它。

## 必读参考

执行联网任务时，根据任务复杂度读取：

- `references/decision-kernel.md`：搜索决策问题，不是 intent-router。
- `references/tool-boundary.md`：运行时工具盘点与证据边界。
- `references/search-guide.md`：目标、来源拓扑、观察、怀疑、换路、证据、停止。
- `references/tool-guide.md`：agent-browser 使用姿势。
- `references/subagent-guide.md`：深度研究中的子 Agent 合同。
- `references/content-extraction.md`：视频、PDF、图片、字幕等特殊内容提取。

## 每次任务前先做的判断

收到联网、调研、验证、查找、页面分析任务时，先在心智上完成三件事：

```text
1. 用户真正要解决什么问题？什么证据足够停止？
2. 当前有哪些可用工具？每个工具能发现什么、验证什么、看不到什么？
3. 哪些结论必须回到原始来源？哪些内容只能算线索？
```

不要先套关键词，不要先默认开浏览器，不要把搜索摘要当事实。

## 工具边界原则

先识别当前运行环境里的可用工具，再选路径。工具族通常包括：

- 搜索发现类：发现候选来源、别名、关键词地图；不能单独支撑核心结论。
- 页面读取类：快速读取公开静态正文；不能保证动态内容、登录态和页面真实状态。
- 浏览器执行类：验证真实页面、登录态、站内搜索、动态渲染、交互和筛选排序；成本高，默认只读。
- 专用连接器：GitHub、文件、邮件、日历、数据库等；结构化资源优先使用专用工具。
- 私有入口和用户材料：截图、录屏、导出、访谈、内部文档；是高价值原料，但仍需整理和标注边界。

详细规则见 `references/tool-boundary.md`。

## 浏览器升级条件

浏览器是最高保真验证层，不是默认入口。

以下情况应升级到 agent-browser / CDP：

- 页面内容依赖登录态、JS 渲染、滚动、展开、筛选、排序或交互。
- 用户问的是某平台内、后台内、社区内、站内搜索结果。
- WebFetch / reader 返回空壳、导航、登录提示、过短内容或明显失真。
- 搜索结果只有摘要、镜像、转载，缺原始页面。
- 页面真实状态、布局、图表、弹窗、按钮、价格表或可见性本身就是证据。

公开、静态、权威页面能可靠读取时，不必使用浏览器。

## 浏览器连接

Sleuth 默认使用 managed browser：独立 Chrome profile，路径为 `~/.sleuth/cdp-profile/`，不触碰用户日常 Chrome。

```bash
node "${SKILL_DIR}/scripts/check-deps.mjs" --ensure-cdp
# 输出 SLEUTH_CDP_PORT=<port>
```

所有 agent-browser 命令都应带：

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session <session-name> ...
```

首次需要登录态时，让用户在 managed browser 中手动登录：

```bash
node "${SKILL_DIR}/scripts/sleuth-browser.mjs" open-login
```

## 登录态原则

CDP 连接成功不等于站点登录成功。profile 存在、cookie 存在、session 名存在，也不等于登录成功。

只有页面级验证才算数：

- 打开目标站点登录后页面。
- 检查 DOM 中账号菜单、头像、profile、dashboard 等标志。
- 如有 site-specific selector，可作为辅助信号。
- 自动判断不可靠时，标为 unknown，不伪装成 verified。

## 站点搜索与 site-patterns

站点原生搜索在以下场景有价值：平台内、社区内、论坛内、商城内、仪表板内、登录态差异、筛选排序本身是证据。

但 site-patterns 只是经验缓存，不是核心路线，也不应发展成大型 selector 数据库。

可选使用：

```bash
node "${SKILL_DIR}/scripts/match-site.mjs" "<domain>"
node "${SKILL_DIR}/scripts/route-task.mjs" --query "<query>" --domain "<domain>"
```

`route-task.mjs` 的结果只作参考，不强制跟随。最终仍由 Agent 根据 `decision-kernel.md` 判断。

## 研究目标与证据记录

关键结论必须能落到：

```text
Claim → Evidence → Source → Time → Confidence → Conflict
```

至少区分：

- 已验证事实
- 来源观点
- 高置信推断
- 未确认线索
- 冲突信息
- 覆盖缺口
- 行动建议

Tier 3 线索，例如搜索摘要、SEO 文、未署名转载、单条评论，不得单独支撑核心结论。

## 响应层级

从轻到重，证据不足再升级：

| 层级 | 适用场景 | 常见做法 |
|---|---|---|
| 直答 | 稳定常识、无需当前事实 | 直接回答 |
| 快速验证 | 一两个权威来源可确认 | 搜索/reader/专用工具 + 原始来源 |
| 定向研究 | 需要多步查证但问题集中 | 多来源验证，必要时浏览器 |
| 深度研究 | 多源冲突、范围大、用户要交付物 | session、子 Agent、证据账本、最终报告 |

## 深度研究

开始时建立 session：

```bash
SID=$(node "${SKILL_DIR}/scripts/session-logger.mjs" --action start --query "问题" --type research)
SLEUTH_OUTPUT=$(node "${SKILL_DIR}/scripts/check-deps.mjs" --output-dir --sid "$SID")
```

深度研究原则：

- 先写目标、enough 条件、关键子问题。
- 独立角度才派子 Agent，避免重复搜索。
- 给子 Agent 合同：goal / enough_when / must_verify / known_clues / browser_session / output_shape。
- 昂贵或难复现发现及时 `deliver save`。
- 证据稳定就写报告；关键结论脆弱时再补查或独立审查。

子 Agent 先读 `references/subagent-guide.md`。

## 交付约定

- 快速验证 / 定向研究：内联回复 + 可追溯来源。
- 深度研究：默认交付一份最终报告，同时内联简要结论。
- 用户指定格式、路径、文件名时，按用户要求。

中间材料可保存：

```bash
node "${SKILL_DIR}/scripts/deliver.mjs" --action save \
  --type <doc|screenshot|image|transcript|data|page> \
  --source <source> --name <name> --url <URL> --sid "$SID"
```

`deliver merge` 只合并中间 Markdown，方便阅读整理；不是最终报告生成器。

## 运行边界

- 不提取 cookie、密码、token 或敏感凭据。
- 不绕过付费墙、CAPTCHA 或权限控制。
- 不对敏感页面截图。
- 不执行会产生记录的状态变更操作，除非用户明确要求。
- 不把搜索摘要、二手搬运、SEO 软文包装成一手事实。
- 同一路径失败且没有新信息时，不盲目重试；换工具或换来源。
- 工具无法访问的封闭渠道，要求用户提供截图、导出、录屏、链接或登录态。

## 收尾

研究完成后：

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action finish --sid "$SID" --outcome success|partial|fail
node "${SKILL_DIR}/scripts/update-site-stats.mjs" --sid "$SID"   # 可选
node "${SKILL_DIR}/scripts/cleanup-output.mjs"                   # 可选
```

如果浏览器由 Sleuth 启动且需要关闭：

```bash
node "${SKILL_DIR}/scripts/on-stop.mjs" --sid "$SID"
```
