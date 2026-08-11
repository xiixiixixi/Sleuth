# agent-browser 共享连接与排队设计

> 状态：2026-08-11 用户已确认目标和范围；本文只设计 `agent-browser` 的连接复用与并发秩序，不约束其他浏览器工具。

## 一句话目标

每次需要使用 `agent-browser` 时，先检查现有连接：健康就直接复用，不健康才建立一条新连接；所有调用者排队使用同一条连接，绝不并发抢标签页。只要 Chrome 没有退出且连接仍健康，Sleuth 不主动断开它。

## 范围

本次只处理以下两件事：

1. `agent-browser` 默认后台服务与用户日常 Chrome 之间的连接持久复用。
2. 多个主 Agent、搜索 Agent 或其他调用者同时使用 `agent-browser` 时的排队与独占操作权。

以下事项明确不在本次范围：

- 不修改或约束其他浏览器工具、插件、Playwright 或其他 Agent 产品。
- 不建立全局浏览器工具路由规则。
- 不启动、关闭、重启或替换用户的 Chrome。
- 不创建测试浏览器、独立用户目录或复制登录数据。
- 不追求 Chrome 重启后永久免授权；新连接仍可能需要用户允许一次。

## 核心原则

### 1. 一条持久连接

- 只使用 `agent-browser` 默认后台服务和 `~/.agent-browser/default.sock`。
- 禁止使用 `--session` 或 `--namespace` 创建额外后台服务。
- 当前连接健康时，所有后续调用者继续使用同一个后台进程和同一条 Chrome 调试连接。
- 移除 `--idle-timeout 1h`；任务结束只释放“浏览器操作权”，不结束后台服务、不关闭 Chrome 连接。
- 禁止使用 `agent-browser close` 或 `close --all` 结束用户 Chrome。

### 2. 先检查，后决定

每次取得浏览器操作权时，必须在排他检查区内判断连接是否健康。健康必须同时满足：

- 当前 Chrome 仍是 full 检查核验过的日常稳定版 Google Chrome。
- Chrome 进程仍存在，当前 `DevToolsActivePort` 与记录的端口和浏览器级 WebSocket 地址一致。
- `agent-browser` 默认后台进程仍存在，`default.sock` 可用。
- 默认后台进程与当前 Chrome 调试端口之间仍有已建立连接。
- 一条只读探测命令能够读取当前页面标题或 URL。

健康时直接复用，禁止为了“保险”重连。只有任一条件不成立，才进入连接恢复。

### 3. 没有健康连接才建立

连接恢复必须由当前唯一获得操作权的调用者执行：

1. 运行 full 检查，核验 Chrome 身份并取得同一次输出的 `cdp_port` 和完整 `cdp_ws`。
2. Node.js 版本合格但 CLI 缺失或过旧时，继续使用现有自动安装/升级规则补齐 `agent-browser@latest`。
3. 只连接 `verified-user-chrome`；禁止启动新浏览器。
4. 使用完整本机 `cdp_ws` 建立默认后台连接，禁止退回只传端口的约 2 秒发现路径。
5. Chrome 要求授权时，只允许这一个调用者等待用户点击“允许”；其他调用者继续排队，不建立第二条连接。
6. 连接成功后记录新的 Chrome 进程、端口、完整地址、默认后台进程和建立时间，随后开始执行任务。

Chrome 没打开或身份不合格时，返回 `BROWSER_CONTROL_REQUIRED`；不得自行启动、关闭或重启 Chrome。

## 排队与独占操作权

### 为什么连接共享但操作不能并发

`agent-browser` 默认后台服务可以被多个命令复用，但同一个 Chrome 连接会共享活动标签状态。两个调用者同时执行“选标签、打开页面、点击”时，可能互相切页或操作错目标。因此连接必须长期共享，具体浏览器操作必须排队。

### 使用权协议

新增一个不连接 Chrome 的本地协调器。它只维护队列和操作权，不是 CDP 代理，也不会产生第二条 Chrome 连接。

接口固定为：

```bash
node scripts/shared-browser.mjs acquire --owner <task-agent-id>
node scripts/shared-browser.mjs run --owner <task-agent-id> -- <agent-browser-command>
node scripts/shared-browser.mjs release --owner <task-agent-id>
node scripts/shared-browser.mjs status
```

- `acquire`：调用者加入先进先出队列。队首取得唯一操作权，同时完成连接健康检查或恢复。
- `run`：只有当前 owner（所有者）可以执行。协调器自动注入已核验的完整 `cdp_ws`，调用者不能自己选择连接地址。
- `release`：只释放操作权并唤醒下一位，绝不关闭后台连接。
- `status`：只读输出当前 owner、排队位置、连接是否健康、默认后台进程和 Chrome 端口，不读取页面内容。

队列和连接元数据放在 `~/.agent-browser/shared-control/`，不写入 cookie、页面正文或登录数据。队列写入必须使用原子文件操作，避免两个进程同时认为自己是 owner。

### 调用者异常退出

- owner 在每次 `run` 时更新活动时间。
- owner 长时间无活动且系统中没有该 owner 正在运行的浏览器命令时，租约才可判定为过期。
- 回收过期租约只释放操作权，不结束 `agent-browser` 默认后台进程。
- 下一位取得操作权后必须重新做健康检查；健康则复用原连接，不健康才恢复连接。
- 任何无法确认的占用都不得强抢；返回 `BROWSER_BUSY` 和当前队列位置，让主 Agent 稍后继续。

## Sleuth 接入

### 主流程

- 轻量搜索仍可并行。
- 任何浏览器阶段开始前，主 Agent 为对应搜索 Agent 取得共享操作权。
- 同一时刻只有一个搜索 Agent 能执行 `shared-browser.mjs run`。
- 当前 Agent 完成、交回或异常退出后释放操作权，再轮到下一个。

### 搜索提示

`spawn-subagent.mjs` 不再把可直接绕过排队的 `agent-browser --cdp ...` 前缀交给搜索 Agent，而是生成带唯一 owner 的协调器命令。搜索 Agent 必须：

1. 使用协调器执行全部 `agent-browser` 命令。
2. 为本任务创建唯一标签并在每次关键操作后核对 URL 或标题。
3. 只关闭本任务明确创建的标签。
4. 完成后释放操作权，但不关闭默认后台连接。

直接裸跑 `agent-browser`、使用命名会话或自行传入其他 CDP 地址都属于绕过排队，必须由测试阻止回归。

## 状态与错误处理

| 状态 | 行为 |
|---|---|
| 健康连接、无人使用 | 队首立即取得操作权并复用连接 |
| 健康连接、有人使用 | 加入队列，返回位置；绝不并发执行 |
| 默认后台存在但连接失效 | 当前 owner 在排他区内恢复一次连接 |
| Chrome 已重启 | 重新 full 检查，使用新的完整地址；可能再次要求允许一次 |
| Chrome 没打开或身份不合格 | 返回 `BROWSER_CONTROL_REQUIRED`，不启动新 Chrome |
| owner 异常退出 | 安全回收过期操作权；健康连接继续保留 |
| 连接恢复失败 | 保留任务已有产出，不循环重连，不允许下一位绕过错误建立第二条连接 |

## 安全边界

- 协调器绝不读取、导出或复制 cookie、密码和本地存储。
- 协调器绝不启动浏览器，也不调用 `agent-browser install` 下载浏览器二进制。
- 禁止自动杀死未知进程。只允许在持有唯一操作权、确认默认后台属于本系统且已经失去连接时，清理明确的失效 socket 或后台进程。
- 页面提交、下单、发帖、删除、改配置等状态变化继续遵守用户确认规则；取得操作权不代表取得业务操作授权。
- Chrome 退出、系统重启或后台进程崩溃后，不能承诺免除下一次官方授权框。

## 实现位置

- 计划新增 scripts/shared-browser.mjs：薄 CLI，负责参数解析和人类可读输出。
- 计划新增 scripts/lib/shared-browser-core.mjs：队列、租约、健康检查、连接状态与命令执行。
- 计划新增 scripts/__tests__/shared-browser.test.mjs：单元和多进程集成测试。
- 修改 `scripts/spawn-subagent.mjs`：浏览器提示改用协调器和唯一 owner。
- 修改 `SKILL.md`、`references/search.md`、`references/tool-guide.md`：删除 1 小时断开规则，统一共享连接与排队规则。
- 修改 `docs/DESIGN-v3.md`、`docs/TESTING.md`、`docs/CHROME-DEBUG-ISSUE.md`、`docs/TEST-ISSUES.md`：记录当前设计、验收方法和真实结果。

继续保持零项目 npm 依赖，全部使用 Node.js 内建模块和 `node:test`。

## 测试与完成标准

### 自动测试

1. 健康连接被直接复用，不调用第二次连接建立流程。
2. 不健康连接只允许队首调用者恢复一次；其他调用者保持排队。
3. 两个并发进程只能有一个 owner，第二个不能执行浏览器命令。
4. owner 释放后，下一位按入队顺序取得操作权。
5. owner 异常退出后可以安全回收操作权，但默认后台连接不被结束。
6. 生成的搜索提示只能使用协调器，不能出现可绕过排队的直接 `agent-browser --cdp` 命令。
7. 当前规则不再包含 `--idle-timeout 1h`，也不包含 `--session` 或 `--namespace` 的可执行路径。
8. Chrome 未就绪时产生 `BROWSER_CONTROL_REQUIRED`，禁止自起浏览器。

### 真实 Chrome 验收

1. 用户在首次连接时点击一次“允许”。
2. 用两个不同 owner 模拟两个调用者；第二位在第一位释放前不能执行。
3. 两位按顺序读取页面标题和 URL，均使用同一个默认后台进程、`default.sock` 和一条 9222 已建立连接。
4. 第一位释放操作权后连接继续存在；第二位取得操作权时不再弹授权框。
5. 在连接持续存在的条件下跨任务再次使用，仍复用同一连接。
6. 全程不关闭、重启 Chrome，不关闭用户原有标签页。
7. 按 `docs/TESTING.md` 重跑全部自动测试和“神逻辑”真实任务检查门，确保研究链路没有回归。

## 最终成功定义

完成不以“代码已改”或“命令能运行”为准，必须同时满足：

- 有健康连接就复用，没有健康连接才建立。
- 多个调用者只能按队列顺序操作，无法并发抢浏览器。
- Chrome 未退出且连接健康时，Sleuth 不主动断开默认后台连接。
- 两个连续调用者只在首次建立连接时需要一次授权，后续复用不再弹框。
- 自动测试、真实 Chrome 验收和真实研究任务检查门全部通过。
