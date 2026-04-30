#!/usr/bin/env node
/**
 * on-stop.mjs — Claude Code Stop hook 脚本
 *
 * 触发时机：Claude Code 主对话结束时自动执行（由 hooks/hooks.json 注册）。
 * 也可手动运行：node scripts/on-stop.mjs
 *
 * 三项自动清理任务：
 *
 *   ① 关闭未完成的 session
 *      扫描 ~/.sleuth/sessions/ 下所有 session 文件，
 *      将 finished: null 的 session 标记为 outcome: "partial" 并写入当前时间戳。
 *      场景：Agent 忘记执行 finish 命令，Stop hook 兜底处理。
 *
 *   ② 为复杂站点创建经验 stub
 *      从刚关闭的 session 中提取域名，判断是否满足以下任一条件：
 *        - 操作中包含 CAPTCHA、登录墙、付费墙、反爬等复杂操作
 *        - 该域名累计出现在 3 个以上不同 session 中（高频访问）
 *      对满足条件且尚无经验文件的域名，创建 stub（含 YAML frontmatter 的空模板）。
 *      然后调用 update-site-stats.mjs 为这些域名刷新统计。
 *      排除搜索引擎域名（google.com、bing.com 等）。
 *
 *   ③ 关闭残留浏览器 tab
 *      执行 agent-browser close --all 关闭所有残留 tab。
 *      场景：子 Agent 创建了 tab 但忘记关闭。
 *
 * 输出：静默模式，正常无输出，仅异常时打印警告。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ── 路径常量 ──────────────────────────────────────────────────────

// 项目根目录（用于定位 update-site-stats.mjs）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// session 文件存储目录
const SESSIONS_DIR = path.join(os.homedir(), '.sleuth', 'sessions');
// 站点经验文件存储目录
const PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// ── 过滤常量 ──────────────────────────────────────────────────────

// 搜索引擎域名 → 不创建经验文件（它们没有"站点经验"可言）
const SEARCH_ENGINES = new Set([
  'google.com', 'google.com.hk', 'bing.com',
  'baidu.com', 'duckduckgo.com', 'yahoo.com',
]);

// 复杂操作类型 → 遇到这些操作的域名值得记录经验
const COMPLEX_OP_TYPES = new Set([
  'captcha',      // CAPTCHA 验证码
  'login_wall',   // 登录墙（需要登录才能看内容）
  'paywall',      // 付费墙（需要付费订阅）
  'anti_bot',     // 反爬虫检测
]);

// 域名合法格式正则（至少两级域名，如 example.com）
const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

// 域名累计出现次数阈值 → 超过此值的域名也值得记录经验
const DOMAIN_FREQUENCY_THRESHOLD = 3;

// ── ① 关闭未完成的 session ─────────────────────────────────────────

/**
 * 扫描 sessions 目录，将所有 finished: null 的 session 标记为 partial 并关闭。
 *
 * @returns {Array} 被关闭的 session 对象列表（后续用于判断复杂站点）
 */
function finishOrphanSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];

  const finished = [];
  const entries = readdirSync(SESSIONS_DIR).filter(e => e.endsWith('.json'));

  for (const entry of entries) {
    const filePath = path.join(SESSIONS_DIR, entry);
    let session;
    try {
      session = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch { continue; } // 跳过损坏的 JSON 文件

    // 只处理未完成的 session
    if (session.finished === null || session.finished === undefined) {
      session.finished = new Date().toISOString(); // 写入关闭时间
      session.outcome = session.outcome || 'partial'; // 没有结果 → 标记为"部分完成"
      try {
        writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
        finished.push(session);
      } catch { /* 权限不足则跳过 */ }
    }
  }
  return finished;
}

// ── ② 提取域名并判断复杂站点 ────────────────────────────────────────

/**
 * 从字符串（URL 或路径）中提取域名。
 *
 * 处理逻辑：
 *   1. 尝试匹配 URL 中的域名部分（去掉 http:// 和 www.）
 *   2. 校验域名格式合法
 *   3. 过滤掉文件扩展名误匹配（如 file.json、output.md）
 *
 * @param {string} str - 可能包含 URL 或域名的字符串
 * @returns {string|null} 域名（小写）或 null
 */
function extractDomain(str) {
  if (!str || typeof str !== 'string') return null;
  // 从 URL 中提取域名（去掉协议和 www.）
  const match = str.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/);
  const candidate = match ? match[1].toLowerCase() : null;
  if (!candidate) return null;
  // 校验域名格式
  if (!DOMAIN_REGEX.test(candidate)) return null;
  // 过滤文件扩展名误匹配（如 "file.json" 不是域名）
  const FILE_EXTS = new Set([
    'json', 'md', 'txt', 'csv', 'html', 'xml', 'yaml', 'yml', 'log',
    'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mp3', 'zip',
    'gz', 'js', 'ts', 'css', 'py', 'rb', 'go',
  ]);
  const parts = candidate.split('.');
  if (parts.length === 2 && FILE_EXTS.has(parts[1])) return null;
  return candidate;
}

/**
 * 从 session 的操作记录中提取遇到复杂操作的域名。
 *
 * 判断条件：操作的 type 或 content_type 字段属于 COMPLEX_OP_TYPES。
 *
 * @param {object} session - session 数据对象
 * @returns {Set<string>} 复杂操作的域名集合
 */
function getComplexDomainsFromSession(session) {
  const domains = new Set();
  for (const op of session.operations || []) {
    if (COMPLEX_OP_TYPES.has(op.type) || COMPLEX_OP_TYPES.has(op.content_type)) {
      if (op.domain) domains.add(op.domain);
    }
  }
  return domains;
}

/**
 * 从 session 的操作记录中提取所有出现过的域名。
 * 从 op.domain、op.source、op.file 三个字段提取。
 *
 * @param {object} session - session 数据对象
 * @returns {Set<string>} 域名集合
 */
function getDomainsFromSession(session) {
  const domains = new Set();
  for (const op of session.operations || []) {
    if (op.domain) domains.add(op.domain);
    if (op.source) {
      const d = extractDomain(op.source);
      if (d) domains.add(d);
    }
    if (op.file) {
      const d = extractDomain(op.file);
      if (d) domains.add(d);
    }
  }
  return domains;
}

/**
 * 统计所有 session 中每个域名的出现次数（跨 session 计数）。
 * 用于判断域名是否属于高频访问（>= DOMAIN_FREQUENCY_THRESHOLD）。
 *
 * @returns {Object} 域名 → 出现次数的映射
 */
function countDomainFrequency() {
  const freq = {};
  if (!existsSync(SESSIONS_DIR)) return freq;
  for (const entry of readdirSync(SESSIONS_DIR).filter(e => e.endsWith('.json'))) {
    try {
      const session = JSON.parse(readFileSync(path.join(SESSIONS_DIR, entry), 'utf-8'));
      for (const d of getDomainsFromSession(session)) {
        freq[d] = (freq[d] || 0) + 1;
      }
    } catch {}
  }
  return freq;
}

/**
 * 为给定域名创建站点经验 stub 文件。
 *
 * stub 是一个包含 YAML frontmatter 的空模板，后续由 Agent 或 update-site-stats.mjs 填充。
 * 已存在经验文件的域名会被跳过（不覆盖已有经验）。
 *
 * @param {Set<string>} domains - 需要创建 stub 的域名集合
 * @returns {Array<string>} 实际创建了 stub 的域名列表
 */
function createSitePatternStubs(domains) {
  if (!existsSync(PATTERNS_DIR)) mkdirSync(PATTERNS_DIR, { recursive: true });
  const created = [];
  for (const domain of domains) {
    const filePath = path.join(PATTERNS_DIR, `${domain}.md`);
    if (existsSync(filePath)) continue; // 已有经验文件 → 跳过

    const today = new Date().toISOString().slice(0, 10);
    // stub 模板：frontmatter + 空的三个经验章节
    const stub = [
      '---',
      `domain: ${domain}`,
      `aliases: []`,
      `updated: ${today}`,
      '---',
      '',
      '## 平台特征',   // 架构、反爬行为、登录需求等
      '',
      '## 有效模式',   // 已验证的 URL 模式、操作策略
      '',
      '## 已知陷阱',   // 什么会失败以及为什么
      '',
    ].join('\n');
    try {
      writeFileSync(filePath, stub, 'utf-8');
      created.push(domain);
    } catch { /* 权限不足则跳过 */ }
  }
  return created;
}

// ── ③ 关闭残留浏览器 tab ────────────────────────────────────────────

/**
 * 关闭所有 agent-browser 创建的残留 tab。
 * 静默执行，agent-browser 不可用或无 tab 时也不报错。
 */
function closeBrowserTabs() {
  try {
    execSync('agent-browser close --all 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
  } catch { /* 无 tab 或 agent-browser 不可用 */ }
}

// ── 主流程 ────────────────────────────────────────────────────────

async function main() {
  // ① 关闭所有未完成的 session（收集被关闭的列表供下一步使用）
  const finished = finishOrphanSessions();

  // ② 收集需要记录经验的域名
  const candidateDomains = new Set();
  const freq = countDomainFrequency();

  for (const session of finished) {
    // 条件 A：该 session 中有复杂操作（CAPTCHA 等）的域名
    const complexDomains = getComplexDomainsFromSession(session);
    for (const d of complexDomains) {
      if (SEARCH_ENGINES.has(d)) continue; // 排除搜索引擎
      candidateDomains.add(d);
    }
    // 条件 B：该域名累计出现在 3+ 个 session 中（高频访问，值得记录）
    const domains = getDomainsFromSession(session);
    for (const d of domains) {
      if (SEARCH_ENGINES.has(d)) continue;
      if ((freq[d] || 0) >= DOMAIN_FREQUENCY_THRESHOLD) {
        candidateDomains.add(d);
      }
    }
  }

  // 为符合条件的域名创建 stub 文件
  const created = createSitePatternStubs(candidateDomains);

  // 为新建 stub 的域名刷新统计数据（不跑全量，只为新域名创建）
  for (const domain of created) {
    try {
      execSync(`node "${path.join(ROOT, 'scripts', 'update-site-stats.mjs')}" --domain "${domain}"`, {
        timeout: 10000, stdio: 'ignore',
      });
    } catch {}
  }

  // ③ 关闭残留的浏览器 tab
  closeBrowserTabs();
}

main().catch(() => process.exit(0));
