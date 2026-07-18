#!/usr/bin/env node
/** validate-state.mjs — 研究流程的机器检查门。 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const taskDir = args.find((arg) => !arg.startsWith('--'));
const phaseIndex = args.indexOf('--phase');
const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : null;

function log(message) { console.log(message); }
function err(message) { console.error(message); }

if (!taskDir || !phase || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/validate-state.mjs <task-dir> --phase <phase>');
  log('phase: 1.5 / 2 / 2-typecheck / 3-raw / 3-findings / 4 / 7-ready / 7-draft / 8-audit');
  process.exit(taskDir ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const errors = [];

function readText(fileName) {
  try { return fs.readFileSync(path.join(dir, fileName), 'utf8'); } catch { return null; }
}

function readJson(fileName, required = true) {
  const text = readText(fileName);
  if (text === null) {
    if (required) errors.push(`${fileName} 不存在`);
    return null;
  }
  try { return JSON.parse(text); } catch (error) {
    errors.push(`${fileName} 不是有效 JSON：${error.message}`);
    return null;
  }
}

function readJsonl(fileName) {
  const text = readText(fileName);
  if (text === null) {
    errors.push(`${fileName} 不存在`);
    return [];
  }
  const rows = [];
  text.split('\n').filter(Boolean).forEach((line, index) => {
    try { rows.push(JSON.parse(line)); } catch (error) {
      errors.push(`${fileName} 第 ${index + 1} 行不是有效 JSON：${error.message}`);
    }
  });
  return rows;
}

function questionList(spec) {
  if (!spec) return [];
  return [...spec.matchAll(/^- \[[ xX]\] (\d+(?:\.\d+)*)\.\s*(.+)$/gm)].map((match) => ({
    id: match[1], title: match[2].trim(),
  }));
}

function checkPhase1_5() {
  const landscape = readJson('landscape.json');
  if (!landscape) return;
  if (!Array.isArray(landscape.entities) || landscape.entities.length < 3) errors.push('landscape.json 至少需要 3 个实体');
  if (!Array.isArray(landscape.perspectives) || landscape.perspectives.length < 2) errors.push('landscape.json 至少需要 2 个视角');
  if (!Array.isArray(landscape.source_hints) || landscape.source_hints.length < 2) errors.push('landscape.json 至少需要 2 个来源线索');
  for (const entity of landscape.entities || []) {
    if (!entity?.name || !entity?.domain) errors.push('landscape.json 每个实体必须有 name 和 domain');
  }
}

function checkPhase2() {
  const spec = readText('task_spec.md');
  if (!spec) errors.push('task_spec.md 不存在或为空');
  const questions = questionList(spec);
  if (questions.length === 0) errors.push('task_spec.md 没有“ - [ ] 1. 子问题”格式的子问题');
  for (const question of questions) {
    const start = spec.indexOf(`- [ ] ${question.id}.`) >= 0 ? spec.indexOf(`- [ ] ${question.id}.`) : spec.indexOf(`- [x] ${question.id}.`);
    const next = questions.find((item) => Number(item.id) > Number(question.id));
    const block = spec.slice(start, next ? spec.indexOf(`- [`, start + 1) : undefined);
    for (const field of ['min_sources', 'min_t1', 'required_fields', 'max_age_days']) {
      if (!new RegExp(`${field}\\s*:`).test(block)) errors.push(`子问题 ${question.id} 缺 ${field}`);
    }
  }
  const progress = readJson('progress.json');
  if (progress && (!progress.stats || typeof progress.current_round === 'undefined')) errors.push('progress.json 缺 current_round 或 stats');
}

function checkPhase2Type() {
  const spec = readText('task_spec.md');
  if (!spec) { errors.push('task_spec.md 不存在'); return; }
  const match = spec.match(/task_type\s*[:：]\s*`?([a-z_]+)/i);
  const allowed = new Set(['comparison', 'deep_dive', 'timeline', 'causal', 'problem_solving', 'enumeration', 'debate', 'general']);
  if (!match) errors.push('task_spec.md 缺 task_type');
  else if (!allowed.has(match[1])) errors.push(`task_type 无效：${match[1]}`);
}

function checkPhase3Raw() {
  const rawDir = path.join(dir, 'raw');
  if (!fs.existsSync(rawDir)) { errors.push('raw/ 目录不存在'); return; }
  const files = fs.readdirSync(rawDir).filter((file) => file.startsWith('search-') && file.endsWith('.jsonl')).sort();
  const visualRequired = /visual_evidence\s*:\s*required/i.test(readText('task_spec.md') || '');
  const knownQuestionIds = new Set(questionList(readText('task_spec.md')).map((item) => item.id));
  if (files.length === 0) { errors.push('raw/ 没有 search-*.jsonl'); return; }
  for (const file of files) {
    if (!/^search-r\d+-.+\.jsonl$/.test(file)) errors.push(`${file} 缺轮次；必须使用 search-r<轮次>-<agent>.jsonl`);
    const lines = fs.readFileSync(path.join(rawDir, file), 'utf8').split('\n').filter(Boolean);
    let sentinelCount = 0;
    let screenshotCount = 0;
    lines.forEach((line, index) => {
      let row;
      try { row = JSON.parse(line); } catch { errors.push(`${file} 第 ${index + 1} 行不是有效 JSON`); return; }
      if (row.type === 'agent_done') {
        sentinelCount++;
        if (index !== lines.length - 1) errors.push(`${file} 的 agent_done 必须是最后一行`);
        if (Number(row.lines_written) !== lines.length - 1) errors.push(`${file} 的 lines_written 与实际行数不一致`);
        return;
      }
      if (!['finding', 'gap', 'red_flag'].includes(row.type)) errors.push(`${file} 第 ${index + 1} 行 type 无效`);
      if (!Array.isArray(row.subquestion_ids) || row.subquestion_ids.length === 0) errors.push(`${file} 第 ${index + 1} 行缺 subquestion_ids`);
      for (const id of row.subquestion_ids || []) {
        if (!knownQuestionIds.has(String(id))) errors.push(`${file} 第 ${index + 1} 行引用不存在的子问题 ${id}`);
      }
      if (row.type === 'finding') {
        if (row.screenshot_path) screenshotCount++;
        if (!row.claim_key) errors.push(`${file} 第 ${index + 1} 行缺 claim_key`);
        if (!Array.isArray(row.fields_covered)) errors.push(`${file} 第 ${index + 1} 行缺 fields_covered`);
      }
      if (row.type === 'finding' || row.type === 'red_flag') {
        if (!Array.isArray(row.sources) || row.sources.length === 0) errors.push(`${file} 第 ${index + 1} 行缺 sources`);
        for (const source of row.sources || []) {
          if (!source.url || !['T1', 'T2', 'T3'].includes(source.tier) || !['supports', 'contradicts'].includes(source.stance) || !source.observed_at) {
            errors.push(`${file} 第 ${index + 1} 行存在不完整 source`);
          }
        }
      }
    });
    if (sentinelCount !== 1) errors.push(`${file} 必须且只能有 1 个 agent_done`);
    if (visualRequired && screenshotCount === 0) errors.push(`${file} 所属任务要求视觉证据，但没有 screenshot_path`);
  }
}

function checkPhase3Findings() {
  const rows = readJsonl('findings.jsonl');
  const summary = readJson('stats-summary.json');
  if (!summary) return;
  const counts = { finding: 0, gap: 0, red_flag: 0 };
  for (const row of rows) {
    if (counts[row.type] === undefined) errors.push(`findings.jsonl 出现未知 type：${row.type}`);
    else counts[row.type]++;
    if (row.type === 'finding') {
      if (!row.claim_id || !row.claim_key) errors.push('finding 缺 claim_id 或 claim_key');
      if (!Array.isArray(row.subquestion_ids) || row.subquestion_ids.length === 0) errors.push(`finding ${row.claim_id || '(未知)'} 未分配子问题`);
      if (row.round === null || row.legacy_round_unknown) errors.push(`finding ${row.claim_id || '(未知)'} 轮次未知`);
      if (!Array.isArray(row.sources) || row.sources.length === 0) errors.push(`finding ${row.claim_id || '(未知)'} 缺来源`);
    }
  }
  if (summary.total_records !== rows.length) errors.push(`stats total_records=${summary.total_records}，实际=${rows.length}`);
  if (summary.total_findings !== counts.finding) errors.push(`stats total_findings=${summary.total_findings}，实际=${counts.finding}`);
  for (const type of Object.keys(counts)) {
    if (summary.by_type?.[type] !== counts[type]) errors.push(`stats by_type.${type}=${summary.by_type?.[type]}，实际=${counts[type]}`);
  }
  if (summary.unassigned_findings !== 0) errors.push(`还有 ${summary.unassigned_findings} 条 finding 没有 subquestion_ids`);
  if (summary.unknown_subquestion_ids?.length) errors.push(`findings 引用了不存在的子问题：${summary.unknown_subquestion_ids.join(', ')}`);
}

function validateBoundaryShape(report) {
  if (report.schema_version !== 2) errors.push('boundary-report.json schema_version 必须为 2');
  if (typeof report.terminate_recommended !== 'boolean') errors.push('boundary-report.json 的 terminate_recommended 必须是布尔值');
  for (const field of ['uncovered_subquestions', 'uncovered_dimensions', 'direction_drift', 'entity_mismatch', 'cross_agent_hints']) {
    if (!Array.isArray(report[field])) errors.push(`boundary-report.json 的 ${field} 必须是数组`);
  }
  if (!report.evidence_map || typeof report.evidence_map.by_subquestion !== 'object') errors.push('boundary-report.json 缺 evidence_map.by_subquestion');
  if (!Number.isInteger(report.follow_ups_unresolved) || report.follow_ups_unresolved < 0) errors.push('follow_ups_unresolved 必须是非负整数');
  for (const hint of report.cross_agent_hints || []) {
    if (!hint.target || !hint.hint || !hint.rationale) errors.push('每条 cross_agent_hints 必须有 target、hint、rationale');
    if (!Array.isArray(hint.source_claim_keys) || hint.source_claim_keys.length === 0) errors.push('每条 cross_agent_hints 必须有 source_claim_keys');
    if ([...String(hint.hint)].length > 80) errors.push(`线索超过 80 字符：${hint.hint}`);
  }
}

function checkPhase4() {
  const report = readJson('boundary-report.json');
  if (!report) return;
  validateBoundaryShape(report);
  const hasHigh = (report.uncovered_dimensions || []).some((item) => item.priority === 'high');
  const semanticBlocker = (report.uncovered_subquestions || []).length > 0
    || (report.entity_mismatch || []).length > 0
    || report.follow_ups_unresolved > 0
    || hasHigh;
  if (report.terminate_recommended && semanticBlocker) errors.push('boundary 建议终止，但仍有未完成子问题、实体错误、未解决追问或高优先级缺口');
  if (!report.terminate_recommended && report.task_type !== 'general') {
    const hintCount = report.cross_agent_hints?.length || 0;
    if (hintCount < 3 || hintCount > 5) errors.push(`继续下一轮时 cross_agent_hints 必须有 3-5 条，当前 ${hintCount} 条`);
  }
  if (!report.terminate_recommended) {
    const progress = readJson('progress.json', false);
    if (!progress?.convergence?.recommended) errors.push('boundary 不建议终止且收敛规则未触发：必须返回下一轮搜索');
  }
}

function readySubquestions(summary) {
  return Object.entries(summary?.by_subquestion || {}).filter(([, item]) => item.meets_criteria || item.accepted_limit);
}

function checkPhase7Ready() {
  const summary = readJson('stats-summary.json');
  const boundary = readJson('boundary-report.json');
  if (!summary || !boundary) return;
  validateBoundaryShape(boundary);
  const unfinished = Object.entries(summary.by_subquestion || {}).filter(([, item]) => !item.meets_criteria && !item.accepted_limit);
  if (unfinished.length) errors.push(`还有未完成且未逐项说明限制的子问题：${unfinished.map(([id]) => id).join(', ')}`);
  const convergence = readJson('progress.json', false)?.convergence?.recommended;
  if (!boundary.terminate_recommended && !convergence) errors.push('boundary 未建议终止，且收敛规则未触发');
  if ((boundary.uncovered_subquestions || []).length) errors.push('boundary 仍列出未完成子问题；设置逐题 known_limit 后必须重新评估边界');
  if ((boundary.uncovered_dimensions || []).some((item) => item.priority === 'high')) errors.push('仍有高优先级未覆盖维度，不能合成');
  if (boundary.follow_ups_unresolved > 0) errors.push('仍有未解决 follow-up，不能合成');
  if ((boundary.entity_mismatch || []).length) errors.push('仍有 entity_mismatch，不能合成');
}

function checkPhase7Draft() {
  const draft = readText('draft.md');
  if (!draft) { errors.push('draft.md 不存在或为空'); return; }
  const findings = readJsonl('findings.jsonl');
  const summary = readJson('stats-summary.json');
  const canonicalUrl = (value) => {
    try {
      const url = new URL(value);
      url.hash = '';
      if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
      return url.toString().replace(/\/$/, '');
    } catch { return value; }
  };
  const evidenceUrls = new Set(findings
    .filter((row) => row.type === 'finding' || row.type === 'red_flag')
    .flatMap((row) => (row.sources || []).map((source) => canonicalUrl(source.url))));
  const draftUrls = [...draft.matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((match) => match[0].replace(/[.,;，。；]+$/, ''));
  const orphan = [...new Set(draftUrls.filter((url) => !evidenceUrls.has(canonicalUrl(url))))];
  if (orphan.length) errors.push(`draft.md 有不在 finding/red_flag 结构化来源中的 URL：${orphan.join(', ')}`);
  for (const [id, item] of readySubquestions(summary)) {
    const title = item.title.replace(/[`*_]/g, '').trim();
    if (!draft.includes(title) && !new RegExp(`(^|\\n)#{1,6}\\s+${id}(?:\\.|\\s)`, 'm').test(draft)) {
      errors.push(`draft.md 缺子问题 ${id} 的章节：${title}`);
    }
    if (item.accepted_limit && item.known_limit && !draft.includes(item.known_limit)) errors.push(`draft.md 没有披露子问题 ${id} 的 known_limit`);
  }
}

function checkPhase8Audit() {
  const audit = readJson('audit-report.json');
  const summary = readJson('stats-summary.json', false);
  if (!audit) return;
  if (audit.schema_version !== 2) errors.push('audit-report.json schema_version 必须为 2');
  if (!Array.isArray(audit.critical) || !Array.isArray(audit.non_critical)) errors.push('audit 的 critical/non_critical 必须是数组');
  if (typeof audit.passed !== 'boolean') errors.push('audit 的 passed 必须是布尔值');
  if ((audit.critical || []).length) errors.push(`审计仍有 ${audit.critical.length} 个 critical 问题，必须回搜索 LOOP`);
  if ((audit.non_critical || []).length) errors.push(`审计仍有 ${audit.non_critical.length} 个 non_critical 问题，必须重派合成后复审`);
  if (audit.passed !== true) errors.push('audit passed 不是 true');
  const sampled = audit.sampled_stats || {};
  for (const tier of ['t1', 't2', 't3']) {
    if (!Number.isInteger(sampled[`total_${tier}`]) || !Number.isInteger(sampled[`sampled_${tier}`])) errors.push(`sampled_stats 缺 ${tier} 的整数统计`);
  }
  if (summary) {
    for (const tier of ['T1', 'T2', 'T3']) {
      if (sampled[`total_${tier.toLowerCase()}`] !== summary.by_tier?.[tier]) errors.push(`audit 的 ${tier} 总数与 stats-summary 不一致`);
    }
  }
  if (sampled.sampled_t3 < sampled.total_t3) errors.push('T3 必须 100% 审计');
  if (sampled.sampled_t2 < Math.ceil(sampled.total_t2 * 0.5)) errors.push('T2 至少审计 50%');
  if (sampled.sampled_t1 < Math.min(5, sampled.total_t1)) errors.push('T1 至少审计 5 条（不足 5 条时全审）');
}

const checks = {
  '1.5': checkPhase1_5,
  '2': checkPhase2,
  '2-typecheck': checkPhase2Type,
  '3-raw': checkPhase3Raw,
  '3-findings': checkPhase3Findings,
  '4': checkPhase4,
  '7-ready': checkPhase7Ready,
  '7-pre': checkPhase7Ready,
  '7-draft': checkPhase7Draft,
  '8-audit': checkPhase8Audit,
  '7-post': checkPhase8Audit,
};

if (!checks[phase]) {
  err(`✗ 未知 phase: ${phase}`);
  process.exit(2);
}
checks[phase]();
if (errors.length) {
  err(`✗ 检查门 ${phase} 未通过：`);
  for (const message of errors) err(`  - ${message}`);
  process.exit(1);
}
log(`✓ 检查门 ${phase} 通过`);
