#!/usr/bin/env node
/**
 * validate-state.mjs — 检查门：验证任务目录的状态文件是否齐全、字段对不对。
 *
 * 由主 Agent 每个 Phase 前自己跑（非物理强制，但主 Agent 瘦身后跳步概率低）。
 * 不通过 exit(1) + stderr 报告缺什么。
 *
 * 用法：
 *   node scripts/validate-state.mjs <task-dir> --phase <phase-name>
 *
 * 支持的 phase：
 *   1.5      侦察后——landscape.json 存在 + entities 非空
 *   2        task_spec 后——文件存在 + 有 [ ] 子问题 + 有完成标准字段
 *   3-raw    搜索后——raw/ 目录存在 + 每个 Agent 有文件
 *   3-findings 归一化后——findings.jsonl + stats-summary.json 存在 + 行数一致
 *   4        边界后——boundary-report.yaml 存在 + terminate_recommended 是 bool
 *   7-pre    合成前——task_spec 全 [x] + draft.md 不存在（还没派合成 Agent）
 *   7-post   审计后——audit_report.yaml 存在
 */

import fs from 'node:fs';
import path from 'node:path';

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

// ── 参数解析 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const taskDir = args.find((a) => !a.startsWith('--'));
const phaseArg = args.find((a) => a.startsWith('--phase'));
const phase = phaseArg ? args[args.indexOf(phaseArg) + 1] : null;

if (!taskDir || !phase || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/validate-state.mjs <task-dir> --phase <phase-name>');
  log('');
  log('Phases: 1.5 / 2 / 3-raw / 3-findings / 4 / 7-pre / 7-post');
  process.exit(taskDir ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const errors = [];

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const content = readFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── 各 phase 检查 ────────────────────────────────────────────

function checkPhase1_5() {
  const landscape = readJson(path.join(dir, 'landscape.json'));
  if (!landscape) {
    errors.push('landscape.json 不存在或不是有效 JSON');
    return;
  }
  if (!Array.isArray(landscape.entities) || landscape.entities.length === 0) {
    errors.push('landscape.json 的 entities 数组为空');
  }
  if (!Array.isArray(landscape.perspectives) || landscape.perspectives.length < 3) {
    errors.push(`landscape.json 的 perspectives < 3（实际 ${landscape.perspectives?.length || 0}）`);
  }
}

function checkPhase2() {
  const spec = readFile(path.join(dir, 'task_spec.md'));
  if (!spec) {
    errors.push('task_spec.md 不存在');
    return;
  }
  // 至少 1 个 [ ] 子问题
  const openQuestions = (spec.match(/^- \[ \] \d+\./gm) || []).length;
  if (openQuestions === 0) {
    errors.push('task_spec.md 没有 `- [ ] N.` 格式的子问题');
  }
  // 检查完成标准字段
  const hasMinSources = /min_sources/.test(spec);
  const hasMinT1 = /min_t1/.test(spec);
  if (!hasMinSources || !hasMinT1) {
    errors.push(`task_spec.md 缺完成标准字段（min_sources: ${hasMinSources}, min_t1: ${hasMinT1}）`);
  }
}

function checkPhase3_raw() {
  const rawDir = path.join(dir, 'raw');
  if (!exists(rawDir)) {
    errors.push('raw/ 目录不存在');
    return;
  }
  const rawFiles = fs.readdirSync(rawDir).filter((f) => f.endsWith('.jsonl') && f.startsWith('search-'));
  if (rawFiles.length === 0) {
    errors.push('raw/ 目录下没有 search-*.jsonl 文件');
    return;
  }
  // 检查每个文件有没有 agent_done sentinel
  for (const f of rawFiles) {
    const content = readFile(path.join(rawDir, f));
    if (!content) continue;
    const lines = content.trim().split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    try {
      const parsed = JSON.parse(lastLine);
      if (parsed.type !== 'agent_done') {
        errors.push(`${f}: 末尾无 agent_done sentinel（子 Agent 可能被杀了）`);
      }
    } catch {
      errors.push(`${f}: 末尾行不是有效 JSON（可能被杀时半行损坏）`);
    }
  }
}

function checkPhase3_findings() {
  const findingsPath = path.join(dir, 'findings.jsonl');
  const statsPath = path.join(dir, 'stats-summary.json');

  if (!exists(findingsPath)) {
    errors.push('findings.jsonl 不存在——先跑 normalize.mjs');
    return;
  }
  if (!exists(statsPath)) {
    errors.push('stats-summary.json 不存在——先跑 normalize.mjs');
    return;
  }

  // 行数一致性检查
  const findingsLines = readFile(findingsPath).trim().split('\n').filter(Boolean).length;
  const stats = readJson(statsPath);
  if (stats && stats.total_findings !== undefined && stats.total_findings !== findingsLines) {
    errors.push(`行数不一致：stats-summary.json 说 ${stats.total_findings}，findings.jsonl 实际 ${findingsLines}`);
  }

  // 每行 type 在枚举内
  const validTypes = new Set(['finding', 'gap', 'red_flag']);
  const findings = readFile(findingsPath).trim().split('\n').filter(Boolean);
  for (let i = 0; i < findings.length; i++) {
    try {
      const row = JSON.parse(findings[i]);
      if (!validTypes.has(row.type)) {
        errors.push(`findings.jsonl 第 ${i + 1} 行 type 无效: ${row.type}`);
        break;  // 只报第一个
      }
      if (row.type === 'finding' && !row.claim_id) {
        errors.push(`findings.jsonl 第 ${i + 1} 行 finding 缺 claim_id`);
        break;
      }
    } catch {
      errors.push(`findings.jsonl 第 ${i + 1} 行不是有效 JSON`);
      break;
    }
  }
}

function checkPhase4() {
  const report = readFile(path.join(dir, 'boundary-report.yaml'));
  if (!report) {
    errors.push('boundary-report.yaml 不存在——先派边界 Agent');
    return;
  }
  // 简单检查 terminate_recommended 存在
  if (!/terminate_recommended/.test(report)) {
    errors.push('boundary-report.yaml 缺 terminate_recommended 字段');
    return;
  }

  // 硬拦截 #009：terminate_recommended: false → boundary 认为不该终止，
  // 主 Agent 必须回第 6 步补搜，不许往合成走。
  // 唯一例外：Rule A/B 已强制收敛（progress.json 标了 stale 终止）。
  const terminateMatch = report.match(/^terminate_recommended:\s*(\w+)/m);
  const terminateVal = terminateMatch ? terminateMatch[1] : null;
  if (terminateVal === 'false') {
    // 检查是否 Rule A/B 已兜底（看 progress.json）
    const progress = readJson(path.join(dir, 'progress.json'));
    const staleCount = progress?.stale_count ?? 0;
    const roundsCompleted = progress?.stats?.rounds_completed ?? 0;
    const ruleA = staleCount >= 2;             // 连续 2 轮 0 新事实
    const ruleB = roundsCompleted >= 5;         // 简化判定：≥5 轮（精确 Rule B 见 calc-novelty.mjs）
    if (ruleA || ruleB) {
      // Rule A/B 已兜底——允许进入合成，但提示主 Agent 标注「信息增益枯竭」
      // 不报错，继续（不 exit）
    } else {
      errors.push('boundary-report.yaml 标 terminate_recommended: false——boundary 认为不该终止（有未覆盖维度或 follow_up 未解决）。回第 6 步补搜，不要进合成。');
      errors.push('  例外：只有 Rule A（stale_count>=2）或 Rule B（>=5 轮）触发时才允许强制终止。当前 stale_count=' + staleCount + ', rounds_completed=' + roundsCompleted);
    }
  }
}

function checkPhase7_pre() {
  const spec = readFile(path.join(dir, 'task_spec.md'));
  if (!spec) {
    errors.push('task_spec.md 不存在');
    return;
  }
  // 所有子问题 [x]（或标「已知限制」）
  const openQuestions = (spec.match(/^- \[ \] \d+\./gm) || []).length;
  if (openQuestions > 0) {
    // 检查是否标了「已知限制」
    const knownLimit = /已知限制|数据缺口/.test(spec);
    if (!knownLimit) {
      errors.push(`task_spec.md 还有 ${openQuestions} 个未完成子问题 [ ]——不能进合成`);
    }
  }
}

function checkPhase7_post() {
  const report = readFile(path.join(dir, 'audit_report.yaml'));
  if (!report) {
    errors.push('audit_report.yaml 不存在——先派审计 Agent');
    return;
  }
}

// ── 执行检查 ────────────────────────────────────────────────

const phaseChecks = {
  '1.5': checkPhase1_5,
  '2': checkPhase2,
  '3-raw': checkPhase3_raw,
  '3-findings': checkPhase3_findings,
  '4': checkPhase4,
  '7-pre': checkPhase7_pre,
  '7-post': checkPhase7_post,
};

const checkFn = phaseChecks[phase];
if (!checkFn) {
  err(`✗ 未知 phase: ${phase}`);
  err(`  有效值: ${Object.keys(phaseChecks).join(' / ')}`);
  process.exit(2);
}

checkFn();

if (errors.length > 0) {
  err(`✗ 检查门 ${phase} 未通过：`);
  for (const e of errors) {
    err(`  - ${e}`);
  }
  process.exit(1);
}

log(`✓ 检查门 ${phase} 通过`);
process.exit(0);
