# 搜索方法论

主 Agent 和探针使用同一套搜索方法。本文是唯一权威来源。

## 搜索循环

```
选词 → 搜索 → 扫结果（3-5条）→ 点进 2-3 个 → 提取
  ↓ 不够                                          ↓ 够了
换词/换角度/换引擎 ←──────────────────────────────── 停止
```

同一页面 3 个链接不理想 → 换词。同一角度 2 轮无新信息 → 换角度。

## 核心规则

| 规则 | 为什么 |
|------|--------|
| 读全文 | 摘要可能过时或截断。必须 `eval "document.body.innerText"` 提取原文 |
| 一手 > 二手 | 核心结论至少 2 个独立来源。注意循环引证（A 引 B 引 A）|
| 反证必搜 | 只找正面材料会让结论虚高。搜 `X complaint / limitation / vs alternative` |
| 标注来源 | 所有信息附 URL。无来源的结论不能作为核心依据 |

## 搜索策略

### 多角度

一个主题至少从 4-5 个角度搜。每次读到的新关键词/术语作为下一角度的搜索词。

例：调研一个 SaaS 产品 →
- 官网（定位、定价、功能）
- 用户评价（G2、Reddit、社区）
- 竞品对比（vs X、vs Y）
- 创始人/团队（LinkedIn、访谈）
- 负面信息（complaint、lawsuit、shutdown）

### Broad → Narrow

先宽搜看信息量级：
- 太多 → 加限定词（时间、地区、版本）
- 太少 → 扩词（同义词、英文/中文各搜）
- 刚好 → 逐条点进

### 站内深挖

找到高价值网站后用 `site:域名 关键词` 深挖：
- 官网博客、changelog、pricing
- 投资人页面、媒体报道
- GitHub issues、discussions

### YouTube

大量一手内容在视频里（创始人访谈、产品演示、行业分析）。必须尝试：

```bash
agent-browser ... open "https://www.youtube.com/results?search_query=关键词"
# 或
agent-browser ... open "https://www.google.com/search?q=site:youtube.com+关键词"
```

找到视频后提取字幕（见 `content-extraction.md`）。

## 搜索引擎选择

| 场景 | 首选 | 补充 |
|------|------|------|
| 英文通用 | Google | — |
| 中文内容 | 百度 | Google 中文 |
| 访谈/演示 | YouTube | `site:youtube.com` |
| 特定站内 | `site:域名` | — |
| 学术 | Google Scholar | arXiv |

## 停止条件

- 关键问题已答，证据充分 → 停
- 新一轮新增 <10% → 停
- 连续 2 个角度无新信息 → 停

不能停：
- 存在未验证的矛盾信息
- 核心结论只有单一来源
- 关键问题尚未回答

## 障碍处理

| 障碍 | 处理 |
|------|------|
| 登录弹窗 | `eval "document.body.innerText"` 穿透；不行请用户登录 |
| 付费墙 | 提取可见片段，搜免费转载版 |
| CAPTCHA | 告知用户，5分钟无响应换渠道 |
| 429/限流 | 暂停 30 秒或换渠道 |
| 页面超时 | 加 timeout；连续失败换方式 |

遇到障碍记录 session-logger（type: captcha/login_wall/paywall/dead_link/anti_bot）。
