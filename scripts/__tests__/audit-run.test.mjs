// audit-run.mjs 的最终交付语义测试。

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../audit-run.mjs', import.meta.url));

function writeRawOnlyTask(root) {
  fs.mkdirSync(path.join(root, 'raw'));
  fs.writeFileSync(path.join(root, 'task_spec.md'), [
    'task_type: general',
    'visual_evidence: off',
    'visual_evidence_reason: 纯文字回归夹具',
    '',
    '- [ ] 1. 核心问题',
    '  - min_sources: 1',
    '  - min_t1: 1',
    '  - required_fields: [核心字段]',
    '  - max_age_days: 365',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'progress.json'), `${JSON.stringify({ current_round: 1, stats: {} })}\n`);
  const finding = {
    type: 'finding',
    claim: '这是一条结构完整、来源明确的原始证据，用于证明原始阶段本身能够通过，但缺少后续报告时不能被最终完整验收误判为完成。',
    claim_key: '1:seed:complete',
    subquestion_ids: ['1'],
    fields_covered: ['核心字段'],
    sources: [{
      url: 'https://evidence.example/final-gate',
      tier: 'T1',
      stance: 'supports',
      observed_at: '2099-01-01T00:00:00Z',
    }],
    dimensions_seen: [],
    context_links: [],
    visuals: [],
  };
  const done = { type: 'agent_done', agent: 'seed', lines_written: 1 };
  fs.writeFileSync(
    path.join(root, 'raw', 'search-r1-seed.jsonl'),
    `${JSON.stringify(finding)}\n${JSON.stringify(done)}\n`,
  );
}

test('all 不得把只有 raw、缺少边界草稿和审查的半成品判为完成', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-final-gate-'));
  try {
    writeRawOnlyTask(root);
    const result = spawnSync(process.execPath, [SCRIPT, root, '--stage', 'all'], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /完整验收缺少必须产物/);
    assert.match(result.stderr, /boundary-report\.json/);
    assert.match(result.stderr, /draft\.md/);
    assert.match(result.stderr, /audit-report\.json/);
    assert.doesNotMatch(result.stdout, /完整验收通过/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('raw 分段验收仍允许检查尚未生成后续报告的任务', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-raw-stage-'));
  try {
    writeRawOnlyTask(root);
    const result = spawnSync(process.execPath, [SCRIPT, root, '--stage', 'raw'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /所选阶段全部通过/);
    assert.doesNotMatch(result.stdout, /完整验收通过/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
