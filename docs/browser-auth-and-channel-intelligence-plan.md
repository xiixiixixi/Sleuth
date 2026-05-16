# Sleuth 浏览器登录态与渠道情报方案

## 当前判断

这个工程已经偏大。

原因不是目标本身复杂，而是当前实现同时推进了太多层：

- 托管浏览器生命周期。
- 登录态验证。
- 真实浏览器 bridge。
- 站内搜索 schema。
- route-task 路由。
- read-only guard。
- site-pattern 扩展。
- 多阶段测试。

这些方向都有价值，但不能同时作为第一版验收标准。第一版只应该解决一个核心闭环：

**Sleuth 能稳定启动或复用一个独立、持久、可调试的 Chrome，并且不杀、不复制、不接管用户日常 Chrome。**

只有这个闭环稳定后，登录态引导、站内搜索、真实浏览器 bridge 才值得继续做。

## 最小合格标准

Phase 1 合格只看以下事情：

1. `check-deps.mjs` 作为 CLI 入口稳定运行，不依赖 `process.argv[1]` 路径比较来决定是否执行主流程。
2. 默认路径不关闭、不重启、不 kill 用户日常 Chrome。
3. 默认路径不复制、不软链用户日常 Chrome profile。
4. 使用 `~/.sleuth/cdp-profile` 作为 Sleuth 专用持久 profile。
5. CDP 检测必须请求 `/json/version`，并确认返回 JSON 且包含 `webSocketDebuggerUrl`。
6. 如果已有 managed browser 在运行，能识别并复用它。
7. 如果没有 managed browser，能自动启动它。
8. 输出可被下游命令使用的端口：

```json
{
  "browser_mode": "managed",
  "cdp_port": 9223,
  "profile_dir": "/Users/<user>/.sleuth/cdp-profile",
  "auth_state": "unknown"
}
```

9. 后续 agent-browser 命令统一使用：

```bash
agent-browser --cdp "$SLEUTH_CDP_PORT" --session "$SID-main" open "$URL"
```

第一版不要求：

- real-browser bridge。
- 站内搜索 schema。
- auth verifier 框架。
- read-only JS guard。
- route-task 强制首动作。
- site-pattern 自动推断搜索策略。

这些都可以后置。

## 当前未完成事项

当前工程还没有完全达到本方案标准。优先修这些：

### P0：修复 managed browser 识别

现在已经出现过这种状态：

- Chrome 进程实际使用 `~/.sleuth/cdp-profile` 启动。
- CDP 端口实际可用。
- 但 `sleuth-browser status` 返回 `ready:false`。
- `check-deps --ensure-cdp --json` 返回 `browser_mode:"unavailable"`。

这说明 managed browser 的识别逻辑不可靠。

修法：

- `cdp-state.json` 只能记录 managed browser，不要混入 real-browser 状态。
- 判断 managed browser 时不能只信 state 文件。
- 应同时使用：
  - `cdp-state.json` 中的端口。
  - `~/.sleuth/cdp-profile/DevToolsActivePort`。
  - 常见候选端口的 `/json/version`。
  - 本机 Chrome 进程参数中是否包含 `--user-data-dir=<~/.sleuth/cdp-profile>`。
- 如果某个有效 CDP endpoint 对应的 Chrome 进程参数包含 `cdp-profile`，就应判定为 managed。

验收：

```bash
node scripts/sleuth-browser.mjs status
```

在 managed browser 已运行时必须返回：

```json
{
  "ready": true,
  "port": 9223,
  "profile_dir": "/Users/<user>/.sleuth/cdp-profile"
}
```

```bash
node scripts/check-deps.mjs --ensure-cdp --json
```

必须返回：

```json
{
  "browser_mode": "managed",
  "cdp_port": 9223,
  "profile_dir": "/Users/<user>/.sleuth/cdp-profile",
  "auth_state": "unknown"
}
```

### P1：隔离 real-browser 状态

real-browser 是高权限路径，不能污染 managed browser 状态。

修法：

- 不要让 real-browser 写 `~/.sleuth/cdp-state.json`。
- 如果必须记录，使用单独文件：

```text
~/.sleuth/real-browser-state.json
```

或者在一个 state 文件里使用清晰 namespace：

```json
{
  "managed": {
    "pid": 123,
    "port": 9223,
    "profile_dir": "/Users/<user>/.sleuth/cdp-profile"
  },
  "real_browser": {
    "port": 9222,
    "domains_allowed": ["example.com"],
    "read_only": true
  }
}
```

但第一版建议直接禁用 real-browser 写 state。

### P1：简化登录引导

第一版不需要完整 auth verifier 框架。

只需要在打开目标 URL 后，如果页面明显是登录页或用户声明需要登录，输出通用引导：

```text
Sleuth 已打开专用浏览器窗口。

请在这个窗口中登录 <domain>。
不要把密码、2FA 验证码、cookie 或 token 粘贴到终端。
登录完成后回到终端按 Enter。
输入 skip 可跳过登录，继续采集公开内容。
```

按 Enter 后重新打开或刷新目标 URL。然后做低风险判断：

- 当前 URL 是否仍是登录页。
- 页面是否仍出现明显登录提示。
- 页面是否出现账号菜单、头像、dashboard、发布/创建入口等登录后元素。

结果只输出：

```json
{
  "domain": "example.com",
  "auth_state": "verified | not_verified | skipped | unknown",
  "signals": ["not_login_url", "account_menu_present"],
  "sensitive_values_printed": false
}
```

不要输出用户名、邮箱、cookie、token、账号 ID。

### P2：暂缓 route-task 强制首动作

当前 `SKILL.md` 要求每次联网任务先跑 `route-task.mjs`，但 `route-task.mjs` 需要 `--domain`。很多任务一开始并没有 domain。

第一版建议：

- 不把 `route-task` 作为强制 first action。
- 先把它降级成可选辅助工具。
- 等它支持“只有 query，没有 domain”的开放网络路由后，再考虑提升为强制动作。

### P2：暂缓站内搜索 schema

站内搜索是有价值的，但不应挡住浏览器基线。

第一版只需要写原则：

- 用户明确问某个平台/某个站内内容时，优先考虑站内搜索。
- 搜索结果卡片只是线索，不是最终证据。
- 最终结论必须回到打开后的原始页面。

不要急着实现：

- search schema。
- bounded infinite scroll。
- result extractor。
- provenance schema。

这些可以等 managed browser 稳定后再做。

## 浏览器状态模型

登录态只有两条合法路径。

### 模式 A：Sleuth 托管浏览器

这是默认路径。

适用场景：

- 任务可以在一个专用浏览器身份里完成。
- 用户可以在这个浏览器里登录目标网站。
- 不需要用户日常 Chrome 的现有标签页、扩展、SSO 设备信任或个人上下文。
- 需要一个安全默认方案：不杀、不改、不接管用户日常 Chrome。

实现方式：

- 启动一个专用 Chrome 实例，使用持久 profile：
  - user data dir：`~/.sleuth/cdp-profile`
  - CDP 地址：`127.0.0.1`
  - 端口：动态选择；可以优先尝试 `9222`，但不能假设一定是 `9222`。
- 默认永远不复制用户日常 Chrome profile。
- 默认永远不软链用户日常 Chrome profile。
- 默认永远不关闭或重启用户日常 Chrome。

“登录一次”的含义：

- 用户在 Sleuth 专用浏览器窗口里登录目标网站一次。
- 不是登录 Chrome Sync。
- 这个网站登录态保存在 `~/.sleuth/cdp-profile`。
- 下次再用同一个 profile 启动，通常可以复用登录态，直到网站 session 过期或用户登出。

### 模式 B：真实浏览器桥接

这是后置能力，不属于第一版基线。

适用场景：

- 用户明确要求复用日常 Chrome 的现有登录态。
- 任务依赖现有标签页、已安装扩展、SSO 上下文、设备信任或其他很难在托管 profile 里重建的状态。
- 用户显式同意让 agent 操作真实浏览器。

可能实现：

- 浏览器扩展桥接，类似 Actionbook / Playwright MCP extension mode。
- Chrome 版本支持时，使用显式远程调试授权流程。
- 用户主动提供真实浏览器 CDP endpoint。

安全要求：

- 必须显式 opt-in。
- 默认只读。
- 尽量限制域名或标签页范围。
- 使用前必须提示风险。
- 不要让它污染 managed browser 状态。

## 为什么不复制或软链日常 Chrome Profile

复制和软链都不应该作为默认认证方案。

原因：

- Chrome 136+ 对默认 user data directory 上的远程调试做了限制。
- 正在运行的 Chrome profile 不是一组稳定静态文件。Cookies、History、IndexedDB 和其他存储可能涉及 SQLite WAL、文件锁、内存态和站点特定存储。
- 复制可能拿到过期或不完整状态。
- 复制出来的登录态可能仍然无效，因为网站可能依赖设备状态、最近安全验证、本地存储、service worker 或风控信号。
- 软链到同一个 profile 不能绕开单 profile 归属问题。两个 Chrome 进程不应该同时把同一个 user data dir 当作可写状态使用。
- 用户继续使用日常 Chrome 后，复制出来的 profile 会立刻与真实状态分叉。

窄例外：

- 未来可以做显式 migration，把书签和非敏感偏好迁移到 `~/.sleuth/cdp-profile`。
- 默认不能复制 cookies、密码库或登录数据库。
- 必须标明这是“迁移”，不是“认证”。

## CDP 检测与启动

CDP 检测必须验证协议，而不能只检测 TCP 端口。

有效 CDP endpoint：

- `http://127.0.0.1:<port>/json/version` 返回 HTTP 200。
- 响应是 JSON。
- 响应包含 `webSocketDebuggerUrl`。

无效 endpoint：

- 端口在监听，但 `/json/version` 返回 404。
- 端口在监听，但响应为空。
- 端口被非 CDP 服务占用。
- CDP WebSocket 握手超时。

端口选择：

- 优先尝试 `9222`、`9223`、`9333`。
- 每个候选端口都必须通过协议验证。
- 如果没有有效 endpoint，选择一个空闲端口启动 managed browser。
- 下游只使用实际检测到的端口。

命令模式：

```bash
agent-browser --cdp "$SLEUTH_CDP_PORT" --session "$SID-main" open "$URL"
```

不要默认依赖 `--auto-connect`。

## 默认浏览器流程

1. 检查 `agent-browser`。
2. 查找 managed browser：
   - state 文件。
   - `DevToolsActivePort`。
   - 有效 CDP endpoint。
   - 进程参数中的 `--user-data-dir=~/.sleuth/cdp-profile`。
3. 找到就复用。
4. 找不到就启动 managed browser。
5. 验证 `/json/version`。
6. 输出 `SLEUTH_CDP_PORT=<port>` 或 JSON。
7. 后续所有浏览器操作都使用 `--cdp "$SLEUTH_CDP_PORT"`。

## 站内搜索原则

站内搜索是后置增强，但原则先定下来。

使用站内搜索的情况：

- 内容位于某个平台、应用、论坛、文档站、商城、dashboard 或认证渠道内部。
- 搜索结果会因登录态、地区、账号、组织或权限不同而不同。
- 站点自带筛选器或排序信号本身就是证据的一部分。
- 用户问的是某个平台“上”的内容，或某个指定来源内部的内容。
- 公开搜索结果主要是摘要、过期镜像、SEO 页或二手转载。

使用公开搜索的情况：

- 任务是跨开放网络发现来源。
- 权威来源未知。
- 目标站点没有可用搜索。
- 需要外部佐证。
- 目标内容是公开静态文档，搜索引擎是最快索引。

搜索结果只作为线索。最终结论应该回到打开后的原始页面或浏览器内采集的证据。

## 操作安全

默认只读。

以下行为需要用户明确确认：

- 发布。
- 回复。
- 点赞。
- 关注。
- 订阅。
- 购买。
- 预约。
- 发送消息。
- 修改设置。
- 删除。
- 上传。
- 提交表单。
- 任何可能通知他人或改变账号状态的操作。

不要向用户索要：

- 终端里的密码。
- 终端里的 2FA 验证码。
- Cookie 导出。
- Token。

用户只应在可见浏览器窗口或可信的一方登录流程里输入凭据。

## 推荐实施顺序

### Step 1：收缩到 managed browser 基线

保留：

- `scripts/check-deps.mjs`
- `scripts/lib/check-deps-core.mjs`
- `scripts/sleuth-browser.mjs`
- `references/tool-guide.md` 中的 `--cdp $SLEUTH_CDP_PORT` 示例

暂缓或禁用：

- `--real-browser` 写 state。
- route-task 强制 first action。
- site-search 自动执行。
- auth verifier 复杂框架。

目标：

- `check-deps --ensure-cdp --json` 稳定返回 managed。
- `sleuth-browser status` 能识别正在运行的 managed browser。
- 不碰用户日常 Chrome。

### Step 2：加最小登录引导

添加：

- `--login-url <url>` 打开目标 URL。
- 通用登录提示。
- Enter/skip 流程。
- 低敏 auth_state 输出。

不做：

- 平台硬编码列表。
- 复杂站点 verifier。
- cookie/token 读取。

### Step 3：恢复站内搜索能力

前提：Step 1 和 Step 2 稳定。

再做：

- site-pattern search schema。
- 结果提取。
- 有界滚动。
- provenance 元数据。

### Step 4：评估 real-browser bridge

前提：用户确实需要复用日常 Chrome 登录态。

再评估：

- extension bridge。
- Chrome 显式授权。
- 用户提供 CDP endpoint。

不要把 real-browser bridge 作为默认路径。

## 外部参考

- Actionbook Browser Modes：默认隔离 profile，以及用于已有 session 的 extension bridge。
  https://actionbook.dev/docs/guides/browser
- Playwright MCP browser extension：复用 existing tabs、logged-in sessions、cookies、extensions。
  https://playwright.dev/mcp/configuration/browser-extension
- Playwright MCP profile/state behavior。
  https://playwright.dev/mcp/configuration/user-profile
- Chrome DevTools MCP：专用 profile 和远程调试授权。
  https://github.com/ChromeDevTools/chrome-devtools-mcp
- Chrome 对默认 user data directory 远程调试的限制。
  https://developer.chrome.com/blog/remote-debugging-port
- Chromium user data directory 说明，包括 profile sharing 限制。
  https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md
