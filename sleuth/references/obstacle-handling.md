# 障碍处理指南

## 登录判断

用户 Chrome 已登录常用网站。核心判断：**目标内容拿到了吗？**

登录弹窗常只是覆盖遮罩——优先 eval 穿透：

```bash
agent-browser --auto-connect eval "document.body.innerText.substring(0, 2000)"
```

eval 能拿到内容则无需登录。确认无法获取且登录能解决时，告知用户在 Chrome 中登录后继续。

**付费墙**：提取墙前可见片段，检查缓存版本（Google 缓存、archive.org），不尝试绕过。

## CAPTCHA

遇到验证码立即暂停，告知用户需人工处理。5 分钟无响应则跳过，换替代渠道。

## 限流

触发限流信号（429、验证码页面、空响应）→ 暂停该域名，换渠道或等 30 秒。重试后仍限流则放弃。

## 故障恢复

**临时故障（最多重试 2 次）**：
- agent-browser 非零退出 → check-deps 确认连接
- CDP 断开 → 重新 check-deps
- 页面超时 → 加大 timeout 或改用 domcontentloaded

**结构性故障（换方案，不重试）**：
- snapshot 空但标题正常 → eval 检查 body.innerText.length
- eval 语法错误 → 改用 --stdin heredoc
- 同一操作连续失败 2 次 → 换定位方式或 GUI 交互
