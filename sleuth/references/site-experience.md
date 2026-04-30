# 站点经验与统计

## 站点经验文件

按域名存储在 `~/.sleuth/site-patterns/`。确定目标域名后通过 `match-site.mjs` 查找：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/match-site.mjs" "<域名>"
```

读取匹配文件获取先验知识。经验标注发现日期，当作提示而非保证。

### 经验文件格式

```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-04-27
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么

## 自动统计
（由 update-site-stats.mjs 自动生成）
```

### 写入经验

操作成功后发现新站点或新模式，主动写入经验文件。只写验证过的事实。

```bash
node "${CLAUDE_SKILL_DIR}/scripts/update-site-stats.mjs" [--domain <域名>]
```

## 自动统计

update-site-stats.mjs 从 session 日志聚合：访问次数、成功率、死链数、CAPTCHA 次数、Bayesian 可信度。

新任务开始时：读取相关站点经验，优先选历史成功率高的渠道，对高死链率域名准备替代方案。
