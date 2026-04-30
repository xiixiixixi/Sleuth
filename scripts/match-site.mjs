#!/usr/bin/env node
/**
 * match-site.mjs — 站点经验匹配工具
 *
 * 用途：根据用户输入的文本，在 ~/.sleuth/site-patterns/ 中查找匹配的站点经验文件，
 *       输出经验内容供 Agent 参考。
 *
 * 匹配逻辑：
 *   1. 遍历 ~/.sleuth/site-patterns/ 下所有 .md 文件
 *   2. 每个文件名就是域名（如 github.com.md）
 *   3. 解析文件的 YAML frontmatter 中的 aliases 字段（别名列表）
 *   4. 将域名 + 别名构造成正则表达式，与用户输入做匹配
 *   5. 匹配成功 → 输出该文件的经验内容（跳过 frontmatter）
 *
 * 用法：
 *   node match-site.mjs "用户输入文本"
 *
 * 示例：
 *   node match-site.mjs "帮我搜一下 github 上的项目"
 *   → 输出 github.com.md 的经验内容（如有的话）
 *
 * 输出格式：
 *   --- 站点经验: github.com ---
 *   ## 平台特征
 *   ...
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 项目根目录（从当前文件向上回溯一级）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 站点经验文件存放目录（与项目目录分离，跨插件更新持久化）
const PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// 从命令行参数获取查询文本
const query = (process.argv[2] || '').trim();

// 没有查询文本 或 经验目录不存在 → 静默退出（不是错误，只是无匹配）
if (!query || !fs.existsSync(PATTERNS_DIR)) {
  process.exit(0);
}

// ── 遍历所有站点经验文件 ──────────────────────────────────────────
for (const entry of fs.readdirSync(PATTERNS_DIR, { withFileTypes: true })) {
  // 只处理 .md 文件
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

  // 文件名去掉 .md 后缀就是域名（如 github.com.md → github.com）
  const domain = entry.name.replace(/\.md$/, '');
  const raw = fs.readFileSync(path.join(PATTERNS_DIR, entry.name), 'utf8');

  // ── 解析 aliases（别名列表）──────────────────────────────────────
  // YAML frontmatter 格式：aliases: [别名1, 别名2]
  // 这里用简单的字符串匹配而非 YAML 解析器，避免引入依赖
  const aliasesLine = raw.split(/\r?\n/).find((l) => l.startsWith('aliases:')) || '';
  const aliases = aliasesLine
    .replace(/^aliases:\s*/, '')  // 去掉 "aliases: " 前缀
    .replace(/^\[/, '').replace(/\]$/, '')  // 去掉方括号
    .split(',')                    // 按逗号分割
    .map((v) => v.trim())          // 去空白
    .filter(Boolean);              // 去空字符串

  // ── 构造匹配正则 ─────────────────────────────────────────────────
  // 把域名和所有别名拼接成正则表达式（用 | 连接）
  // 例如 github.com + gh → /^(github\.com|gh)$/i
  const escaped = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 转义正则特殊字符
  const pattern = [domain, ...aliases].map(escaped).join('|');
  // 在用户输入中搜索域名/别名的出现
  if (!new RegExp(pattern, 'i').test(query)) continue;

  // ── 匹配成功，输出经验内容 ────────────────────────────────────────
  // 跳过 YAML frontmatter（--- ... --- 之间的内容），只输出正文
  const fences = [...raw.matchAll(/^---\s*$/gm)]; // 找到所有 "---" 行
  const body = fences.length >= 2
    ? raw.slice(fences[1].index + fences[1][0].length).replace(/^\r?\n/, '') // 取第二个 --- 之后的内容
    : raw; // 无 frontmatter 时输出全文

  // 输出格式：标题行 + 正文内容
  process.stdout.write(`--- 站点经验: ${domain} ---\n`);
  process.stdout.write(body.trimEnd() + '\n\n');
}
