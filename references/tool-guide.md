# agent-browser 命令速查

> 纯工具调用参考。策略判断看 `search-guide.md`，流程控制看 SKILL.md。

## 连接

前提：CDP 端口已通过 `check-deps.mjs` 就绪（见 SKILL.md "按需起手"）。

```bash
# 正确
agent-browser --cdp 9222 --session ${SID}-main open https://example.com

# 错误：启动无登录态的 Chrome for Testing
agent-browser open https://example.com
```

> 以下所有命令省略 `--cdp 9222 --session ${SID}-main` 前缀，实际调用时必须带上。该 `--cdp` 端口背后是 sleuth 维护的**单一持久登录 profile**（登录一次长期复用）；需要登录态先跑 `check-deps.mjs --ensure-login <url>`。不要用 `--profile`（与 `--cdp` 互斥）。

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
wait 2000                 # 固定等待（最后手段）
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
tab 2                     # 切换
tab close 2               # 关闭
```

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

## 特殊场景

### 反爬 / anti-bot

通过 CDP 连接真实 Chrome，不会被 `navigator.webdriver` 检测。但部分站点有更深层行为检测。

**降级优先级（从轻到重）：**

| 级别 | 策略 | 操作 |
|------|------|------|
| 1 | 换入口 | WebFetch / reader 先试 |
| 2 | 降频 | `wait 1500`~`wait 3000` |
| 3 | 模拟真实交互 | `hover @e1` → `wait 1000` → `click` |
| 4 | 逐键输入 | `keyboard type` 代替 `fill` |
| 5 | SPA 内跳转 | `pushstate` 代替 `open` |
| 6 | 换来源 | WebSearch 缓存页 / API / 聚合 |
| 7 | 标记缺口 | 记录为 anti_bot |

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

**视频：** 字幕优先 → `extract-subtitles.sh <URL>` + `srt_to_transcript.py`。无字幕时操控 `<video>` + screenshot 采帧（短视频 5-8 帧，中等 10-15 帧）。B站、YouTube 也可站内搜索。

**音频/播客：** 优先提取已有字幕和 shownotes，搜 `"播客名" transcript`。均失败则告知用户无公开字幕。

**PDF：** eval 找链接 `document.querySelectorAll('a[href$=".pdf"]')`，下载后用 Read 工具读取。arXiv 论文直接访问 `arxiv.org/pdf/<论文ID>`。

**图片与视觉内容：** 页面中的图表、截图、产品图、信息图等，纯文本提取会丢失关键信息。

1. 发现页面有视觉内容时，先用 `eval` 提取图片 URL：
   ```bash
   eval "Array.from(document.querySelectorAll('img')).map(i => ({src: i.src, alt: i.alt}))"
   ```
2. 用 vision 工具（analyze_image / analyze_data_visualization）分析关键图片。
3. 结论写进报告，附原始图片 URL，不存图。

**DOM 技巧：** 折叠区块和懒加载内容已在 DOM 中，eval 可直接提取。Shadow DOM 和 iframe 在 snapshot 中展开一级，eval 可递归穿透。`scroll down` 触发懒加载后再提取图片 URL。
