# 浏览器操控工具命令速查

## 连接

前提：浏览器已通过 `scripts/check-deps.mjs --mode full` 就绪，而且输出中的 `browser_identity` 是 `verified-user-chrome`。这里连接的是用户平时使用、已经登录的 Chrome，不是由工具新开的浏览器。`check-deps` 会在同一次输出中给出端口和完整 WebSocket（网页即时通信）调试地址。

浏览器兜底要求 Node.js ≥ 24，因为当前支持的 `agent-browser` 版本都声明这个运行要求。full 检查会先验 Node 版本；合格后发现 CLI 缺失或过旧才会自动运行：

```bash
npm i -g agent-browser@latest
```

这条命令只安装或升级 CLI，不下载测试浏览器。`--check-only` 是不改环境的诊断模式，只报告问题，不自动安装。然后让用户在**现有 Chrome** 打开 `chrome://inspect/#remote-debugging` 并开启控制，再重跑 full 检查。`agent-browser install` 的含义是下载另一个浏览器二进制，研究兜底中禁止运行。

检查还必须核对监听端口进程的真实可执行文件和用户目录。Chrome for Testing、Chrome Dev、Chromium、`~/.sleuth/chrome-live` 等独立用户目录，哪怕端口能连也必须拒绝；普通程序即使把 Chrome 路径放进自己的参数也不能通过。不能把 `connected:true` 当成“已经接入用户登录态 Chrome”。

```bash
# 同次 full 检查输出的 SLEUTH_CDP_PORT 与 SLEUTH_CDP_WS
# 端口用于身份核对，实际命令使用完整地址

# 正确用法
agent-browser --cdp 'ws://127.0.0.1:<port>/devtools/browser/<id>' --idle-timeout 1h open https://example.com

# 错误：不带 --cdp 会启动另一个无登录态浏览器
agent-browser open https://example.com
```

完整地址必须逐字来自同次 full 检查，不允许手工拼接、猜测或使用其他主机；生成搜索提示时会把经过校验的地址直接写入命令。Chrome 重启后地址会变化，必须重新运行 full 检查。只传端口会走一个约 2 秒的自动发现窗口，在 Chrome 144 的人工授权框来不及操作，因此禁止用端口模式原地重试。

连接用户现有 Chrome 的 `agent-browser` 后台服务默认不会按普通闲置规则退出，所以所有命令必须复用默认后台服务并显式带 `--idle-timeout 1h`。禁止使用 `--session` 或 `--namespace` 创建额外后台服务，禁止启动或复用其他常驻 CDP 代理。任务结束只关闭本任务明确新建的标签页；禁止使用 `agent-browser close` 或 `close --all`，避免关闭用户 Chrome。

> 以下所有命令省略 `agent-browser --cdp 'ws://127.0.0.1:<port>/devtools/browser/<id>' --idle-timeout 1h` 前缀，实际调用时必须带上同次 full 检查返回的字面地址。不要用 `--profile`（与 `--cdp` 互斥），不要用 `--auto-connect` 猜浏览器，不要调用 `launch-chrome.mjs` 重开 Chrome。

## 核心姿势

- **eval first**：观察和提取 → 先 eval 读 DOM
- **snapshot for interaction**：点击、填表 → 先 snapshot 拿 @ref
- **screenshot sparingly**：只在视觉证据重要时
- **tab / network when needed**：比较页面、追 API

## 命令速查

### 提取（最高频）

```bash
eval "document.body.innerText"                              # 全页文本
eval "document.title"                                       # 快速确认页面
eval --stdin <<'EOF'                                        # 结构化提取（IIFE 防重跑冲突）
(function() {
  const rows = document.querySelectorAll("table tr");
  return Array.from(rows).map(r => ({
    name: r.cells[0]?.innerText, price: r.cells[1]?.innerText
  }));
})()
EOF

get text @e1              # 元素文本
get html @e1              # 元素 HTML
get attr @e1 href         # 属性值
get title                 # 页面标题
get url                   # 当前 URL
```

### 导航

```bash
open <url>                # 打开页面
back                      # 后退
reload                    # 刷新
```

### 快照与交互

```bash
snapshot -i               # 交互快照（交互前必须拿，@ref 每次重新分配）
snapshot -i --json        # JSON 格式

click @e1                 # 点击
click @e1 --new-tab       # 新 tab 打开
fill @e1 "text"           # 清空 + 输入
type @e1 "text"           # 追加输入
press Enter               # 按键
select @e1 "value"        # 下拉选择
hover @e1                 # 悬停
```

### 等待

```bash
wait @e1                  # 等元素出现
wait --text "Success"     # 等文本
wait --url "**/dashboard" # 等 URL 变化
wait --load networkidle   # 等网络空闲
wait 2000                 # 只用于已确认的页面动画，最多一次；不能拿它重试失败工具
```

### 滚动

```bash
scroll down 500           # 向下滚（触发懒加载）
scrollintoview @e1        # 滚到元素可见
```

### 轻量定位

```bash
find text "Sign In" click              # 按文本找并操作
find role button click --name "Submit" # 按角色找
find label "Email" fill "user@x.com"   # 按标签找
```

### Tab

```bash
tab                       # 列出
tab new <url>             # 新建
tab t2                    # 切换（用 t0/t1/t2 格式，不接受纯数字）
tab close t2              # 关闭
```

### 多 Agent 并发时的标签边界

同一个现有 Chrome 的 CDP 连接会共享“当前标签页”。在最低支持版本 agent-browser 0.28.0 的真实测试中，两个 `--session` 连接仍会读到后一个连接切换的页面，因此**浏览器操作必须串行**：主 Agent 同一时刻只把 CDP 端口交给一个搜索 Agent，不能让多个 Agent 并发执行 `open / eval / snapshot / click`。禁止使用 `--session` 或 `--namespace` 另建后台服务规避串行限制。

拿到浏览器操作权的 Agent 必须用自己的唯一名字标记标签，并分三步执行：

```bash
tab new --label <agent-name>   # 只创建自己的空白标签
tab <agent-name>               # 明确切换到自己的标签
open <url>                     # 再单独导航，并用 get url / get title 核验
```

不要依赖 `tab new --label <name> <url>` 一步完成导航：agent-browser 0.28.0 连接现有 Chrome 时实测可能仍停在 `about:blank`。任务结束只运行 `tab close <agent-name>`，禁止关闭别人的标签。

### 状态检查

```bash
is visible @e1            # 可见？
is enabled @e1            # 可用？
```

### 截图

```bash
screenshot                # 可视区
screenshot --full         # 全页
screenshot --annotate     # 带 @ref 标注
```

**截图默认存到 `~/.agent-browser/tmp/screenshots/`，不在当前目录。** 要搬到任务目录：

```bash
# 截图后搬到 output 目录
agent-browser --cdp 'ws://127.0.0.1:<port>/devtools/browser/<id>' --idle-timeout 1h screenshot
cp ~/.agent-browser/tmp/screenshots/screenshot-*.png <outputDir>/screenshots/
```

不要用 `--file` 参数（不是有效的 screenshot flag，会报错）。

## 特殊场景

### 反爬 / anti-bot

通过 CDP 连接真实 Chrome，不会被 `navigator.webdriver` 检测。但部分站点有更深层行为检测。

进入本段前，网络搜索和网页读取已经失败，当前已经连接现有 Chrome。不要再用长等待假装处理反爬，也不要改开新的浏览器。

**浏览器内换路优先级（从轻到重）：**

| 级别 | 策略 | 操作 |
|------|------|------|
| 1 | 看失败位置 | `network requests` + `eval` 判断是正文没渲染还是请求被拦 |
| 2 | 换站内入口 | 从首页、帮助中心或已登录后台内导航到目标页 |
| 3 | 模拟真实交互 | `hover @e1` → 最多一次短等待 → `click` |
| 4 | 逐键输入 | `keyboard type` 代替 `fill` |
| 5 | SPA 内跳转 | `pushstate` 代替 `open`，保留当前登录态 |
| 6 | 换一手来源 | 在同一现有 Chrome 中改查官方文档、API 或帮助中心 |
| 7 | 标记缺口 | 记录为 anti_bot，不继续重复等待 |

**级别 3 的底层鼠标（hover/click 被检测时）：**

```bash
mouse move 100 200
mouse down left
mouse up left
```

**级别 4 的底层键盘（fill 被检测时）：**

```bash
keyboard type "query"       # 逐键输入，触发完整事件链
keyboard inserttext "text"  # 直接插入，最快但可能被拦
```

**不做：** 不伪装 User-Agent、不注入 JS 抹自动化标志、不绕付费墙、不高频连续操作。

### SPA 导航

```bash
pushstate https://example.com/new-page
```

SPA 内跳转不刷新页面，保留 DOM 和登录态。`open` 会重新加载，SPA 内优先 `pushstate`。

### iframe

```bash
frame "#iframe-selector"    # 进入 iframe
frame @e3                   # 按 @ref 进入
frame main                  # 返回主页面
```

snapshot 自动内联 iframe 内容，`@ref` 可直接操作。只有 snapshot 无法展示时才手动切换。

### 网络调试

```bash
network requests            # 查看所有请求
```

判断"页面没内容"是 DOM 问题还是网络问题。

### 特殊内容类型

**视频：** 字幕优先 → `scripts/extract-subtitles.sh <URL>` + `scripts/srt_to_transcript.py`。无字幕时操控 `<video>` + screenshot 采帧（短视频 5-8 帧，中等 10-15 帧）。B站、YouTube 也可站内搜索。

**音频/播客：** 优先提取已有字幕和 shownotes，搜 `"播客名" transcript`。均失败则告知用户无公开字幕。

**PDF：** eval 找链接 `document.querySelectorAll('a[href$=".pdf"]')`，下载后用 Read 工具读取。arXiv 论文直接访问 `arxiv.org/pdf/<论文ID>`。

**图片与视觉内容：** 页面里的图表、截图、产品图、信息图，纯文本提取会丢关键信息。每个最终采用的一手页面都要先扫描视觉候选；浏览器页面可用 `eval` 提取图片 URL：

```bash
eval "Array.from(document.querySelectorAll('img')).map(i => ({src: i.src, alt: i.alt}))"
```

- 原图清晰且 URL 稳定：直接登记 `image_url`，报告使用来源 URL 内嵌，避免无意义的二次截图。
- 动态状态、交互结果、Canvas 或原图无法取得：截图后搬到任务目录 `screenshots/`，登记 `screenshot_path`。
- 每张图同时登记 `source_page_url`、抓取日期和解释性图注；图片来源页必须属于该 finding 的证据来源。
- 只登记任务相关图片，不保存 logo、头像、广告、背景和重复缩略图。
- **不做**：不对敏感 / 登录后页面截图；归档仅作研究留证，尊重版权。

**DOM 技巧：** 折叠区块和懒加载内容已在 DOM 中，eval 可直接提取。Shadow DOM 和 iframe 在 snapshot 中展开一级，eval 可递归穿透。`scroll down` 触发懒加载后再提取图片 URL。
