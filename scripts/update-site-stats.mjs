#!/usr/bin/env node
/**
 * update-site-stats.mjs — 域名统计聚合与站点经验文件更新
 *
 * 从会话日志聚合域名维度的统计数据，更新站点经验文件的「## 自动统计」节。
 *
 * 用法：
 *   node update-site-stats.mjs                    # 更新所有域名
 *   node update-site-stats.mjs --domain github.com # 更新单个域名
 *   node update-site-stats.mjs --stats            # 仅打印统计摘要，不写入文件
 *
 * 数据流：
 *   ~/.sleuth/sessions/*.json（会话日志）
 *     → 按域名聚合（访问次数、成功率、死链、CAPTCHA、停留时间）
 *     → 计算统计指标（成功率、平均停留、Bayesian 可信度）
 *     → 写入 ~/.sleuth/site-patterns/<domain>.md 的「## 自动统计」节
 *
 * 自动统计节示例：
 *   ## 自动统计
 *   - 访问次数: 12
 *   - 成功率: 83% (10/12)
 *   - 死链数: 1
 *   - CAPTCHA 次数: 2
 *   - 平均停留: 5s
 *   - 最近访问: 2026-04-29
 *   - 可信度评分: 0.79
 *
 * Bayesian 可信度评分：
 *   公式：(successCount + 1) / (visitCount + 2)
 *   使用 Beta(1,1) 先验（均匀分布），
 *   效果是对访问量少的域名给予中间评分（接近 0.5），随数据量增加逐渐收敛到真实成功率。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// 项目根目录
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 会话日志目录
const SESSIONS_DIR = path.join(os.homedir(), '.sleuth', 'sessions');
// 站点经验文件目录
const PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// ── 参数解析 ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { domain: null, statsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--domain') a.domain = argv[++i];       // 指定单个域名
    else if (v === '--stats') a.statsOnly = true;      // 只打印不写入
    else if (v === '-h' || v === '--help') { printUsage(); process.exit(0); }
    else die(`未知参数: ${v}`);
  }
  return a;
}

function die(msg) { console.error(msg); process.exit(1); }

function printUsage() {
  const lines = [
    '用法：',
    '  node scripts/update-site-stats.mjs                     # 更新所有域名',
    '  node scripts/update-site-stats.mjs --domain github.com  # 更新单个域名',
    '  node scripts/update-site-stats.mjs --stats              # 仅打印统计摘要',
  ];
  console.error(lines.join('\n'));
}

// ── 域名提取工具 ──────────────────────────────────────────────────

/** 用于从 URL 中提取域名的正则 */
const DOMAIN_RE = /^(?:https?:\/\/)?(?:[^@\n]+@)?([^:\/\s?#]+)/i;

/**
 * 从 URL 或纯域名中提取域名。
 *
 * 处理两种输入：
 *   - 纯域名（如 "github.com"）→ 直接返回
 *   - URL（如 "https://github.com/user/repo"）→ 提取域名部分
 *
 * @param {string} urlOrDomain - URL 或域名
 * @returns {string|null} 小写域名或 null
 */
function extractDomain(urlOrDomain) {
  if (!urlOrDomain) return null;
  const s = String(urlOrDomain).trim();
  // 已经是纯域名（如 github.com）→ 直接返回
  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase();
  // 否则从 URL 提取域名
  const m = s.match(DOMAIN_RE);
  if (!m) return null;
  return m[1].toLowerCase();
}

// ── 会话日志读取 ──────────────────────────────────────────────────

/**
 * 读取单个会话日志文件，返回操作数组。
 *
 * 会话日志 JSON 支持多种格式：
 *   - 数组 → 直接作为 operations
 *   - { operations: [...] } → 取 .operations
 *   - { ops: [...] } → 取 .ops
 *   - 其他对象且包含 type 字段 → 当作单个 operation
 *
 * @param {string} filePath - session 文件路径
 * @returns {Array} 操作记录数组
 */
function readSessionLog(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`警告：跳过损坏的 JSON 文件: ${filePath}`);
    return [];
  }

  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.operations)) return data.operations;
    if (Array.isArray(data.ops)) return data.ops;
    if (data.type) return [data];
  }
  return [];
}

/**
 * 读取所有会话日志，返回按域名聚合的统计对象。
 *
 * 遍历 ~/.sleuth/sessions/ 下所有 .json 文件，对每条操作记录：
 *   - 提取域名
 *   - 根据 type 字段分类统计（visit / dead_link / captcha）
 *   - 记录时间戳（用于最近访问时间）
 *   - 记录停留时间（用于平均停留计算）
 *
 * @returns {Object} { domain: { visitCount, successCount, failureCount, deadLinkCount, captchaCount, dwellsMs, lastVisited } }
 */
function aggregateStats() {
  const domains = {};

  if (!fs.existsSync(SESSIONS_DIR)) return domains;

  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return domains;
  }

  for (const file of files) {
    const ops = readSessionLog(path.join(SESSIONS_DIR, file));
    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;
      const type = String(op.type || '').toLowerCase();
      const domain = extractDomain(op.domain || op.url || '');

      if (!domain) continue;

      // 初始化域名统计结构
      if (!domains[domain]) {
        domains[domain] = {
          visitCount: 0,
          successCount: 0,
          failureCount: 0,
          deadLinkCount: 0,
          captchaCount: 0,
          dwellsMs: [],       // 所有 visit 的 dwell_ms，用于计算平均值
          lastVisited: null,  // ISO 时间字符串，保留最新的
        };
      }

      const d = domains[domain];

      // 解析时间戳（取最新的作为 lastVisited）
      const ts = op.timestamp || op.ts || op.time || op.date;
      if (ts) {
        try {
          const t = new Date(ts);
          if (!Number.isNaN(t.getTime())) {
            if (!d.lastVisited || t > new Date(d.lastVisited)) {
              d.lastVisited = t.toISOString();
            }
          }
        } catch { /* 忽略无效时间戳 */ }
      }

      // 按 type 分类统计
      if (type === 'visit') {
        d.visitCount++;
        const success = op.extraction_success;
        if (success === true) {
          d.successCount++;
        } else if (success === false) {
          d.failureCount++;
        }
        // extraction_success 为 undefined → 只计入访问，不计成功/失败

        const dwell = op.dwell_ms;
        if (typeof dwell === 'number' && !Number.isNaN(dwell) && dwell >= 0) {
          d.dwellsMs.push(dwell);
        }
      } else if (type === 'dead_link') {
        d.deadLinkCount++;
      } else if (type === 'captcha') {
        d.captchaCount++;
      }
      // 其他 type 忽略
    }
  }

  return domains;
}

// ── 统计计算 ──────────────────────────────────────────────────────

/**
 * 从原始聚合数据计算最终统计指标。
 *
 * 计算的指标：
 *   - 成功率：successCount / visitCount * 100（百分比）
 *   - 平均停留时间：dwellsMs 平均值，毫秒转秒，四舍五入
 *   - 最近访问日期：lastVisited 截取 YYYY-MM-DD
 *   - Bayesian 可信度评分：(success+1)/(visits+2)，Beta(1,1) 先验
 *
 * @param {object} domainData - aggregateStats 返回的单域名数据
 * @returns {object} 计算后的统计指标
 */
function computeStats(domainData) {
  const d = domainData;
  const visitCount = d.visitCount;
  const successCount = d.successCount;
  const failureCount = d.failureCount;

  // 成功率（百分比，整数）
  const successRate = visitCount > 0
    ? Math.round((successCount / visitCount) * 100)
    : null;

  // 平均停留时间（毫秒 → 秒，四舍五入）
  const avgDwellSec = d.dwellsMs.length > 0
    ? Math.round(d.dwellsMs.reduce((a, b) => a + b, 0) / d.dwellsMs.length / 1000)
    : null;

  // 最近访问日期（YYYY-MM-DD）
  const lastVisitedDate = d.lastVisited
    ? new Date(d.lastVisited).toISOString().slice(0, 10)
    : null;

  // Bayesian 可信度评分：Beta(1,1) 先验
  // 访问量为 0 时评分 0.5（中性），随数据量增加收敛到真实成功率
  const credibilityScore = ((successCount + 1) / (visitCount + 2));

  return {
    visitCount,
    successCount,
    failureCount,
    deadLinkCount: d.deadLinkCount,
    captchaCount: d.captchaCount,
    successRate,
    avgDwellSec,
    lastVisitedDate,
    credibilityScore,
  };
}

// ── 自动统计节生成 ────────────────────────────────────────────────

/**
 * 根据统计数据生成 Markdown 格式的「## 自动统计」节。
 *
 * @param {object} stats - computeStats 返回的统计指标
 * @returns {string} Markdown 文本
 */
function buildStatsSection(stats) {
  const lines = ['## 自动统计'];

  lines.push(`- 访问次数: ${stats.visitCount}`);

  if (stats.successRate !== null) {
    lines.push(`- 成功率: ${stats.successRate}% (${stats.successCount}/${stats.visitCount})`);
  } else {
    lines.push(`- 成功率: N/A`);
  }

  lines.push(`- 死链数: ${stats.deadLinkCount}`);
  lines.push(`- CAPTCHA 次数: ${stats.captchaCount}`);

  if (stats.avgDwellSec !== null) {
    lines.push(`- 平均停留: ${stats.avgDwellSec}s`);
  } else {
    lines.push(`- 平均停留: N/A`);
  }

  if (stats.lastVisitedDate) {
    lines.push(`- 最近访问: ${stats.lastVisitedDate}`);
  } else {
    lines.push(`- 最近访问: N/A`);
  }

  lines.push(`- 可信度评分: ${stats.credibilityScore.toFixed(2)}`);

  return lines.join('\n');
}

// ── 站点经验文件更新 ──────────────────────────────────────────────

/** 自动统计节的标题行（用于在文件中定位） */
const AUTO_STATS_HEADING = '\n## 自动统计\n';

/**
 * 更新（或创建）站点经验文件的「## 自动统计」节。
 *
 * 处理三种情况：
 *   1. 文件不存在 → 创建完整的经验文件模板（frontmatter + 空章节 + 自动统计）
 *   2. 文件存在但没有自动统计节 → 追加到文件末尾
 *   3. 文件存在且已有自动统计节 → 替换该节（保留其他内容不变）
 *
 * @param {string} domain - 域名
 * @param {string} statsSection - buildStatsSection 生成的 Markdown 文本
 * @returns {{ action: string, path: string }} 操作结果和文件路径
 */
function updateSitePattern(domain, statsSection) {
  const filePath = path.join(PATTERNS_DIR, domain + '.md');

  // 确保目录存在
  if (!fs.existsSync(PATTERNS_DIR)) {
    try { fs.mkdirSync(PATTERNS_DIR, { recursive: true }); } catch { /* 并发竞争 */ }
  }

  // 情况 1：文件不存在 → 创建完整模板
  if (!fs.existsSync(filePath)) {
    const today = new Date().toISOString().slice(0, 10);
    const content = [
      '---',
      `domain: ${domain}`,
      'aliases: []',
      `updated: ${today}`,
      '---',
      '',
      '## 平台特征',
      '_待补充_',
      '',
      '## 有效模式',
      '_待补充_',
      '',
      '## 已知陷阱',
      '_待补充_',
      '',
      statsSection,
      '',
    ].join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');
    return { action: 'created', path: filePath };
  }

  // 读取现有文件
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`警告：无法读取 ${filePath}，跳过`);
    return { action: 'skipped', path: filePath };
  }

  // 在文件中查找「## 自动统计」节的位置
  let headingIdx = raw.indexOf('\n## 自动统计');
  if (headingIdx === -1 && raw.startsWith('## 自动统计')) {
    headingIdx = 0; // 文件开头就是该节
  }

  // 情况 2：文件中没有自动统计节 → 追加到末尾
  if (headingIdx === -1) {
    const trimmed = raw.trimEnd();
    const newContent = trimmed + '\n\n' + statsSection + '\n';
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { action: 'appended', path: filePath };
  }

  // 情况 3：替换现有的自动统计节
  // 定位节的起始和结束位置
  const sectionStart = headingIdx === 0 ? 0 : headingIdx + 1;
  let sectionEnd = raw.length;

  // 在自动统计节之后查找下一个 ## 标题（自动统计节到此结束）
  const headingLength = headingIdx === 0 ? '## 自动统计'.length : AUTO_STATS_HEADING.length;
  const searchStart = headingIdx === 0 ? headingLength : headingIdx + AUTO_STATS_HEADING.length;
  const remaining = raw.slice(searchStart);
  const nextHeadingMatch = remaining.match(/(^|\n)## /);

  if (nextHeadingMatch) {
    sectionEnd = searchStart + nextHeadingMatch.index;
  }

  // 拼接：之前的内容 + 新的自动统计节 + 之后的内容
  const before = raw.slice(0, sectionStart);
  let after = raw.slice(sectionEnd);
  const newContent = before + statsSection + after;
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return { action: 'updated', path: filePath };
}

// ── 输出格式化 ────────────────────────────────────────────────────

/** 打印单个域名的统计摘要 */
function printStatsSummary(domain, stats) {
  const lines = [
    `--- ${domain} ---`,
    `  访问次数:    ${stats.visitCount}`,
    `  成功/失败:   ${stats.successCount}/${stats.failureCount}` + (stats.successRate !== null ? ` (${stats.successRate}%)` : ''),
    `  死链数:     ${stats.deadLinkCount}`,
    `  CAPTCHA:    ${stats.captchaCount}`,
    `  平均停留:   ${stats.avgDwellSec !== null ? `${stats.avgDwellSec}s` : 'N/A'}`,
    `  最近访问:   ${stats.lastVisitedDate || 'N/A'}`,
    `  可信度评分: ${stats.credibilityScore.toFixed(2)}`,
  ];
  console.log(lines.join('\n'));
}

// ── 主流程 ────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  // 聚合所有 session 的统计数据
  const allDomains = aggregateStats();
  const domainNames = Object.keys(allDomains).sort();

  if (domainNames.length === 0) {
    console.log('没有找到任何会话日志数据。请先执行至少一次 agent-browser 操作。');
    return;
  }

  // 过滤：指定域名或全部
  const targets = args.domain
    ? (allDomains[args.domain] ? [args.domain] : [])
    : domainNames;

  if (args.domain && targets.length === 0) {
    console.log(`域名 "${args.domain}" 在会话日志中没有记录。`);
    return;
  }

  let updated = 0, created = 0, appended = 0;

  for (const domain of targets) {
    const stats = computeStats(allDomains[domain]);
    const section = buildStatsSection(stats);

    if (args.statsOnly) {
      // --stats 模式：只打印，不写文件
      printStatsSummary(domain, stats);
      console.log();
    } else {
      // 写入站点经验文件
      const result = updateSitePattern(domain, section);

      switch (result.action) {
        case 'created':  created++;  break;
        case 'updated':  updated++;  break;
        case 'appended': appended++; break;
        default: break;
      }

      printStatsSummary(domain, stats);

      if (result.action === 'created') {
        console.log(`  → 已创建: ${result.path}`);
      } else if (result.action === 'updated') {
        console.log(`  → 已更新: ${result.path}`);
      } else if (result.action === 'appended') {
        console.log(`  → 已追加: ${result.path}`);
      }

      console.log();
    }
  }

  // 打印汇总
  if (!args.statsOnly) {
    const total = created + updated + appended;
    const parts = [];
    if (updated > 0) parts.push(`${updated} 个更新`);
    if (created > 0) parts.push(`${created} 个新建`);
    if (appended > 0) parts.push(`${appended} 个追加`);
    if (total === 0) {
      console.log('没有文件被修改。');
    } else {
      console.log(`完成：${parts.join('，')}`);
    }
  }
}

main();
