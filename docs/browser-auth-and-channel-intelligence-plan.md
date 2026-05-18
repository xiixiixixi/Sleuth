# Browser Auth and Channel Intelligence Plan

本文件是运行时设计备忘，避免 README、SKILL、脚本引用一个不存在的设计文档。

## 当前结论

Sleuth 不把浏览器当默认入口。浏览器只在需要验证真实页面状态时升级使用。

## Browser Auth

基本原则：

- CDP 连接成功不等于站点登录成功。
- profile 目录存在不等于站点登录成功。
- cookie 文件存在不等于站点登录成功。
- 只有页面级验证才算登录态验证。

页面级验证可以来自：

- 目标站点登录后页面能正常打开。
- DOM 中存在账号菜单、头像、profile、dashboard 等登录态标志。
- site-pattern 中可选的 auth.verify selector。
- 若自动判断不可靠，标记为 unknown，不伪装成 verified。

## Browser Modes

### Managed browser

默认模式。使用 `~/.sleuth/cdp-profile/` 的独立 Chrome profile，不触碰用户日常 Chrome。

适合：

- 登录态复用
- 动态页面验证
- 站内搜索
- 页面状态观察

### Real-browser bridge

显式 opt-in。连接用户日常 Chrome。

约束：

- 默认只读
- 必须指定 domain，未指定时默认拒绝
- 不提取 cookie、密码、token
- 不做写操作，除非未来引入明确用户授权流程
- 敏感页面不截图

## Channel Intelligence

Sleuth 应识别渠道边界，而不是假设所有信息都在开放网页中。

渠道类型：

- 开放公网：搜索、reader、官方文档可覆盖
- 动态网页：需要浏览器验证
- 登录后平台：需要用户完成登录态
- 封闭社区/私域：需要用户提供截图、导出或访谈材料
- 专用连接器：GitHub、邮件、日历、文件等优先用对应工具

## Site Patterns

site-patterns 是经验缓存，不是核心路线。

适合记录：

- 站点是否经常登录墙
- reader 是否读不全
- 站内搜索是否比公网搜索更可靠
- 已知陷阱、反爬、CAPTCHA、付费墙
- 有用入口和人工经验

不建议把 site-patterns 发展成大型 selector 数据库。

## Related References

- `references/tool-boundary.md`
- `references/decision-kernel.md`
- `references/search-guide.md`
- `references/tool-guide.md`
