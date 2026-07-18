#!/usr/bin/env node
/** 从 boundary-report.json 读取跨 Agent 线索，输出安全的命令参数。 */

import fs from 'node:fs';
import path from 'node:path';

function err(message) { console.error(message); }

const args = process.argv.slice(2);
const taskDir = args.find((arg) => !arg.startsWith('--'));
const targetIndex = args.indexOf('--target');
const targetFilter = targetIndex >= 0 ? args[targetIndex + 1] : null;

if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  console.log('用法：node scripts/inject-hints.mjs <task-dir> [--target <过滤词>]');
  process.exit(taskDir ? 0 : 2);
}

if (targetIndex >= 0 && !targetFilter) {
  err('✗ --target 需要一个值');
  process.exit(2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const reportPath = path.join(dir, 'boundary-report.json');
let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  err(`✗ 无法读取 boundary-report.json：${error.message}`);
  process.exit(1);
}

if (!Array.isArray(report.cross_agent_hints)) {
  err('✗ boundary-report.json 缺 cross_agent_hints 数组');
  process.exit(1);
}

const validHints = report.cross_agent_hints.filter((item) =>
  item && typeof item.target === 'string' && typeof item.hint === 'string' && item.hint.trim());
const filtered = targetFilter
  ? validHints.filter((item) => item.target.toLowerCase().includes(targetFilter.toLowerCase()))
  : validHints;

if (filtered.length === 0) {
  err(targetFilter
    ? `✗ 没有 target 匹配 "${targetFilter}" 的线索`
    : '✗ boundary-report.json 没有可注入的线索');
  process.exit(1);
}

for (const item of filtered) {
  const keys = Array.isArray(item.source_claim_keys) ? item.source_claim_keys.join(',') : '';
  console.log(`--known-clue ${JSON.stringify(`${item.hint} [source_claim_keys: ${keys}]`)}`);
}
