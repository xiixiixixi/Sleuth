/** validate-state.mjs 的真实语义门测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../validate-state.mjs', import.meta.url));

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-gate-')); }
function writeJson(root, name, value) { fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`); }
function run(root, phase) { return spawnSync('node', [SCRIPT, root, '--phase', phase], { encoding: 'utf8' }); }

function summary(meets = true, accepted = false) {
  return {
    schema_version: 2, total_records: 1, total_findings: 1, unassigned_findings: 0,
    total_visuals: 0,
    by_type: { finding: 1, gap: 0, red_flag: 0 }, by_tier: { T1: 1, T2: 0, T3: 0 },
    by_subquestion: { '1': { title: '价格问题', meets_criteria: meets, accepted_limit: accepted, known_limit: accepted ? '企业价未公开' : null } },
  };
}

function boundary(overrides = {}) {
  return {
    schema_version: 2, terminate_recommended: true, task_type: 'comparison',
    evidence_map: { by_subquestion: { '1': { supported_claim_keys: ['1:a:x'] } }, unassigned_findings: [] },
    uncovered_subquestions: [], uncovered_dimensions: [], direction_drift: [], entity_mismatch: [], follow_ups_unresolved: 0,
    cross_agent_hints: [], rationale: '已覆盖', ...overrides,
  };
}

test('phase 1.5 严格读取 landscape JSON', () => {
  const root = dir();
  writeJson(root, 'landscape.json', { entities: [{ name: 'a', domain: 'a.com' }, { name: 'b', domain: 'b.com' }, { name: 'c', domain: 'c.com' }], perspectives: ['x', 'y'], source_hints: [{ url: 'https://a.com' }, { url: 'https://b.com' }] });
  assert.equal(run(root, '1.5').status, 0);
  fs.writeFileSync(path.join(root, 'landscape.json'), 'not json');
  assert.equal(run(root, '1.5').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 2 要求 task_type、逐题标准和 progress', () => {
  const root = dir();
  fs.writeFileSync(path.join(root, 'task_spec.md'), 'task_type: comparison\nvisual_evidence: auto\n\n- [ ] 1. 价格问题\n  - min_sources: 2\n  - min_t1: 1\n  - required_fields: [价格]\n  - max_age_days: 365\n');
  writeJson(root, 'progress.json', { current_round: 1, stats: {} });
  assert.equal(run(root, '2').status, 0);
  assert.equal(run(root, '2-typecheck').status, 0);
  fs.writeFileSync(path.join(root, 'task_spec.md'), 'task_type: wrong\n- [ ] 1. x\n');
  assert.equal(run(root, '2-typecheck').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 2 强制声明图片策略，关闭时必须说明原因', () => {
  const root = dir();
  writeJson(root, 'progress.json', { current_round: 1, stats: {} });
  const base = 'task_type: comparison\n\n- [ ] 1. 价格问题\n  - min_sources: 1\n  - min_t1: 1\n  - required_fields: [价格]\n  - max_age_days: 365\n';
  fs.writeFileSync(path.join(root, 'task_spec.md'), base);
  assert.equal(run(root, '2').status, 1);
  fs.writeFileSync(path.join(root, 'task_spec.md'), `visual_evidence: off\n${base}`);
  assert.equal(run(root, '2').status, 1);
  fs.writeFileSync(path.join(root, 'task_spec.md'), `visual_evidence: off\nvisual_evidence_reason: 用户明确只要纯文字\n${base}`);
  assert.equal(run(root, '2').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 3-raw 拒绝缺轮次、缺子问题和缺来源的原始文件', () => {
  const root = dir();
  fs.mkdirSync(path.join(root, 'raw'));
  const bad = [{ type: 'finding', claim: 'x' }, { type: 'agent_done', agent: 'a', lines_written: 1 }];
  fs.writeFileSync(path.join(root, 'raw', 'search-a.jsonl'), bad.map(JSON.stringify).join('\n'));
  const result = run(root, '3-raw');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺轮次/);
  assert.match(result.stderr, /subquestion_ids/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 3-raw 要求 red_flag 也有结构化来源', () => {
  const root = dir();
  fs.mkdirSync(path.join(root, 'raw'));
  fs.writeFileSync(path.join(root, 'task_spec.md'), '- [ ] 1. 冲突检查\n');
  const row = { type: 'red_flag', claim: '旧数据', reason: '已过期', subquestion_ids: ['1'] };
  const write = () => fs.writeFileSync(path.join(root, 'raw', 'search-r1-a.jsonl'), `${JSON.stringify(row)}\n${JSON.stringify({ type: 'agent_done', agent: 'a', lines_written: 1 })}\n`);
  write();
  assert.equal(run(root, '3-raw').status, 1);
  row.sources = [{ url: 'https://legacy.example/a', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }];
  write();
  assert.equal(run(root, '3-raw').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('visual_evidence required 时，没有结构化图片不能过 raw 门', () => {
  const root = dir();
  fs.mkdirSync(path.join(root, 'raw'));
  fs.mkdirSync(path.join(root, 'screenshots'));
  fs.writeFileSync(path.join(root, 'screenshots', 'a.png'), 'test-image');
  fs.writeFileSync(path.join(root, 'task_spec.md'), 'visual_evidence: required\n\n- [ ] 1. 视觉问题\n');
  const row = { type: 'finding', claim: 'x', claim_key: '1:a:x', subquestion_ids: ['1'], fields_covered: [], sources: [{ url: 'https://a.com', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }], visuals: [] };
  let done = { type: 'agent_done', agent: 'a', lines_written: 1, visual_scan: { status: 'none_useful', candidates_seen: 1, useful_saved: 0, reason: '只有装饰图', pages: [{ url: 'https://a.com', candidates_seen: 1, useful_saved: 0, reason: '只有品牌标志' }] } };
  fs.writeFileSync(path.join(root, 'raw', 'search-r1-a.jsonl'), `${JSON.stringify(row)}\n${JSON.stringify(done)}\n`);
  assert.equal(run(root, '3-raw').status, 1);
  row.visuals = [{ kind: 'ui', screenshot_path: 'screenshots/a.png', source_page_url: 'https://a.com', caption: '官方界面展示关键操作入口', observed_at: '2026-07-18T00:00:00Z' }];
  done = { type: 'agent_done', agent: 'a', lines_written: 1, visual_scan: { status: 'captured', candidates_seen: 1, useful_saved: 1, pages: [{ url: 'https://a.com', candidates_seen: 1, useful_saved: 1 }] } };
  fs.writeFileSync(path.join(root, 'raw', 'search-r1-a.jsonl'), `${JSON.stringify(row)}\n${JSON.stringify(done)}\n`);
  assert.equal(run(root, '3-raw').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('visual_evidence auto 时必须留下图片扫描记录', () => {
  const root = dir();
  fs.mkdirSync(path.join(root, 'raw'));
  fs.writeFileSync(path.join(root, 'task_spec.md'), 'visual_evidence: auto\n\n- [ ] 1. 视觉问题\n');
  const row = { type: 'finding', claim: 'x', claim_key: '1:a:x', subquestion_ids: ['1'], fields_covered: [], sources: [
    { url: 'https://a.com', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' },
    { url: 'https://b.com', tier: 'T2', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' },
  ], visuals: [] };
  const file = path.join(root, 'raw', 'search-r1-a.jsonl');
  fs.writeFileSync(file, `${JSON.stringify(row)}\n${JSON.stringify({ type: 'agent_done', agent: 'a', lines_written: 1 })}\n`);
  assert.equal(run(root, '3-raw').status, 1);
  const done = { type: 'agent_done', agent: 'a', lines_written: 1, visual_scan: { status: 'none_useful', candidates_seen: 3, useful_saved: 0, reason: '三张都是头像和品牌标志', pages: [{ url: 'https://a.com', candidates_seen: 3, useful_saved: 0, reason: '三张都是头像和品牌标志' }] } };
  fs.writeFileSync(file, `${JSON.stringify(row)}\n${JSON.stringify(done)}\n`);
  assert.equal(run(root, '3-raw').status, 1, '漏掉任一已采用来源页都必须失败');
  done.visual_scan.pages.push({ url: 'https://b.com', candidates_seen: 0, useful_saved: 0, reason: '该页没有图片元素' });
  fs.writeFileSync(file, `${JSON.stringify(row)}\n${JSON.stringify(done)}\n`);
  assert.equal(run(root, '3-raw').status, 0);
  delete row.visuals;
  fs.writeFileSync(file, `${JSON.stringify(row)}\n${JSON.stringify(done)}\n`);
  assert.equal(run(root, '3-raw').status, 1, '新任务即使没有有用图片也必须显式写 visuals: []');
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 3-findings 核对统计口径和分配状态', () => {
  const root = dir();
  fs.writeFileSync(path.join(root, 'findings.jsonl'), `${JSON.stringify({ type: 'finding', claim_id: 'x', claim_key: '1:a:x', round: 1, subquestion_ids: ['1'], sources: [{ url: 'https://a.com' }], visuals: [] })}\n`);
  writeJson(root, 'stats-summary.json', summary());
  assert.equal(run(root, '3-findings').status, 0);
  const wrong = summary(); wrong.total_findings = 2;
  writeJson(root, 'stats-summary.json', wrong);
  assert.equal(run(root, '3-findings').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 4：boundary 说继续时，没有收敛信号必须回搜索', () => {
  const root = dir();
  const hints = [1, 2, 3].map((i) => ({ target: `t${i}`, hint: `线索${i}`, rationale: '补深', source_claim_keys: [`1:a:${i}`] }));
  writeJson(root, 'boundary-report.json', boundary({ terminate_recommended: false, cross_agent_hints: hints }));
  writeJson(root, 'progress.json', { convergence: { recommended: false } });
  assert.equal(run(root, '4').status, 1);
  writeJson(root, 'progress.json', { convergence: { recommended: true } });
  assert.equal(run(root, '4').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 4：有高优先级缺口时不能一边建议终止', () => {
  const root = dir();
  writeJson(root, 'boundary-report.json', boundary({ uncovered_dimensions: [{ dimension: '安全', priority: 'high' }] }));
  assert.equal(run(root, '4').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 7-ready 只接受完成或逐题 known_limit', () => {
  const root = dir();
  writeJson(root, 'boundary-report.json', boundary());
  writeJson(root, 'stats-summary.json', summary(false, false));
  assert.equal(run(root, '7-ready').status, 1);
  writeJson(root, 'stats-summary.json', summary(false, true));
  assert.equal(run(root, '7-ready').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 7-draft 拒绝孤儿 URL，并要求逐题章节', () => {
  const root = dir();
  fs.writeFileSync(path.join(root, 'findings.jsonl'), `${JSON.stringify({ type: 'finding', sources: [{ url: 'https://evidence.example/a' }], visuals: [] })}\n`);
  writeJson(root, 'stats-summary.json', summary());
  fs.writeFileSync(path.join(root, 'draft.md'), '# 报告\n\n## 1. 价格问题\n\n[结论](https://orphan.example/a)\n');
  assert.equal(run(root, '7-draft').status, 1);
  fs.writeFileSync(path.join(root, 'draft.md'), '# 报告\n\n## 1. 价格问题\n\n[结论](https://evidence.example/a)\n');
  assert.equal(run(root, '7-draft').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 7-draft 强制放入有用图片、来源页和图注', () => {
  const root = dir();
  const visual = { kind: 'diagram', image_url: 'https://img.example/workflow.png', source_page_url: 'https://evidence.example/workflow', caption: '官方流程图展示三个处理阶段', observed_at: '2026-07-18T00:00:00Z' };
  fs.writeFileSync(path.join(root, 'task_spec.md'), 'visual_evidence: auto\n');
  fs.writeFileSync(path.join(root, 'findings.jsonl'), `${JSON.stringify({ type: 'finding', sources: [{ url: visual.source_page_url }], visuals: [visual] })}\n`);
  const stats = summary(); stats.total_visuals = 1;
  writeJson(root, 'stats-summary.json', stats);
  fs.writeFileSync(path.join(root, 'draft.md'), '# 报告\n\n## 1. 价格问题\n\n[结论](https://evidence.example/workflow)\n');
  assert.equal(run(root, '7-draft').status, 1);
  fs.writeFileSync(path.join(root, 'draft.md'), '# 报告\n\n## 1. 价格问题\n\n![官方流程图展示三个处理阶段](https://img.example/workflow.png)\n\n[来源页](https://evidence.example/workflow)；抓取于 2026-07-18，这张图说明三个处理阶段。\n');
  assert.equal(run(root, '7-draft').status, 0);
  fs.writeFileSync(path.join(root, 'draft.md'), '# 报告\n\n## 1. 价格问题\n\n![](https://img.example/unknown.png)\n\n[来源页](https://evidence.example/workflow)\n');
  assert.equal(run(root, '7-draft').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 7-draft 允许引用 red_flag 的结构化来源解释排除理由', () => {
  const root = dir();
  fs.writeFileSync(path.join(root, 'findings.jsonl'), `${JSON.stringify({ type: 'red_flag', sources: [{ url: 'https://legacy.example/a' }] })}\n`);
  writeJson(root, 'stats-summary.json', summary());
  fs.writeFileSync(path.join(root, 'draft.md'), '# 报告\n\n## 1. 价格问题\n\n[旧版数字不能代表当前产品](https://legacy.example/a)\n');
  assert.equal(run(root, '7-draft').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 8-audit 要求问题清零、passed=true 且抽样足够', () => {
  const root = dir();
  writeJson(root, 'stats-summary.json', { by_tier: { T1: 6, T2: 4, T3: 2 } });
  writeJson(root, 'audit-report.json', { schema_version: 2, critical: [], non_critical: [], sampled_stats: { total_t1: 6, sampled_t1: 5, total_t2: 4, sampled_t2: 2, total_t3: 2, sampled_t3: 2 }, passed: true });
  const reportOnly = run(root, '8-audit');
  assert.equal(reportOnly.status, 0);
  assert.match(reportOnly.stdout, /只代表审查报告自身通过/);
  assert.match(reportOnly.stdout, /audit-run\.mjs.*--stage all/);
  const legacyReportOnly = run(root, '7-post');
  assert.equal(legacyReportOnly.status, 0);
  assert.match(legacyReportOnly.stdout, /只代表审查报告自身通过/);
  assert.match(legacyReportOnly.stdout, /audit-run\.mjs.*--stage all/);
  writeJson(root, 'audit-report.json', { schema_version: 2, critical: [], non_critical: [{ issue: '缺引用' }], sampled_stats: { total_t1: 6, sampled_t1: 5, total_t2: 4, sampled_t2: 2, total_t3: 2, sampled_t3: 2 }, passed: false });
  assert.equal(run(root, '8-audit').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase 8-audit 有图片时必须逐张审查且全部进入报告', () => {
  const root = dir();
  writeJson(root, 'stats-summary.json', { by_tier: { T1: 1, T2: 0, T3: 0 }, total_visuals: 1 });
  const audit = { schema_version: 2, critical: [], non_critical: [], sampled_stats: { total_t1: 1, sampled_t1: 1, total_t2: 0, sampled_t2: 0, total_t3: 0, sampled_t3: 0 }, passed: true };
  writeJson(root, 'audit-report.json', audit);
  assert.equal(run(root, '8-audit').status, 1);
  audit.visual_audit = { total: 1, checked: 1, embedded: 1, missing: [], orphan: [] };
  writeJson(root, 'audit-report.json', audit);
  assert.equal(run(root, '8-audit').status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
