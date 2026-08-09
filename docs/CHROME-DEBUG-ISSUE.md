# Chrome 远程调试授权边界

> 更新：2026-08-09。本文只记录当前确认过的行为，不再把“开启授权模式”写成“永久免确认”。

## 一句话结论

Sleuth 的浏览器兜底必须连接用户当前使用、已经登录的 Chrome。Chrome 144+ 对新的调试连接可能弹出一次授权确认；同一 Chrome、同一调试连接内不应每个页面或每条命令都重复弹。`agent-browser` 连接用户现有 Chrome 时，后台服务默认不会按普通规则闲置退出，因此 Sleuth 必须复用同一个默认后台服务并显式设置 `--idle-timeout 1h`。`devtools.remote_debugging.user-enabled = true` 和企业策略 `RemoteDebuggingAllowed = true` 只表示允许进入远程调试流程，不等于自动批准每个新连接。

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
7. 只有输出 `browser_identity: verified-user-chrome` 后，才使用检查结果中的字面端口：

```bash
agent-browser --cdp 9222 --idle-timeout 1h open https://example.com
```

这里的 `9222` 只是示例，必须使用本次检查真实输出的端口。

## 后台服务生命周期

`agent-browser` 第一次执行命令时会启动后台服务，后续命令通过它复用同一条 Chrome 连接。连接用户现有 Chrome 的后台服务默认不会自动闲置退出；如果每个搜索角色使用不同的 `--session` 或 `--namespace`，这些服务会长期残留。其他常驻 CDP 客户端也可能独立重连同一个端口；Chrome 会把这些重连视为新的外部控制请求。

Sleuth 的所有命令统一使用：

```bash
agent-browser --cdp <字面端口> --idle-timeout 1h <command>
```

禁止使用 `--session` 或 `--namespace` 创建额外后台服务，也禁止启动或复用其他常驻 CDP 代理。任务结束只关闭本任务新建的标签页，不使用 `agent-browser close` 或 `close --all` 结束用户 Chrome；后台服务闲置 1 小时后自行断开。

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
| 搜索子任务没有端口时返回 `BROWSER_CONTROL_REQUIRED` | 已自动验证任务契约 |
| 所有浏览器命令强制使用 `--cdp <port>` | 已自动验证任务契约 |
| 所有浏览器命令显式使用 `--idle-timeout 1h` 并复用默认后台服务 | 已自动验证任务契约 |
| 主流程不会把 `launch-chrome.mjs` 当研究兜底 | 已做文档与契约检查 |
| 目标网站在现有 Chrome 中是否已经登录 | 必须按网站人工确认 |
| 同一连接是否异常重复弹授权框 | 已确认多后台服务和另一个长期 CDP 客户端会制造重复连接；单连接仍需最终人工允许验证 |

## 用户看到重复弹窗时怎么判断

先不要安装“永久免弹窗”修复，也不要重开另一个 Chrome。记录三件事：Chrome 是否重启过、调试端口是否变化、是否是同一任务内连续弹。只有“同一任务、同一连接连续弹”才应继续排查连接复用；新连接首次弹一次不属于故障。

如果同一任务连续弹，先检查系统里是否存在多个 `agent-browser` 后台服务、多个 `~/.agent-browser/*.sock`，或其他长期连接 9222 的 CDP 客户端。只停止已经确认属于旧任务的控制进程，不关闭 Chrome；随后只用默认会话和 `--idle-timeout 1h` 重建一次连接。
