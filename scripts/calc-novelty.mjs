#!/usr/bin/env node
/** 依据 findings 的 rounds_seen 计算多轮信息增益，并写入 progress.json。 */

import fs from 'node:fs';
import path from 'node:path';

function log(message) { console.log(message); }
function err(message) { console.error(message); }

const taskDir = process.argv[2];
if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/calc-novelty.mjs <task-dir>');
  process.exit(taskDir ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const findingsPath = path.join(dir, 'findings.jsonl');
if (!fs.existsSync(findingsPath)) {
  err('✗ findings.jsonl 不存在，先运行 normalize.mjs');
  process.exit(1);
}

const rows = fs.readFileSync(findingsPath, 'utf8').split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter((row) => row?.type === 'finding');

const rounds = new Map();
for (const row of rows) {
  const appearances = Array.isArray(row.rounds_seen) && row.rounds_seen.length
    ? row.rounds_seen
    : (Number.isInteger(row.round) && row.round > 0 ? [row.round] : []);
  for (const round of appearances) {
    if (!rounds.has(round)) rounds.set(round, new Set());
    rounds.get(round).add(row.claim_id || row.claim_key);
  }
}

const orderedRounds = [...rounds.keys()].sort((a, b) => a - b);
const noveltyByRound = {};
const cumulative = new Set();
for (const round of orderedRounds) {
  const claims = rounds.get(round);
  const novel = [...claims].filter((claim) => !cumulative.has(claim));
  noveltyByRound[round] = {
    round,
    claim_count: claims.size,
    novel_count: novel.length,
    novelty_ratio: claims.size ? Math.round((novel.length / claims.size) * 100) / 100 : 0,
  };
  for (const claim of claims) cumulative.add(claim);
}

let staleCount = 0;
for (let index = orderedRounds.length - 1; index >= 0; index--) {
  if (noveltyByRound[orderedRounds[index]].novel_count === 0) staleCount++;
  else break;
}

const recentThree = orderedRounds.slice(-3).map((round) => noveltyByRound[round]);
const nonIncreasing = recentThree.length === 3
  && recentThree.every((item, index) => index === 0 || item.novel_count <= recentThree[index - 1].novel_count);
const lastNoveltyRatio = recentThree.at(-1)?.novelty_ratio ?? 1;
const ruleA = staleCount >= 2;
const ruleB = orderedRounds.length >= 5 && nonIncreasing && lastNoveltyRatio < 0.2;
const convergence = {
  rule_a: ruleA,
  rule_b: ruleB,
  recommended: ruleA || ruleB,
  reason: ruleA ? '连续两轮没有新事实' : (ruleB ? '至少五轮且最近三轮信息增益持续不升、末轮信息增益低于20%' : null),
  last_novelty_ratio: lastNoveltyRatio,
  recent_novel_counts: recentThree.map((item) => item.novel_count),
};

log('反认知循环计算');
for (const round of orderedRounds) {
  const item = noveltyByRound[round];
  log(`Round ${round}: ${item.claim_count} 个事实，${item.novel_count} 个新增（${Math.round(item.novelty_ratio * 100)}%）`);
}
log(`Rule A: ${ruleA ? '触发' : '未触发'}；Rule B: ${ruleB ? '触发' : '未触发'}`);
log(`建议：${convergence.recommended ? '终止搜索' : '继续评估'}`);

const progressPath = path.join(dir, 'progress.json');
let progress = {};
if (fs.existsSync(progressPath)) {
  try { progress = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch { progress = {}; }
}
progress.schema_version = 2;
progress.started_at ||= new Date().toISOString();
progress.current_phase ||= 'loop';
progress.current_round = orderedRounds.at(-1) || null;
progress.last_seen = new Date().toISOString();
progress.stale_count = staleCount;
progress.revision_count ||= 0;
progress.stats = {
  total_findings: rows.length,
  total_t1: rows.filter((row) => row.tier === 'T1').length,
  rounds_completed: orderedRounds.length,
};
progress.novelty_by_round = noveltyByRound;
progress.convergence = convergence;
progress.termination_reason ??= null;
fs.writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
