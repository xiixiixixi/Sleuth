/** CURRENT-PROBLEM.md：7 种任务的线索中继与第二轮递进端到端验收。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relationships = {
  comparison: 'compares', deep_dive: 'extends', timeline: 'follows', causal: 'causes',
  problem_solving: 'bounds', enumeration: 'complements', debate: 'contradicts',
};

function source(url) { return { url, tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }; }
function raw(filePath, rows, agent) {
  const normalizedRows = rows.map((row) => row.type === 'finding' && row.visuals === undefined ? { ...row, visuals: [] } : row);
  const pages = [...new Set(normalizedRows.filter((row) => row.type === 'finding').flatMap((row) => (row.sources || []).map((source) => source.url)))].map((url) => ({ url, candidates_seen: 0, useful_saved: 0, reason: '端到端夹具不访问真实网页图片' }));
  const visualScan = { status: 'none_useful', candidates_seen: 0, useful_saved: 0, reason: '端到端夹具不访问真实网页图片', pages };
  fs.writeFileSync(filePath, `${[...normalizedRows, { type: 'agent_done', agent, lines_written: normalizedRows.length, visual_scan: visualScan }].map(JSON.stringify).join('\n')}\n`);
}
function run(script, args) { return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' }); }

for (const [taskType, relationship] of Object.entries(relationships)) {
  test(`${taskType}：R1 缺口被拦截，hint 注入后 R2 形成 ${relationship} 递进并通过最终审计`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sleuth-${taskType}-`));
    fs.mkdirSync(path.join(dir, 'raw'));
    fs.writeFileSync(path.join(dir, 'task_spec.md'), `task_type: ${taskType}\nvisual_evidence: auto\n\n- [ ] 1. 核心问题\n  - min_sources: 2\n  - min_t1: 1\n  - required_fields: [核心字段]\n  - max_age_days: 365\n`);
    fs.writeFileSync(path.join(dir, 'directions.json'), '[]\n');
    fs.writeFileSync(path.join(dir, 'follow_ups.json'), '[]\n');
    fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify({ current_round: 1, stats: {} }));

    raw(path.join(dir, 'raw', 'search-r1-seed.jsonl'), [{
      type: 'finding', claim: '第一轮确认基础事实及其适用边界，作为下一轮跨 Agent 深挖时必须使用的参照信息。',
      claim_key: '1:seed:base', subquestion_ids: ['1'], fields_covered: ['核心字段'],
      sources: [source('https://seed.example/evidence')], dimensions_seen: [], context_links: [],
    }], 'seed');
    execFileSync(process.execPath, [path.join(SCRIPTS, 'normalize.mjs'), dir]);
    execFileSync(process.execPath, [path.join(SCRIPTS, 'calc-novelty.mjs'), dir]);

    const hints = [1, 2, 3].map((index) => ({ target: `target-${index}`, hint: `基于第一轮结论补第${index}个角度`, rationale: '让下一轮使用前序信息', source_claim_keys: ['1:seed:base'] }));
    fs.writeFileSync(path.join(dir, 'boundary-report.json'), JSON.stringify({
      schema_version: 2, terminate_recommended: false, task_type: taskType,
      evidence_map: { by_subquestion: { '1': { supported_claim_keys: ['1:seed:base'] } }, unassigned_findings: [] },
      uncovered_subquestions: [{ id: '1', title: '核心问题', reason: '独立来源不足' }], uncovered_dimensions: [], direction_drift: [], entity_mismatch: [],
      follow_ups_unresolved: 0, cross_agent_hints: hints, rationale: '需要第二轮',
    }));
    assert.equal(run('validate-state.mjs', [dir, '--phase', '4']).status, 1, '第一轮必须被边界门拦住');
    const injected = execFileSync(process.execPath, [path.join(SCRIPTS, 'inject-hints.mjs'), dir], { encoding: 'utf8' });
    assert.match(injected, /source_claim_keys: 1:seed:base/);

    raw(path.join(dir, 'raw', 'search-r2-target.jsonl'), [{
      type: 'finding', claim: '第二轮明确使用第一轮参照，并从对应任务类型需要的关系继续推进，形成可审计的深层结论。',
      claim_key: '1:target:deeper', subquestion_ids: ['1'], fields_covered: ['核心字段'],
      sources: [source('https://target.example/evidence')], dimensions_seen: [],
      context_links: [{ claim_key: '1:seed:base', relationship }],
    }], 'target');
    fs.writeFileSync(path.join(dir, 'boundary-report.json'), JSON.stringify({
      schema_version: 2, terminate_recommended: true, task_type: taskType,
      evidence_map: { by_subquestion: { '1': { supported_claim_keys: ['1:seed:base', '1:target:deeper'] } }, unassigned_findings: [] },
      uncovered_subquestions: [], uncovered_dimensions: [], direction_drift: [], entity_mismatch: [], follow_ups_unresolved: 0, cross_agent_hints: [], rationale: '已经形成跨轮递进且完成',
    }));
    fs.writeFileSync(path.join(dir, 'draft.md'), '# 报告\n\n## 1. 核心问题\n\n[基础结论](https://seed.example/evidence)与[递进结论](https://target.example/evidence)。\n');
    fs.writeFileSync(path.join(dir, 'audit-report.json'), JSON.stringify({
      schema_version: 2, critical: [], non_critical: [], sampled_stats: { total_t1: 2, sampled_t1: 2, total_t2: 0, sampled_t2: 0, total_t3: 0, sampled_t3: 0 }, passed: true,
    }));

    const audit = run('audit-run.mjs', [dir, '--stage', 'all']);
    assert.equal(audit.status, 0, `${audit.stdout}\n${audit.stderr}`);
    assert.match(audit.stdout, /完整验收通过：raw、research、draft、final 全部通过/);
    const findings = fs.readFileSync(path.join(dir, 'findings.jsonl'), 'utf8');
    assert.match(findings, new RegExp(`"relationship":"${relationship}"`));
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
