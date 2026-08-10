# Chrome 授权直连设计

> 状态：2026-08-10 用户已批准方案 A；本文等待书面规格复核后进入实施。

## 现场结论

Sleuth 当前要求所有 `agent-browser` 命令只传已核验的 CDP 端口，例如 `--cdp 9222`。这个约束能防止 Agent 猜浏览器，却在 Chrome 144+ 的授权模式中触发了新的兼容问题。

本机安装的 `agent-browser` 0.33.2 是 npm 当天最新版。它的[官方 0.33.2 源代码](https://github.com/vercel-labs/agent-browser/blob/v0.33.2/cli/src/native/cdp/discovery.rs)把端口发现等待固定为 2 秒；Chrome 144+ 则要求用户在浏览器中确认首次调试连接。[上游修复请求](https://github.com/vercel-labs/agent-browser/pull/1119)计划把等待延长，但截至 2026-08-10 仍未合并。Chrome 官方也说明，连接现有登录态浏览器时会显示授权框，并要求用户点击 Allow（允许）：[Chrome DevTools 配置说明](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)。

真实测试结果与源码一致：

- 使用 `agent-browser --cdp 9222 ...` 时，多次约 2.08 秒后超时；后台进程存在，但 9222 没有已建立连接。
- 使用 full 检查从日常 Chrome 默认目录读取并核验的完整 `ws://127.0.0.1:<port>/devtools/browser/<id>` 地址后，命令持续等待授权；用户点击“允许”后约 6.64 秒成功读取原有 Google 标签页标题。
- 随后的 `get url` 和 `tab list` 共约 0.11 秒完成，复用同一个默认后台进程，没有再次等待授权。
- 最终只有一个 `default.sock`、一个 `agent-browser` 后台进程和一条 9222 已建立连接；没有 Chrome for Testing、Chrome Dev、Chromium、命名会话或其他常驻 CDP 代理。

因此，“只传端口”不能再作为 Chrome 144+ 授权模式的执行路径。完整调试地址不是另一个浏览器，也不是新用户目录；它是当前日常 Chrome 自己写入默认目录 `DevToolsActivePort` 的本机连接地址。

## 目标与不可变边界

1. 轻量网络工具失败后，仍然及时升级到用户当前使用、已经登录的 Chrome，不固定等待。
2. full 检查必须先核对监听进程的真实可执行文件和默认用户目录；只有 `browser_identity: verified-user-chrome` 才能生成浏览器任务。
3. Chrome 授权模式的所有命令必须使用本次 full 检查输出的完整 `SLEUTH_CDP_WS`，不能把端口重新交给 `agent-browser` 做 2 秒发现。
4. `SLEUTH_CDP_WS` 只允许 `ws://127.0.0.1:<port>/devtools/browser/<id>`；地址端口必须和同次检查输出的 `SLEUTH_CDP_PORT` 一致。
5. Chrome 重启后 WebSocket（网页套接字）地址会变化。每次新的浏览器使用权分配前必须重新运行 full 检查，旧地址绝不复用。
6. 所有命令继续复用默认后台进程并显式带 `--idle-timeout 1h`；禁止 `--session`、`--namespace`、`--profile`、`agent-browser install` 和其他常驻 CDP 代理。
7. 任务结束只关闭本任务明确新建的标签页，不关闭 Chrome，不使用 `agent-browser close` 或 `close --all`。
8. 不把授权框永久消失作为承诺。新的 Chrome 或新的控制连接第一次仍可能确认一次；同一连接中的后续命令不得重复弹框。

## 数据流

1. 主 Agent 运行 `node scripts/check-deps.mjs --mode full --json`。
2. 检查器从用户日常 Chrome 默认目录读取 `DevToolsActivePort`，核对端口所有者后输出匹配的 `cdp_port` 和 `cdp_ws`。
3. 主 Agent 只在身份为 `verified-user-chrome` 时，把同一结果中的两个值分别注入 `SLEUTH_CDP_PORT` 和 `SLEUTH_CDP_WS`。
4. `scripts/spawn-subagent.mjs` 严格校验：协议、主机、端口和路径都合格，且两个端口相同，才生成搜索提示。
5. 搜索提示使用同一个固定前缀：

```bash
agent-browser --cdp 'ws://127.0.0.1:<port>/devtools/browser/<id>' --idle-timeout 1h <command>
```

6. 搜索 Agent 不重新发现端口，不使用 `--auto-connect`，也不把完整地址改回端口。
7. 如果地址失效或 Chrome 已重启，Agent 保留 raw、不写 `agent_done`，返回 `BROWSER_CONTROL_REQUIRED`；主 Agent 重新运行 full 检查并生成新提示。

## 接口变化

### `check-deps.mjs`

保留现有 `cdp_port`、`cdp_ws`、`browser_identity` 输出。文档和主流程明确：`cdp_port` 用于身份比对与诊断，`cdp_ws` 才是 Chrome 144+ 授权模式交给 `agent-browser` 的执行目标。

### `spawn-subagent.mjs`

- 搜索角色有浏览器使用权时必须同时收到 `SLEUTH_CDP_PORT` 和 `SLEUTH_CDP_WS`。
- 缺少任一值、地址不是本机回环地址、路径不是浏览器级 DevTools 路径，或两个端口不一致时，生成器必须非零退出。
- 生成后的提示必须内联经过校验的完整地址；不能要求子 Agent 依赖运行时环境变量。
- 没有浏览器使用权时继续生成 `BROWSER_CONTROL_REQUIRED` 交接规则，不自行启动浏览器。

### 文档规则

`SKILL.md`、`references/search.md`、`references/tool-guide.md`、`README.md`、`AGENTS.md`、`CLAUDE.md` 和 docs 当前文档统一使用“已核验完整地址”规则。旧的 `<port>` 命令只保留在有明确日期和失败结果的历史证据中，不能再作为当前可执行示例。

## 错误处理

- 端口模式约 2 秒超时：同一目标不再重试，立即改用同次 full 检查输出的完整地址。
- 完整地址等待授权：清楚提示用户在 Chrome 点击“允许”；一次等待期间不并发建立第二条连接。
- 完整地址失效：视为 Chrome 已重启或控制已关闭，停止浏览器操作并重新 full 检查；禁止猜新的端口或路径。
- 后续命令再次弹框或超时：检查是否出现新的后台进程、命名 socket 或其他 9222 客户端；不靠循环重试掩盖问题。

## 测试设计

必须先增加会失败的自动测试，再修改实现：

1. `spawn-subagent.test.mjs`：完整本机地址和匹配端口生成可直接复制的固定前缀。
2. `spawn-subagent.test.mjs`：只有端口、只有地址、远程地址、错误路径和端口不一致全部拒绝。
3. `references-structure.test.mjs`：当前规则统一要求 `SLEUTH_CDP_WS`；端口只用于同次身份比对，不能作为当前执行前缀。
4. 全量自动测试、Node/Bash 语法、文档检查和 `git diff --check` 全部通过。
5. 按 `docs/TESTING.md` 重新审计“神逻辑”真实任务，证明研究链路没有回归。
6. 真实 Chrome 验收必须记录：第一次完整地址连接经一次允许后成功；连续两条命令不再等待；一个默认后台进程、一个 socket、一条 9222 连接、零测试浏览器、零其他常驻代理。

## 不采用的方案

- 不继续要求用户在约 2 秒内点完授权；这不是可靠交互。
- 不循环重试端口连接；每次都是新的失败连接，可能制造更多授权框。
- 不安装未合并的 `agent-browser` 分支或自行替换全局二进制。
- 不引入第二套常驻浏览器控制服务。
- 不恢复 `~/.sleuth/chrome-live`、新 Chrome、测试浏览器或复制 cookie 的方案。
