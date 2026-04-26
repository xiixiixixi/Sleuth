# wa — 浏览器操作 CLI

基于 web-access CDP Proxy 的命令行浏览器自动化工具，集成 Actionbook selector 查询和 Chrome 本地资源检索。

## 为什么做这个

web-access 目前的调用链是：

```
Agent → 读 SKILL.md → 拼 curl 命令 → 调 cdp-proxy HTTP API → Chrome CDP
```

Agent 要自己拼 curl、自己管理 targetId、自己写 JS 表达式。这不是"调用工具"，这是让 Agent 当 HTTP 客户端。

包装成 CLI 后：

```
Agent → 一条 bash 命令 → Chrome CDP
```

## 核心决策

- **B 路线**：在 web-access 现有 cdp-proxy.mjs 之上加一层轻量 CLI，不做大重写，不 fork chrome-devtools-mcp
- **默认连用户日常 Chrome**（有登录态、有书签历史），不是 headless 隔离浏览器
- **复用 cdp-proxy.mjs**（600 行已稳定），不重写
- **Actionbook selector 查询直接调 API**，本地 JSON 缓存降配额消耗
- **不做 MCP 协议兼容**——CLI 是给 Agent bash 调用的，不需要 MCP

不做的事情：

| 不做 | 原因 |
|------|------|
| 不 fork chrome-devtools-mcp | 它默认 headless 隔离，核心需求是用户 Chrome 登录态 |
| 不自己建 selector 数据库 | Actionbook 核心资产是云端数据，复制不了 |
| 不做 MCP 协议兼容 | CLI 给 Agent bash 调用，不需要 MCP |
| 不改 cdp-proxy.mjs | 已稳定，直接复用 |

## 架构

```
Agent (bash 调用)
    |
    v
+------------------+
|  wa CLI (bin/wa)  |  <-- 命令行入口，解析参数
|  - 参数校验       |
|  - 输出格式化     |
|  - 自动启动 proxy |
+--------+---------+
         | localhost:3456 (复用现有 cdp-proxy)
         v
+------------------------------+
|  cdp-proxy.mjs (已有)        |  <-- 不改，复用
|  - WebSocket -> Chrome CDP   |
|  - 反端口探测 guard          |
|  - 后台 tab 管理             |
+------------------------------+

额外模块（新写）：
+------------------+  +------------------+  +------------------+
| find-url 模块     |  | actionbook 模块   |  | site-pattern 模块 |
| Chrome 书签/历史  |  | selector API 查询 |  | 站点经验读写      |
| (复用 find-url.mjs)|  | + 本地 JSON 缓存  |  | (复用 match-site) |
+------------------+  +------------------+  +------------------+
```

## 命令设计

### 浏览器操作（透传 cdp-proxy）

| 命令 | 说明 | 对应 HTTP |
|------|------|-----------|
| `wa status` | 检查 proxy + Chrome 状态 | `GET /health` + `GET /targets` |
| `wa open <url>` | 打开新后台 tab，返回 tabId | `GET /new?url=` |
| `wa close <tabId>` | 关闭 tab | `GET /close?target=` |
| `wa goto <tabId> <url>` | 导航到 URL | `GET /navigate?target=&url=` |
| `wa back <tabId>` | 后退 | `GET /back?target=` |
| `wa eval <tabId> '<js>'` | 执行 JS | `POST /eval?target=` |
| `wa click <tabId> '<selector>'` | JS 点击 | `POST /click?target=` |
| `wa click-at <tabId> '<selector>'` | 真实鼠标点击 | `POST /clickAt?target=` |
| `wa scroll <tabId> [--y=3000] [--dir=down]` | 滚动 | `GET /scroll?target=&y=&direction=` |
| `wa screenshot <tabId> [-o file.png]` | 截图 | `GET /screenshot?target=&file=` |
| `wa info <tabId>` | 页面标题/URL/状态 | `GET /info?target=` |
| `wa upload <tabId> '<selector>' <file...>` | 文件上传 | `POST /setFiles?target=` |
| `wa tabs` | 列出所有 tab | `GET /targets` |

### Chrome 本地资源

| 命令 | 说明 |
|------|------|
| `wa find-url [关键词...] [--only bookmarks\|history] [--since 7d] [--sort visits]` | 搜索书签/历史 |
| `wa site <域名或关键词>` | 查看站点经验 |

### Actionbook 集成

| 命令 | 说明 |
|------|------|
| `wa action search <关键词> [--domain airbnb.com]` | 搜索站点操作手册 |
| `wa action get <area_id>` | 获取完整操作详情（含 selector） |
| `wa action sources [--query 旅游]` | 列出/搜索已知站点 |

### 输出格式

```bash
# 默认人类可读
wa tabs
# tab-1  https://twitter.com  "Home / X"  (active)

# --json 给 Agent 用
wa tabs --json
# [{"targetId":"abc","url":"https://twitter.com","title":"Home / X"}]
```

## Actionbook 缓存策略

```
~/.cache/wa/actionbook/
  search:关键词:domain=xxx.json    # TTL 1天
  area:airbnb.com:/:default.json   # TTL 7天
  sources.json                     # TTL 1天
```

- 首次查询调 api.actionbook.dev
- 结果写入本地 JSON 文件（带 TTL）
- 命中缓存直接返回，不耗 API 配额
- 后续如果量大再升级 SQLite

## 文件结构

```
wa-cli/
  bin/
    wa.mjs                 # CLI 入口（~100行）
  src/
    commands/
      browser.mjs          # open/close/goto/eval/click/scroll/screenshot/info/tabs
      find-url.mjs         # 书签/历史搜索（复用 find-url.mjs 逻辑）
      actionbook.mjs       # action search/get/sources + 缓存
      site-pattern.mjs     # 站点经验读写（复用 match-site.mjs 逻辑）
    cdp-proxy.mjs          # 直接从 web-access 复制，不改
    check-deps.mjs         # 直接从 web-access 复制，不改
    cache.mjs              # JSON 缓存读写 + TTL 管理
  package.json
  README.md
```

## 实现优先级

| 阶段 | 内容 | 预估 |
|------|------|------|
| **P0 — MVP** | CLI 入口 + 浏览器命令（透传 cdp-proxy）+ `wa find-url` | 4-6h |
| **P1** | `wa action search/get/sources` + JSON 缓存 | 2-3h |
| **P2** | `wa site` 站点经验 + 操作后自动写入 | 1-2h |
| **P3（可选）** | `--isolated` 模式（headless 独立浏览器）、Performance/Lighthouse | 后续 |

## 依赖来源

| 组件 | 来源 | 说明 |
|------|------|------|
| cdp-proxy.mjs | web-access skill (`~/.agents/skills/web-access/scripts/`) | 复制，不改 |
| check-deps.mjs | web-access skill | 复制，不改 |
| find-url 逻辑 | web-access skill | 复用书签/历史搜索 |
| match-site 逻辑 | web-access skill | 复用站点经验匹配 |
| Actionbook API | `api.actionbook.dev` | 直接调 REST API |
| Chrome DevTools MCP | 不依赖 | 仅作为参考架构 |
