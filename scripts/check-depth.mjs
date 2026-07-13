#!/usr/bin/env node
/**
 * check-depth.mjs — 深度门：检查搜索 Agent 产出够不够深。
 *
 * 在归一化前（phase 3-raw 之后、3-findings 之前）跑。
 * 读 raw/*.jsonl，按 agent 统计深度指标，不达标 → exit 1 + 报告哪家浅。
 *
 * 治 AOP 老问题 #2 的深层：「有 findings」≠「挖得深」。检查门不只查有没有，
 * 还查够不够深——每家 finding 总字符、独立 URL 数、短断言占比。
 *
 * 用法：
 *   node scripts/check-depth.mjs <task-dir>
 *
 * 退出码：0 通过 / 1 深度不足 / 2 参数错误
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 深度阈值（轻量版默认值）──────────────────────────────────
// 依据 2026-07-13 AOP 测试数据校准：
//   现状平均每 agent 2155 字符 / 6.5 URL，产出被用户判定「不如 ChatGPT」。
//   阈值设在略高于现状，逼 agent 提升密度。
const MIN_CHARS_PER_AGENT = 2000;    // 每 agent finding 总字符下限
const MIN_URLS_PER_AGENT = 5;        // 每 agent 独立 URL 下限
const MAX_SHORT_RATIO = 0.30;        // 短 finding（<200 字符）占比上限
const SHORT_FINDING_THRESHOLD = 200; // 短 finding 定义（字符）

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

// ── 参数解析 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const taskDir = args.find((a) => !a.startsWith('--'));

if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/check-depth.mjs <task-dir>');
  log('');
  log('深度门：检查 raw/*.jsonl 每个搜索 agent 的产出深度。');
  log(`阈值：每 agent ≥ ${MIN_CHARS_PER_AGENT} 字符 / ≥ ${MIN_URLS_PER_AGENT} URL / 短断言 ≤ ${Math.round(MAX_SHORT_RATIO * 100)}%`);
  process.exit(taskDir ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const rawDir = path.join(dir, 'raw');
const failures = [];

if (!fs.existsSync(rawDir)) {
  err(`✗ 深度门：raw/ 目录不存在（${rawDir}）`);
  process.exit(2);
}

// ── 分析每个 raw 文件 ───────────────────────────────────────

const rawFiles = fs.readdirSync(rawDir)
  .filter((f) => f.endsWith('.jsonl') && f.startsWith('search-'))
  .sort();

if (rawFiles.length === 0) {
  err('✗ 深度门：raw/ 下没有 search-*.jsonl 文件');
  process.exit(2);
}

const stats = [];

for (const file of rawFiles) {
  const filePath = path.join(rawDir, file);
  const agentName = file.replace(/^search-/, '').replace(/\.jsonl$/, '');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);

  let findings = 0;
  let gaps = 0;
  let redFlags = 0;
  let totalChars = 0;
  let shortFindings = 0;
  const urls = new Set();

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;  // 坏行归 normalize 管，深度门不重复报
    }
    const type = parsed.type;
    if (type === 'finding') {
      findings++;
      const claim = parsed.claim || '';
      totalChars += claim.length;
      if (claim.length < SHORT_FINDING_THRESHOLD) shortFindings++;
      if (parsed.url) urls.add(parsed.url);
    } else if (type === 'gap') {
      gaps++;
    } else if (type === 'red_flag') {
      redFlags++;
    }
    // agent_done sentinel 不计
  }

  const shortRatio = findings > 0 ? shortFindings / findings : 0;
  const agentStats = {
    name: agentName,
    file,
    findings,
    gaps,
    redFlags,
    totalChars,
    uniqueUrls: urls.size,
    shortRatio: Math.round(shortRatio * 100) / 100,
    issues: [],
  };

  // 逐项检查
  if (totalChars < MIN_CHARS_PER_AGENT) {
    agentStats.issues.push(`字符 ${totalChars} < ${MIN_CHARS_PER_AGENT}`);
  }
  if (urls.size < MIN_URLS_PER_AGENT) {
    agentStats.issues.push(`URL ${urls.size} < ${MIN_URLS_PER_AGENT}`);
  }
  if (findings > 0 && shortRatio > MAX_SHORT_RATIO) {
    agentStats.issues.push(`短断言占比 ${Math.round(shortRatio * 100)}% > ${Math.round(MAX_SHORT_RATIO * 100)}%`);
  }
  if (findings === 0 && gaps === 0 && redFlags === 0) {
    agentStats.issues.push('零产出（无 finding/gap/red_flag）');
  }

  if (agentStats.issues.length > 0) {
    failures.push(agentStats);
  }
  stats.push(agentStats);
}

// ── 输出报告 ────────────────────────────────────────────────

log('深度门（check-depth）');
log('─────────────────────────────');
log(`agent 数: ${stats.length}`);
log(`阈值: 每 agent ≥ ${MIN_CHARS_PER_AGENT} 字符 / ≥ ${MIN_URLS_PER_AGENT} URL / 短断言 ≤ ${Math.round(MAX_SHORT_RATIO * 100)}%`);
log('');

// 总览表
const totalFindings = stats.reduce((s, a) => s + a.findings, 0);
const totalChars = stats.reduce((s, a) => s + a.totalChars, 0);
const totalUrls = stats.reduce((s, a) => s + a.uniqueUrls, 0);
log(`汇总: ${totalFindings} findings / ${totalChars} 字符 / ${totalUrls} URL`);
log(`平均每 agent: ${Math.round(totalChars / stats.length)} 字符 / ${Math.round(totalUrls / stats.length)} URL`);
log('');

// 逐 agent 明细
log('逐 agent 明细:');
log(`${'agent'.padEnd(16)} ${'finding'.padStart(7)} ${'字符'.padStart(7)} ${'URL'.padStart(5)} ${'短占比'.padStart(6)}  状态`);
log('-'.repeat(60));
for (const a of stats) {
  const status = a.issues.length === 0 ? '✓' : `✗ ${a.issues.join('; ')}`;
  log(`${a.name.padEnd(16)} ${String(a.findings).padStart(7)} ${String(a.totalChars).padStart(7)} ${String(a.uniqueUrls).padStart(5)} ${String(Math.round(a.shortRatio * 100) + '%').padStart(6)}  ${status}`);
}

// 失败详情
if (failures.length > 0) {
  log('');
  err(`✗ 深度门未通过：${failures.length}/${stats.length} 个 agent 深度不足`);
  for (const a of failures) {
    err(`  - ${a.name}（${a.file}）: ${a.issues.join('；')}`);
  }
  err('');
  err('深度不足的 agent 需要重派，重派时关注：');
  err('  1. 每条 finding ≥ 200 字符（是什么+为什么+限制+场景影响，不是只甩结论）');
  err('  2. 多读独立页面（同一 URL 重复引用不算新来源）');
  err('  3. 宁可 5 条深度 finding，不要 15 条浅断言');
  process.exit(1);
}

log('');
log(`✓ 深度门通过：全部 ${stats.length} 个 agent 深度达标`);
process.exit(0);
