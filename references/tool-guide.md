# agent-browser 命令速查

> 本文是 AI Agent 的 agent-browser 关键命令速查，按研究动作组织。完整文档请用 `agent-browser skills get core --full` 查看。

## 核心姿势

不要把 agent-browser 只当“截图点击器”。它更像浏览器研究执行层。

- **DOM / eval-first**：要观察、提取、理解页面结构时，先直接看 DOM、文本、结构化数据。
- **snapshot / @ref for interaction**：要点击、填表、选择元素时，再拿交互快照和 @ref。
- **screenshots only when visuals matter**：布局、图表、视觉证据、状态异常时再截图。
- **tab / network / state / auth are first-class**：比较页面、追 API、复用登录态、隔离任务时直接用。

## 连接 Chrome

Sleuth 使用 **managed browser**（`~/.sleuth/cdp-profile/`）——独立于用户日常 Chrome 的持久实例。

### 启动与连接

> **注意**：`$SLEUTH_CDP_PORT` 由 agent 从 `check-deps.mjs` 的 stdout 解析获得（`SLEUTH_CDP_PORT=<port>` 行），不是 shell 自动 export 的环境变量。`--json` 模式下从 JSON 的 `cdp_port` 字段读取。

```bash
# 确保 managed browser 可用，输出 SLEUTH_CDP_PORT
node "${SKILL_DIR}/scripts/check-deps.mjs" --ensure-cdp

# 获取 JSON 格式状态
node "${SKILL_DIR}/scripts/check-deps.mjs" --ensure-cdp --json
# → {"browser_mode":"managed","cdp_port":9222,"profile_dir":"~/.sleuth/cdp-profile","auth_state":"unknown"}

# 连接 managed browser（使用动态端口）
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main open https://example.com
```

### 登录态管理

managed browser 的登录态持久保存在 `~/.sleuth/cdp-profile/`，跨 session 复用。

```bash
# 首次使用：打开 managed browser 窗口，手动登录目标站点
node "${SKILL_DIR}/scripts/sleuth-browser.mjs" open-login

# 指定 URL 打开
node "${SKILL_DIR}/scripts/check-deps.mjs" --ensure-cdp --login-url "https://example.com/login"
```

### Auth 验证

**CDP 连接成功 ≠ 站点登录成功。** 连上后必须验证：

```bash
# 打开目标站点，检查登录态标志
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main open https://example.com/dashboard
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main eval "document.querySelector('[data-testid=account-menu]')?.textContent"
```

如果返回空或登录页元素 → 用户需要手动登录。

### Real-browser bridge（Phase 4）

`--real-browser` 模式使用用户日常 Chrome，需显式 opt-in。默认只读模式，不会执行点击、填写、提交等写操作。

```bash
# 用户需先以 CDP 模式启动 Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 &

# 然后运行
node scripts/check-deps.mjs --real-browser --domain github.com --json

# 或通过环境变量指定端口
SLEUTH_REAL_CDP_PORT=9222 node scripts/check-deps.mjs --real-browser
```

安全约束：
- 只读默认：不执行写操作（点击、填写、提交）
- `--domain` 限制操作范围到指定域名
- 不提取 cookie、密码或 token
- 所有操作对用户可见

### 安全边界

- `--auto-connect` 已废弃；使用 `--cdp $SLEUTH_CDP_PORT` 连接 managed browser
- 不提取 cookie、密码或 token
- 需要用户登录时，只让用户在本地可见 Chrome 中完成
- 中途 profile 被重建或站点 session 过期后，必须重新验证登录态

## 障碍处理

| 障碍 | 处理 |
|------|------|
| 登录弹窗 | 先判断是否仍能通过 DOM 读到所需内容；不行再请用户登录 |
| 付费墙 | 只用可见内容，不绕过 |
| CAPTCHA / anti-bot | 暂停该路径，换入口或换来源类型 |
| 限流（429 / 空响应） | 降频、等待、换路；不要在同一路径死磕 |
| 页面超时 / 空白 | 改等待策略或看 network / DOM 状态 |

记录障碍时可用：

```bash
node "${SKILL_DIR}/scripts/session-logger.mjs" --action log --sid "$SID" \
  --operation '{"type":"captcha|login_wall|paywall|dead_link|anti_bot","url":"<URL>","domain":"<域名>"}'
```

## 导航

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main open https://example.com
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main back
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main forward
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main reload
```

## 观察与提取

### DOM / 文本 / 结构

```bash
# 页面元信息
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main get title
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main get url

# 元素信息
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main get text @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main get html @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main get attr @e1 href
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main get value @e1

# 简单 DOM 观察
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main eval "document.title"

# 复杂结构化提取（推荐）
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main eval --stdin <<'EOF'
const rows = document.querySelectorAll("table tr");
Array.from(rows).map(r => ({
  name: r.cells[0]?.innerText,
  price: r.cells[1]?.innerText,
}));
EOF
```

### 快照（交互前 / 结构速览时）

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main snapshot -i
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main snapshot -i -c
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main snapshot -i -u
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main snapshot -i --json
```

`@ref` 每次 snapshot 后都会重新分配。页面变化后，交互前重新 snapshot。

## 交互

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main click @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main click @e1 --new-tab
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main dblclick @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main hover @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main focus @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main fill @e1 "text"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main type @e1 "text"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main press Enter
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main check @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main uncheck @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main select @e1 "value"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main upload @e1 file.pdf
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main scroll down 500
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main scrollintoview @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main drag @e1 @e2
```

## 轻量定位器

简单场景下，`find` 比全量 snapshot 更轻：

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main find role button click --name "Submit"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main find text "Sign In" click
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main find label "Email" fill "user@test.com"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main find placeholder "Search" type "query"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main find testid "submit-btn" click
```

## 等待

等待是观察的一部分，不是盲 sleep。

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait @e1
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait --text "Success"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait --url "**/dashboard"
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait --load networkidle
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait --load domcontentloaded
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait --fn "window.ready"

# 只有其他等待都不合适时才用固定等待
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main wait 2000
```

## 截图

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main screenshot
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main screenshot page.png
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main screenshot --full
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main screenshot --annotate
```

只在视觉证据真的重要时截图，例如：

- 页面布局或视觉状态本身就是结论的一部分
- 需要留证某个图表、弹窗、渲染异常
- 需要给多模态模型看视觉差异

## Tab 管理

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main tab
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main tab new <url>
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main tab 2
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main tab close 2
```

适合：

- 在同一 session 内保留来源页和详情页
- 对比 pricing / docs / changelog 多个页面
- 批量打开候选页后逐个验证

## Session 管理

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main ...
agent-browser --cdp $SLEUTH_CDP_PORT --session ${BROWSER_SESSION} ...
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main close
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main close --all
```

并行研究时，独立 session 是隔离状态和避免 tab 污染的关键：

- 不同域名、不同来源类型、不同子问题可用多个 session 并行，例如 `${SID}-pricing`、`${SID}-docs`、`${SID}-reviews`。
- 同一账号后台、同一表单流程、会产生状态变更的路径不要并行操作。
- 每个并行 session 都要有明确目标和停止条件；不要把“开很多 tab”等同于并行研究。

## 状态持久化

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main state save ./auth.json
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main --state ./auth.json ...
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main auth save <name> ...
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main auth login <name>
```

适合：

- 复用登录态
- 长任务恢复
- 需要在不同轮次里保留相同站点状态

使用前先验证 state/auth 是否真的可用；失败时把它当作缺口或要求用户重新登录，不要静默降级成“已验证”。

## 网络

```bash
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main network requests
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main network route "**/api" --abort
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main network route "**/api" --body '{"mock": true}'
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main network har start
agent-browser --cdp $SLEUTH_CDP_PORT --session ${SID}-main network har stop /tmp/trace.har
```

适合：

- 判断页面真实数据来自哪里
- 看请求是否失败、重定向或被反爬拦截
- 理解 SPA / API-backed 页面
- 排查“页面看起来没内容”到底是 DOM 问题还是网络问题
