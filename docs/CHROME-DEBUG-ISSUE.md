# Chrome 远程调试授权边界

> 更新：2026-08-11。本文只记录当前确认过的行为，不再把“开启授权模式”写成“永久免确认”。

## 一句话结论

Sleuth 的浏览器兜底必须连接用户当前使用、已经登录的 Chrome。Chrome 144+ 对新的调试连接可能弹出一次授权确认；同一 Chrome、同一调试连接内不应每个页面或每条命令都重复弹。当前 `agent-browser` 0.33.2 的端口自动发现约 2 秒就超时，用户往往还没来得及点“允许”；Sleuth 因此先用 full 检查核验浏览器身份，再把该次检查返回的完整 WebSocket（网页即时通信）地址交给 `scripts/shared-browser.mjs`。协调器复用同一个默认后台服务，并用 `--idle-timeout 0` 保持连接。多个搜索 Agent 继续并行，只有单条浏览器命令短暂排队。`devtools.remote_debugging.user-enabled = true` 和企业策略 `RemoteDebuggingAllowed = true` 只表示允许进入远程调试流程，不等于自动批准每个新连接。

这个 2 秒行为来自 `agent-browser` 0.33.2 的官方源码；上游已有延长授权等待的 [PR #1119](https://github.com/vercel-labs/agent-browser/pull/1119)，但截至本次验证仍未合并。Chrome 官方说明也明确要求用户在授权框点击 Allow（允许）：[Chrome DevTools 配置说明](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)。Sleuth 不安装未发布版本，也不引入第二套浏览器控制器。

## 正常与异常

| 现象 | 判断 |
|---|---|
| 新任务或新调试连接第一次弹一次，确认后本任务内不再弹 | 正常 |
| Chrome 重启、调试代理重启或连接重建后再次弹一次 | 可以正常 |
| 同一任务、同一连接里每个页面或每条命令都弹 | 异常，应检查是否反复创建连接 |
| 能看到多个任务名的 `agent-browser` 后台服务或 `.sock` 文件 | 异常；旧任务创建了多个独立控制连接 |
| 脚本显示 `user-enabled = true`，但新连接仍弹一次 | 正常；这个值不是永久批准 |

## 研究任务的唯一浏览器路径

1. 先运行轻量检查和轻量网络工具。
2. 网络搜索失败后最多改写一次查询；WebFetch / reader 返回空、登录墙、脚本空壳或超时后立即升级浏览器。
3. 运行：

```bash
node scripts/check-deps.mjs --mode full
```

4. 浏览器兜底要求 Node.js ≥ 24。full 检查先验 Node 版本，合格后，缺少或过旧 CLI 时自动运行：

```bash
npm i -g agent-browser@latest
```

这只安装 CLI，不会下载浏览器；`--check-only` 只做诊断，不自动安装。

5. 检查会核对端口背后进程的真实可执行文件。Chrome for Testing、Chrome Dev、Chromium、非默认用户目录、手工调试启动实例和普通进程参数伪装都会被拒绝。
6. 用户在平时使用、已经登录的 Chrome 打开 `chrome://inspect/#remote-debugging` 并开启控制，批准本次连接。
7. 只有输出 `browser_identity: verified-user-chrome` 后，才使用同次检查结果中的完整调试地址：

```bash
SLEUTH_CDP_PORT=9222 SLEUTH_CDP_WS='ws://127.0.0.1:9222/devtools/browser/<full-check-id>' \
node scripts/shared-browser.mjs exec --owner <browser-identity> --tab <browser-identity> -- open https://example.com
```

这里的端口和 `<full-check-id>` 都只是示例，必须逐字使用本次检查真实输出的 `cdp_ws`，不能自己拼接。`<browser-identity>` 也必须原样复制搜索 prompt；它由任务目录、轮次和 Agent 名共同生成，禁止手工用普通 Agent 名替代。`cdp_port` 只用于核对监听者确实是用户日常 Chrome。Chrome 重启后地址会变化，必须重新运行 full 检查。

## 后台服务生命周期

`agent-browser` 第一次执行命令时会启动后台服务，后续命令通过它复用同一条 Chrome 连接。协调器显式使用 `--idle-timeout 0`，避免默认后台服务因为闲置而退出；如果每个搜索角色使用不同的 `--session` 或 `--namespace`，仍会产生多个连接。其他常驻 CDP 客户端也可能独立重连同一个端口；Chrome 会把这些重连视为新的外部控制请求。

Sleuth 的所有命令统一使用：

```bash
SLEUTH_CDP_PORT=<同次检查端口> SLEUTH_CDP_WS='<同次检查完整地址>' \
node scripts/shared-browser.mjs exec --owner <browser-identity> --tab <browser-identity> -- <command>
```

禁止只传端口反复等待授权，禁止使用 `--session` 或 `--namespace` 创建额外后台服务，也禁止启动或复用其他常驻 CDP 代理。搜索、读取、分析继续并行，只有单条浏览器命令短暂排队；脚本自动选择调用者标签，执行命令后再次选回该标签，再核对 URL/标题，然后自动释放。任务结束只通过同一入口关闭自己的标签，不使用裸 `agent-browser close` 或 `close --all` 结束用户 Chrome。

## 明确禁止

- 禁止裸跑 `agent-browser open`；它会启动另一个没有用户当前登录态的浏览器。
- 禁止运行 `agent-browser install`；它下载的是另一个浏览器二进制，不是安装 CLI。
- 禁止用 `--profile` 替代 `--cdp`。
- 禁止使用 `--session` 或 `--namespace` 为同一个用户 Chrome 创建多个后台服务。
- 禁止使用 `agent-browser close` 或 `close --all` 结束用户 Chrome。
- 禁止自动运行 `launch-chrome.mjs`，也禁止为了研究任务关闭、重启或替换用户的 Chrome。
- 禁止提取 cookie、密码或其他凭据来复制登录态。
- 禁止用重复固定等待掩盖搜索、抓取或连接失败。

## 两个辅助脚本的边界

### `fix-chrome-debug-permission.mjs`

这个脚本只检查或设置“允许远程调试”的开关/策略。它不能承诺取消 Chrome 144+ 对新连接的授权确认，也不能证明某个网站已经登录。

macOS 的 `devtools.remote_debugging.user-enabled = true` 表示用户开启过远程调试授权模式；Linux / Windows 的 `RemoteDebuggingAllowed = true` 表示企业策略允许远程调试。两者都不是“永久自动同意”。

### `launch-chrome.mjs`

这个脚本会请求关闭当前 Chrome，再以调试参数重启一个实例。它只保留为用户主动选择的独立诊断工具，不属于 Sleuth 的研究兜底路径。主流程和搜索 Agent 绝不自动调用它。

## 当前验证状态

| 检查项 | 状态 |
|---|---|
| full 检查能发现默认用户 Chrome 的调试端口 | 已自动验证 |
| Node.js 版本不足时不安装不兼容 CLI | 已自动验证 |
| 缺少 `agent-browser` 时 full 执行模式自动安装 CLI | 已自动验证 |
| Chrome for Testing / Dev / Chromium / 独立用户目录不会冒充用户 Chrome | 已自动验证 |
| 搜索子任务没有同次核验的端口与完整地址时返回 `BROWSER_CONTROL_REQUIRED` | 已自动验证任务契约 |
| 所有浏览器命令强制使用经过校验的完整本地调试地址 | 已自动验证任务契约 |
| 所有浏览器命令经 `shared-browser.mjs` 使用 `--idle-timeout 0` 并复用默认后台服务 | 已自动验证任务契约 |
| 单条浏览器命令短暂排队，失败自动释放且不会读错调用者标签 | 已自动验证多进程行为 |
| 主流程不会把 `launch-chrome.mjs` 当研究兜底 | 已做文档与契约检查 |
| 目标网站在现有 Chrome 中是否已经登录 | 必须按网站人工确认 |
| 同一连接是否异常重复弹授权框 | 已真实验证：用户点击一次允许后，后续两条命令没有再弹 |

## 用户看到重复弹窗时怎么判断

先不要安装“永久免弹窗”修复，也不要重开另一个 Chrome。记录三件事：Chrome 是否重启过、调试端口是否变化、是否是同一任务内连续弹。只有“同一任务、同一连接连续弹”才应继续排查连接复用；新连接首次弹一次不属于故障。

如果同一任务连续弹，先检查系统里是否存在多个 `agent-browser` 后台服务、多个 `~/.agent-browser/*.sock`，或其他长期连接 9222 的 CDP 客户端。只停止已经确认属于旧任务的控制进程，不关闭 Chrome；随后重新运行 full 检查，并通过 `shared-browser.mjs`、默认会话和 `--idle-timeout 0` 重建一条连接。

## 2026-08-10 真实授权结果

- full 检查返回 `ready:true`、`browser_identity: verified-user-chrome`、端口 9222 和完整 `cdp_ws`；版本为 `agent-browser` 0.33.2。
- 只传端口的命令多次在约 2 秒结束，没有建立 9222 连接；这是工具等待窗口太短，不是用户没点对。
- 改用同次检查的完整地址后，首条 `get title` 在约 6.6 秒完成。用户点击“允许”后，后续 `get url` 与 `tab list` 合计约 0.1 秒完成，没有再弹授权框。
- 用户原有 Google、链家、贝壳等标签页均可见；系统里只有默认 `agent-browser` 后台服务、`default.sock` 和 9222 一条已建立连接，没有 Chrome for Testing、Chrome Dev、Chromium、新 Chrome 或常驻 CDP 代理。
- 这个结果证明“同一条连接内授权一次即可复用”，不证明 Chrome 重启后永久不弹；Chrome 重启会产生新连接，仍可能要求再确认一次。
