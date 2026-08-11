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
# owner 与 tab 必须原样复制搜索 prompt 生成的唯一 browser-identity，禁止手工用 Agent 名拼接

# 正确用法
SLEUTH_CDP_PORT=<port> SLEUTH_CDP_WS='ws://127.0.0.1:<port>/devtools/browser/<id>' \
node scripts/shared-browser.mjs exec --owner <browser-identity> --tab <browser-identity> -- open https://example.com

# 错误：不带 --cdp 会启动另一个无登录态浏览器
agent-browser open https://example.com
```

完整地址必须逐字来自同次 full 检查，不允许手工拼接、猜测或使用其他主机；生成搜索提示时会把经过校验的地址直接写入命令。Chrome 重启后地址会变化，必须重新运行 full 检查。只传端口会走一个约 2 秒的自动发现窗口，在 Chrome 144 的人工授权框来不及操作，因此禁止用端口模式原地重试。

所有命令必须通过 `scripts/shared-browser.mjs exec` 复用默认后台服务。协调器内部显式使用 `--idle-timeout 0`，关闭后台服务的闲置退出；只要用户 Chrome 和连接仍健康就继续复用。禁止使用 `--session` 或 `--namespace` 创建额外后台服务，禁止启动或复用其他常驻 CDP 代理。任务结束只通过相同入口关闭本任务标签；禁止使用 `agent-browser close` 或 `close --all`，避免关闭用户 Chrome。

> 以下命令只展示 `--` 后面的浏览器命令。实际调用必须原样使用搜索 prompt 给出的完整 `shared-browser.mjs exec --owner <browser-identity> --tab <browser-identity> --` 前缀；这个身份由任务目录、轮次和 Agent 名共同生成，禁止手工改成普通 Agent 名。不要手动取得或释放锁，不要用 `--profile` 或 `--auto-connect` 猜浏览器，也不要调用 `launch-chrome.mjs` 重开 Chrome。

## 核心姿势

- **eval first**：观察和提取 → 先 eval 读 DOM
- **snapshot for observation**：快照用于观察；共享模式禁止跨命令复用 `@eN`
- **screenshot sparingly**：只在视觉证据重要时
- **network when needed**：需要时追 API；标签选择交给协调器

## 命令速查

### 提取（最高频）

```bash
eval "document.body.innerText"                              # 全页文本
eval "document.title"                                       # 快速确认页面
eval "Array.from(document.querySelectorAll('table tr')).map(r => ({name: r.cells[0]?.innerText, price: r.cells[1]?.innerText}))" # 结构化提取；wrapper 的标准输入保留给内部批次，禁止 eval --stdin

get text "article h1"     # 用稳定 CSS 选择器读取元素文本
get html "main"           # 元素 HTML
get attr "a.docs" href    # 属性值
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
snapshot -i               # 观察交互元素；不要把本次 @eN 留到下一条共享命令
snapshot -i --json        # JSON 格式

click "button.submit"     # 用稳定选择器点击
get attr "a.docs" href    # 先读目标地址；禁止 --new-tab
open "<上一步读到的地址>" # 再在自己的标签打开
fill "input[name=q]" "text" # 清空 + 输入
type "textarea" "text"   # 追加输入
press Enter               # 按键
select "select[name=kind]" "value" # 下拉选择
hover ".menu"             # 悬停
```

### 等待

```bash
wait ".result"            # 等元素出现
wait --text "Success"     # 等文本
wait --url "**/dashboard" # 等 URL 变化
wait --load networkidle   # 等网络空闲
wait 2000                 # 只用于已确认的页面动画，最多一次；不能拿它重试失败工具
```

### 滚动

```bash
scroll down 500           # 向下滚（触发懒加载）
scrollintoview "#details" # 滚到元素可见
```

### 轻量定位

```bash
find text "Sign In" click              # 按文本找并操作
find role button click --name "Submit" # 按角色找
find label "Email" fill "user@x.com"   # 按标签找
```

### 标签

```bash
tab close <browser-identity> # 唯一允许的标签命令；身份必须原样复制 prompt
```

列出、创建和切换标签全部由协调器完成。调用者禁止执行 `tab`、`tab new` 或 `tab <id>`，也禁止 `--new-tab`；需要跟随新窗口链接时先读 `href`，再用 `open` 在自己的标签导航。

### 多 Agent 并发时的标签边界

同一个现有 Chrome 的 CDP 连接会共享“当前标签页”。在真实测试中，两个独立调用如果直接切换标签，可能都读到后切换的页面。解决方式不是让搜索 Agent 一个等一个完成：**所有非浏览器工作继续并行，只有单条浏览器命令通过 `shared-browser.mjs exec` 短暂排队**。

协调器自动完成：

- 标签不存在时创建调用者自己的标签。
- 在同一批次内选择该标签、执行单条命令、再次选回该标签，再读取最终 URL 和标题。
- 命令成功或失败后自动释放短锁，调用者绝不手动 `acquire/release`。
- 禁止跨命令复用 `@eN`；需要交互时优先用稳定 CSS 选择器或 `find` 单命令。

任务结束仍使用相同入口，把浏览器命令写成 `tab close <browser-identity>`。这个身份必须原样复制搜索 prompt；协调器只允许 owner 关闭自己的标签，禁止关闭别人的标签。

### 状态检查

```bash
is visible ".result"      # 可见？
is enabled "button.submit" # 可用？
```

### 截图

```bash
screenshot                # 可视区
screenshot --full         # 全页
screenshot --annotate     # 带观察标注；不要跨命令使用生成的 @eN
```

**截图默认存到 `~/.agent-browser/tmp/screenshots/`，不在当前目录。** 要搬到任务目录：

```bash
# 截图后搬到 output 目录
SLEUTH_CDP_PORT=<port> SLEUTH_CDP_WS='<完整地址>' \
node scripts/shared-browser.mjs exec --owner <browser-identity> --tab <browser-identity> -- \
  screenshot <outputDir>/screenshots/page.png
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
| 3 | 模拟真实交互 | 用稳定选择器 `hover ".target"` → 最多一次短等待 → `click ".target"` |
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
frame main                  # 返回主页面
```

snapshot 自动内联 iframe 内容。共享模式不用跨命令 `@eN`；只有 snapshot 无法展示时才用稳定 iframe 选择器手动切换。

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
