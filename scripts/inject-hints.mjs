#!/usr/bin/env node
/**
 * inject-hints.mjs — 读 boundary-report.yaml 的 cross_agent_hints，
 *                     输出拼好的 --known-clue 参数，让主 Agent 不能跳过注入。
 *
 * 为什么需要这个脚本：
 *   跨 Agent 线索机制如果只靠主 Agent 读 SKILL.md 自觉注入，不可靠
 *   （LLM 可能跳过）。这个脚本把"读 hints + 拼参数"固化成命令——
 *   主 Agent 派 R2 前必须跑它，用它的输出作为 --known-clue 参数。
 *
 * 用法：
 *   node scripts/inject-hints.mjs <task-dir> [--target <过滤词>]
 *
 * 输出（stdout）：每行一条 --known-clue 参数，主 Agent 直接复制用
 *   --known-clue "hint 内容"
 *   --known-clue "hint 内容"
 *
 *   --target 过滤：只输出 target 匹配过滤词的 hint（主 Agent 按实体/维度筛）
 *
 * 退出码：0 有 hint 输出 / 1 无 hint（boundary 没产 cross_agent_hints）
 */

import fs from 'node:fs';
import path from 'node:path';

function err(msg) { console.error(msg); }

const args = process.argv.slice(2);
const taskDir = args.find((a) => !a.startsWith('--'));
const targetArgIdx = args.indexOf('--target');
const targetFilter = targetArgIdx >= 0 ? args[targetArgIdx + 1] : null;

if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  console.log('用法：node scripts/inject-hints.mjs <task-dir> [--target <过滤词>]');
  console.log('');
  console.log('读 boundary-report.yaml 的 cross_agent_hints，输出拼好的 --known-clue 参数。');
  console.log('--target 过滤：只输出 target 匹配过滤词的 hint');
  process.exit(taskDir ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const reportPath = path.join(dir, 'boundary-report.yaml');

if (!fs.existsSync(reportPath)) {
  err(`✗ boundary-report.yaml 不存在：${reportPath}`);
  err('  先派 boundary Agent（phase 4）');
  process.exit(1);
}

const content = fs.readFileSync(reportPath, 'utf8');

// 提取 cross_agent_hints 段（YAML 粗解析——不依赖 js-yaml）
// 格式：
//   cross_agent_hints:
//     - target: "xxx"
//       hint: "yyy"
//     - target: "aaa"
//       hint: "bbb"
const hintsSection = content.match(/cross_agent_hints:\s*\n([\s\S]*?)(?=\n\S|\n$|$)/);
if (!hintsSection) {
  err('✗ boundary-report.yaml 没有 cross_agent_hints 段');
  err('  boundary Agent 必须按 task_type 提炼跨 Agent 线索');
  err('  见 references/boundary.md「跨 Agent 线索提炼」');
  process.exit(1);
}

// 逐条解析（- target: ... / hint: ...）
const hints = [];
const lines = hintsSection[1].split('\n');
let current = {};
for (const line of lines) {
  const targetMatch = line.match(/^\s*-\s+target:\s*["']?(.*?)["']?\s*$/);
  const hintMatch = line.match(/^\s+hint:\s*["']?(.*?)["']?\s*$/);
  if (targetMatch) {
    if (current.hint) hints.push(current);  // 上一条结束
    current = { target: targetMatch[1] };
  } else if (hintMatch) {
    current.hint = hintMatch[1];
  }
}
if (current.hint) hints.push(current);

if (hints.length === 0) {
  err('✗ cross_agent_hints 段为空（没有可注入的 hint）');
  err('  boundary Agent 必须至少产出 1 条 hint');
  process.exit(1);
}

// 过滤（按 target 关键词）
const filtered = targetFilter
  ? hints.filter((h) => h.target.toLowerCase().includes(targetFilter.toLowerCase()))
  : hints;

if (filtered.length === 0) {
  err(`✗ 没有 target 匹配 "${targetFilter}" 的 hint`);
  err(`  可用的 target：${hints.map((h) => h.target).join(' / ')}`);
  process.exit(1);
}

// 输出 --known-clue 参数（主 Agent 直接复制到 spawn-subagent 命令里）
console.log('# 跨 Agent 线索（从 boundary-report 读出，注入给下一轮搜索 Agent）');
console.log(`# 共 ${filtered.length} 条${targetFilter ? `（target 过滤："${targetFilter}"）` : ''}`);
console.log('# 主 Agent：把下面每行作为 --known-clue 参数加到 spawn-subagent 命令里');
console.log('');
for (const h of filtered) {
  console.log(`--known-clue "${h.hint.replace(/"/g, '\\"')}"`);
}
console.log('');
console.log(`# target: ${filtered.map((h) => h.target).join(' / ')}`);

process.exit(0);
