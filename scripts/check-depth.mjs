#!/usr/bin/env node
/**
 * check-depth.mjs — 检查证据结构和跨轮递进，而不是用总字数冒充深度。
 */

import fs from 'node:fs';
import path from 'node:path';

const RELATIONSHIPS_BY_TYPE = {
  comparison: new Set(['compares']),
  deep_dive: new Set(['extends']),
  timeline: new Set(['follows', 'causes']),
  causal: new Set(['causes', 'complements', 'contradicts']),
  problem_solving: new Set(['bounds', 'compares', 'complements']),
  enumeration: new Set(['complements']),
  debate: new Set(['contradicts', 'complements']),
};

function log(message) { console.log(message); }
function err(message) { console.error(message); }

const taskDir = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/check-depth.mjs <task-dir>');
  process.exit(taskDir ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const rawDir = path.join(dir, 'raw');
if (!fs.existsSync(rawDir)) {
  err('✗ raw/ 目录不存在');
  process.exit(2);
}

let taskType = 'general';
try {
  const spec = fs.readFileSync(path.join(dir, 'task_spec.md'), 'utf8');
  taskType = spec.match(/task_type\s*[:：]\s*`?([a-z_]+)/i)?.[1] || 'general';
} catch { /* phase 2 会处理缺 task_spec */ }

const files = fs.readdirSync(rawDir).filter((file) => /^search-r\d+-.+\.jsonl$/.test(file)).sort();
if (files.length === 0) {
  err('✗ raw/ 没有带轮次的 search-r<轮次>-<agent>.jsonl');
  process.exit(2);
}

const agents = [];
const failures = [];
for (const file of files) {
  const match = file.match(/^search-r(\d+)-(.+)\.jsonl$/);
  const round = Number(match[1]);
  const name = match[2];
  const rows = fs.readFileSync(path.join(rawDir, file), 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const findings = rows.filter((row) => row.type === 'finding');
  const gaps = rows.filter((row) => row.type === 'gap');
  const redFlags = rows.filter((row) => row.type === 'red_flag');
  const issues = [];
  const warnings = [];
  const claimKeys = findings.map((row) => row.claim_key).filter(Boolean);
  const duplicateKeys = claimKeys.filter((key, index) => claimKeys.indexOf(key) !== index);
  const domains = new Set();
  for (const finding of findings) {
    for (const source of finding.sources || []) {
      try { domains.add(new URL(source.url).hostname.replace(/^www\./, '')); } catch { /* phase 3-raw 报 URL 问题 */ }
    }
    if ((finding.claim || '').length < 200) warnings.push(`${finding.claim_key || '(无 claim_key)'} 的说明少于 200 字符`);
  }

  if (findings.length === 0 && gaps.length === 0 && redFlags.length === 0) issues.push('零有效产出');
  if (findings.some((row) => !row.claim_key)) issues.push('存在没有 claim_key 的 finding');
  if (findings.some((row) => !Array.isArray(row.subquestion_ids) || row.subquestion_ids.length === 0)) issues.push('存在没有 subquestion_ids 的 finding');
  if (findings.some((row) => !Array.isArray(row.sources) || row.sources.length === 0)) issues.push('存在没有 sources 的 finding');
  if (duplicateKeys.length) issues.push(`同一文件重复 claim_key：${[...new Set(duplicateKeys)].join(', ')}`);

  const expectedRelationships = RELATIONSHIPS_BY_TYPE[taskType];
  if (round >= 2 && expectedRelationships && findings.length > 0) {
    const links = findings.flatMap((row) => row.context_links || []);
    if (links.length === 0) issues.push(`${taskType} 的第 ${round} 轮没有 context_links，未证明使用了跨 Agent 线索`);
    else if (!links.some((link) => expectedRelationships.has(link.relationship))) {
      issues.push(`${taskType} 的第 ${round} 轮 context_links 关系不符合任务深度形态`);
    }
  }

  const result = {
    agent: name,
    file,
    round,
    findings: findings.length,
    gaps: gaps.length,
    red_flags: redFlags.length,
    unique_claim_keys: new Set(claimKeys).size,
    independent_domains: domains.size,
    context_links: findings.reduce((sum, row) => sum + (row.context_links?.length || 0), 0),
    issues,
    warnings: [...new Set(warnings)],
  };
  agents.push(result);
  if (issues.length) failures.push(result);
}

const report = {
  schema_version: 2,
  task_type: taskType,
  passed: failures.length === 0,
  agents,
};
fs.writeFileSync(path.join(dir, 'depth-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

log(`深度门：${agents.length} 个 Agent，任务类型 ${taskType}`);
for (const agent of agents) {
  log(`${agent.file}: ${agent.findings} 条证据 / ${agent.independent_domains} 个独立域名 / ${agent.context_links} 个跨轮连接${agent.issues.length ? ` / ✗ ${agent.issues.join('；')}` : ' / ✓'}`);
  if (agent.warnings.length) log(`  提醒：${agent.warnings.join('；')}`);
}
if (failures.length) {
  err(`✗ 深度门未通过：${failures.length} 个 Agent 存在结构或递进问题`);
  process.exit(1);
}
log('✓ 深度门通过');
