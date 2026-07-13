#!/usr/bin/env node
/**
 * calc-novelty.mjs — 反认知循环计算器。
 *
 * 读 findings.jsonl → 按 round 分组 → 算 novelty_ratio + stale_count。
 * 主 Agent 用输出判断终止（stale_count >= 2 → 硬饱和兜底，强制终止）。
 *
 * 用法：node scripts/calc-novelty.mjs <task-dir>
 * 输出：stdout 可审计字符串 + 更新 progress.json 的 stale_count
 */

import fs from 'node:fs';
import path from 'node:path';

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

const taskDir = process.argv[2];

if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/calc-novelty.mjs <task-dir>');
  log('功能：读 findings.jsonl → 算 novelty_ratio + stale_count → 更新 progress.json');
  process.exit(taskDir ? 0 : 2);
}

const resolvedDir = taskDir.replace(/^~/, process.env.HOME || '');
const findingsPath = path.join(resolvedDir, 'findings.jsonl');

if (!fs.existsSync(findingsPath)) {
  err(`✗ findings.jsonl 不存在: ${findingsPath}`);
  err('  先跑 normalize.mjs');
  process.exit(1);
}

// 1. 读 findings.jsonl
const lines = fs.readFileSync(findingsPath, 'utf8').trim().split('\n').filter(Boolean);

// 2. 按 round 分组，收集 claim_id 集合
const rounds = {};  // { 1: Set<claim_id>, 2: Set<claim_id>, ... }
const allClaimIds = new Set();
let totalFindings = 0;
let totalT1 = 0;

for (const line of lines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  if (row.type !== 'finding') continue;

  totalFindings++;
  if (row.tier === 'T1') totalT1++;

  const round = row.round || 1;
  if (!rounds[round]) rounds[round] = new Set();
  if (row.claim_id) {
    rounds[round].add(row.claim_id);
    allClaimIds.add(row.claim_id);
  }
}

// 3. 算每轮的 novelty
const sortedRounds = Object.keys(rounds).map(Number).sort((a, b) => a - b);
const noveltyByRound = {};
let cumulativeSet = new Set();
let lastNovelty = 0;
let maxRound = 0;

for (const r of sortedRounds) {
  maxRound = r;
  const roundSet = rounds[r];
  const previousUnion = new Set(cumulativeSet);
  const novelCount = [...roundSet].filter((id) => !previousUnion.has(id)).length;
  const noveltyRatio = roundSet.size > 0 ? novelCount / roundSet.size : 0;

  noveltyByRound[r] = {
    round: r,
    claim_count: roundSet.size,
    novel_count: novelCount,
    novelty_ratio: Math.round(noveltyRatio * 100) / 100,
  };

  lastNovelty = novelCount;
  cumulativeSet = new Set([...cumulativeSet, ...roundSet]);
}

// 4. 算 stale_count（连续 0 新 findings 的轮数，从最后一轮往前数）
let staleCount = 0;
for (let i = sortedRounds.length - 1; i >= 0; i--) {
  const r = sortedRounds[i];
  if (noveltyByRound[r].novel_count === 0) {
    staleCount++;
  } else {
    break;
  }
}

// 5. 输出可审计字符串
const terminateFlag = staleCount >= 2 ? 'TERMINATE_RECOMMENDED' : 'CONTINUE';

log('');
log('反认知循环计算（calc-novelty）');
log('─────────────────────────────');
log(`总 findings: ${totalFindings}（T1: ${totalT1}）`);
log(`总 rounds: ${sortedRounds.length}`);
log('');

for (const r of sortedRounds) {
  const n = noveltyByRound[r];
  const marker = n.novel_count === 0 ? ' ⚠ stale' : '';
  log(`  Round ${r}: ${n.claim_count} claims, ${n.novel_count} 新增 (${Math.round(n.novelty_ratio * 100)}% novelty)${marker}`);
}

log('');
log(`stale_count: ${staleCount}（连续 ${staleCount} 轮 0 新事实）`);
log(`TERMINATION: novelty_diff=${cumulativeSet.size} stale=${staleCount} source=calc-novelty`);
log(`判定: ${terminateFlag}`);
if (terminateFlag === 'TERMINATE_RECOMMENDED') {
  log('  → stale_count >= 2（硬饱和兜底）——建议终止 LOOP');
}

// 6. 更新 progress.json
const progressPath = path.join(resolvedDir, 'progress.json');
if (fs.existsSync(progressPath)) {
  try {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    progress.stale_count = staleCount;
    if (!progress.stats) progress.stats = {};
    progress.stats.total_findings = totalFindings;
    progress.stats.total_t1 = totalT1;
    progress.stats.rounds_completed = sortedRounds.length;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
  } catch {
    // progress.json 格式不对——不阻塞，只输出 stdout
  }
} else {
  // 没有 progress.json——创建初始的
  const initial = {
    started_at: new Date().toISOString(),
    current_phase: 'loop',
    current_round: maxRound,
    last_seen: new Date().toISOString(),
    stale_count: staleCount,
    revision_count: 0,
    stats: {
      total_findings: totalFindings,
      total_t1: totalT1,
      rounds_completed: sortedRounds.length,
    },
    termination_reason: null,
  };
  fs.writeFileSync(progressPath, JSON.stringify(initial, null, 2), 'utf8');
  log('');
  log('⚠ 创建了初始 progress.json（之前不存在）');
}
