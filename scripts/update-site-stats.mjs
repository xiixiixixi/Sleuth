#!/usr/bin/env node
// update-site-stats — 从会话日志聚合域名统计，更新站点经验文件的 ## 自动统计 节
//
// 用法：
//   node scripts/update-site-stats.mjs                    # 更新所有域名
//   node scripts/update-site-stats.mjs --domain github.com # 更新单个域名
//   node scripts/update-site-stats.mjs --stats              # 仅打印统计摘要，不写入文件
//
// 统计数据来源：~/.sleuth/sessions/ 下的会话日志 JSON 文件
// 目标文件：~/.sleuth/site-patterns/<domain>.md

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS_DIR = path.join(os.homedir(), '.sleuth', 'sessions');
const PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// --- 参数解析 ---------------------------------------------------------------
function parseArgs(argv) {
  const a = { domain: null, statsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--domain') a.domain = argv[++i];
    else if (v === '--stats') a.statsOnly = true;
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

// --- 域名提取工具 -----------------------------------------------------------
const DOMAIN_RE = /^(?:https?:\/\/)?(?:[^@\n]+@)?([^:\/\s?#]+)/i;

function extractDomain(urlOrDomain) {
  if (!urlOrDomain) return null;
  const s = String(urlOrDomain).trim();
  // 如果已经是纯域名就直接返回
  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase();
  // 否则从 URL 提取
  const m = s.match(DOMAIN_RE);
  if (!m) return null;
  return m[1].toLowerCase();
}

// --- 会话日志读取 -----------------------------------------------------------

/**
 * 读取单个会话日志文件，返回操作数组。
 * 会话日志 JSON 结构：
 *   - 数组            → 直接作为 operations
 *   - { operations }  → 取 .operations 数组
 *   - { ops }         → 取 .ops 数组
 *   - 其他对象         → 如果顶层包含 type 字段，作为单个 operation
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
 */
function aggregateStats() {
  const domains = {}; // { domain: { visits, successes, failures, deadLinks, captchas, dwellsMs, lastVisited } }

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

      // 初始化域名统计
      if (!domains[domain]) {
        domains[domain] = {
          visitCount: 0,
          successCount: 0,
          failureCount: 0,
          deadLinkCount: 0,
          captchaCount: 0,
          dwellsMs: [],           // 所有 visit 的 dwell_ms，用于计算平均
          lastVisited: null,      // ISO 时间字符串，保留最新的
        };
      }

      const d = domains[domain];

      // 解析时间戳
      const ts = op.timestamp || op.ts || op.time || op.date;
      if (ts) {
        try {
          const t = new Date(ts);
          if (!Number.isNaN(t.getTime())) {
            if (!d.lastVisited || t > new Date(d.lastVisited)) {
              d.lastVisited = t.toISOString();
            }
          }
        } catch { /* ignore bad timestamps */ }
      }

      if (type === 'visit') {
        d.visitCount++;
        const success = op.extraction_success;
        if (success === true) {
          d.successCount++;
        } else if (success === false) {
          d.failureCount++;
        }
        // else: undefined extraction_success — count as visit but not success/failure

        const dwell = op.dwell_ms;
        if (typeof dwell === 'number' && !Number.isNaN(dwell) && dwell >= 0) {
          d.dwellsMs.push(dwell);
        }
      } else if (type === 'dead_link') {
        d.deadLinkCount++;
      } else if (type === 'captcha') {
        d.captchaCount++;
      }
      // 忽略其他 operation 类型
    }
  }

  return domains;
}

// --- 统计计算 ---------------------------------------------------------------

function computeStats(domainData) {
  const d = domainData;
  const visitCount = d.visitCount;
  const successCount = d.successCount;
  const failureCount = d.failureCount;

  // 成功率
  const successRate = visitCount > 0
    ? Math.round((successCount / visitCount) * 100)
    : null;

  // 平均停留时间 (ms → s)，四舍五入到整数秒
  const avgDwellSec = d.dwellsMs.length > 0
    ? Math.round(d.dwellsMs.reduce((a, b) => a + b, 0) / d.dwellsMs.length / 1000)
    : null;

  // 最近访问日期
  const lastVisitedDate = d.lastVisited
    ? new Date(d.lastVisited).toISOString().slice(0, 10) // YYYY-MM-DD
    : null;

  // Bayesian 可信度评分: (success + 1) / (visits + 2)，Beta(1,1) 先验
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

// --- 自动统计节生成 ---------------------------------------------------------

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

// --- 站点经验文件更新 -------------------------------------------------------

const AUTO_STATS_HEADING = '\n## 自动统计\n';

/**
 * 更新（或创建）站点的自动统计节。
 * 返回 { action: 'updated' | 'created' | 'appended' | 'skipped' }
 */
function updateSitePattern(domain, statsSection) {
  const filePath = path.join(PATTERNS_DIR, domain + '.md');

  if (!fs.existsSync(PATTERNS_DIR)) {
    try { fs.mkdirSync(PATTERNS_DIR, { recursive: true }); } catch { /* race */ }
  }

  if (!fs.existsSync(filePath)) {
    // 创建新的站点经验文件（含完整模板：frontmatter + 定性章节 + 自动统计）
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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

  // 尝试读取并解析现有文件
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`警告：无法读取 ${filePath}，跳过`);
    return { action: 'skipped', path: filePath };
  }

  // Check for the heading at position 0 or after a newline
  let headingIdx = raw.indexOf('\n## 自动统计');
  if (headingIdx === -1 && raw.startsWith('## 自动统计')) {
    headingIdx = 0;
  }

  if (headingIdx === -1) {
    // 文件中没有自动统计节 → 追加到末尾
    const trimmed = raw.trimEnd();
    const newContent = trimmed + '\n\n' + statsSection + '\n';
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { action: 'appended', path: filePath };
  }

  // 找到自动统计节，并找出下一个 ## 标题的位置
  const sectionStart = headingIdx === 0 ? 0 : headingIdx + 1; // 从 ## 开始
  let sectionEnd = raw.length;

  // 在自动统计节之后查找下一个 ## 标题
  const headingLength = headingIdx === 0 ? '## 自动统计'.length : AUTO_STATS_HEADING.length;
  const searchStart = headingIdx === 0 ? headingLength : headingIdx + AUTO_STATS_HEADING.length;
  const remaining = raw.slice(searchStart);
  const nextHeadingMatch = remaining.match(/(^|\n)## /);

  if (nextHeadingMatch) {
    const matchOffset = nextHeadingMatch.index;
    // 下一个 ## 在 raw 中的位置
    sectionEnd = searchStart + matchOffset;
    // 去掉前导的换行符（保留下一个 section 前面的 \n）
    if (remaining[matchOffset] === '\n') {
      sectionEnd = searchStart + matchOffset; // 保留 \n
    } else {
      sectionEnd = searchStart + matchOffset;
    }
  }

  // 构建新内容：之前的内容 + 新的自动统计 + 之后的内容
  const before = raw.slice(0, sectionStart);
  let after = raw.slice(sectionEnd);

  // 确保 after 以换行开头（如果有内容的话）
  const newContent = before + statsSection + after;
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return { action: 'updated', path: filePath };
}

// --- 输出格式化 -------------------------------------------------------------

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

// --- 主流程 -----------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  const allDomains = aggregateStats();
  const domainNames = Object.keys(allDomains).sort();

  if (domainNames.length === 0) {
    console.log('没有找到任何会话日志数据。请先执行至少一次 agent-browser 操作。');
    return;
  }

  // 过滤域名
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
      printStatsSummary(domain, stats);
      console.log(); // 空行分隔
    } else {
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
