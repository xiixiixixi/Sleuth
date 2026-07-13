/**
 * normalize.mjs 测试。
 *
 * Integration 风格：execFileSync 跑脚本，验证输出文件。
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = fileURLToPath(new URL('../normalize.mjs', import.meta.url));

/** 创建临时 task-dir + raw/ 文件 */
function setupTaskDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-test-'));
  const rawDir = path.join(dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(rawDir, name), content, 'utf8');
  }
  return dir;
}

import fs from 'node:fs';

function runNormalize(taskDir) {
  return execFileSync('node', [SCRIPT, taskDir], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

// ===== 基本流程 =====

test('normalize: reads raw/ → writes findings.jsonl + stats-summary.json', () => {
  const dir = setupTaskDir({
    'search-intercom.jsonl': JSON.stringify({ type: 'finding', claim: 'Intercom 定价 $1', url: 'https://intercom.com/pricing', tier: 'T1', confidence: '已验证事实', dimensions_seen: [{ dimension: '定价', observation: '$1/seat' }] }) + '\n' +
      JSON.stringify({ type: 'agent_done', agent: 'intercom', lines_written: 1, ts: '2026-07-01T00:00:00Z' }) + '\n',
  });

  const out = runNormalize(dir);
  assert.ok(existsSync(path.join(dir, 'findings.jsonl')), 'findings.jsonl must exist');
  assert.ok(existsSync(path.join(dir, 'stats-summary.json')), 'stats-summary.json must exist');

  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'finding');
  assert.equal(findings[0].claim, 'Intercom 定价 $1');
  assert.ok(findings[0].claim_id, 'must have claim_id');
  assert.equal(findings[0].agent, 'intercom');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: agent_done sentinel does not enter findings.jsonl', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'finding', claim: 'test', url: 'https://example.com', tier: 'T1', confidence: '已验证事实' }) + '\n' +
      JSON.stringify({ type: 'agent_done', agent: 'test', lines_written: 1, ts: '2026-07-01T00:00:00Z' }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings.length, 1, 'only the finding, not the sentinel');
  assert.equal(findings[0].type, 'finding');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 字段归一化 =====

test('normalize: integer tier → T1/T2/T3', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'finding', claim: 'a', url: 'https://a.com', tier: 1 }) + '\n' +
      JSON.stringify({ type: 'finding', claim: 'b', url: 'https://b.com', tier: 2 }) + '\n' +
      JSON.stringify({ type: 'finding', claim: 'c', url: 'https://c.com', tier: 3 }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings[0].tier, 'T1');
  assert.equal(findings[1].tier, 'T2');
  assert.equal(findings[2].tier, 'T3');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: non-standard type → forced to finding', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'funding_round', claim: 'raised $10M', url: 'https://a.com', tier: 'T1' }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings[0].type, 'finding', 'non-standard type forced to finding');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: missing confidence → inferred from tier', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'finding', claim: 'a', url: 'https://a.com', tier: 'T1' }) + '\n' +
      JSON.stringify({ type: 'finding', claim: 'b', url: 'https://b.com', tier: 'T3' }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings[0].confidence, '高置信推断', 'T1/T2 → 高置信推断');
  assert.equal(findings[1].confidence, '未确认线索', 'T3 → 未确认线索');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: string dimensions_seen → object array', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'finding', claim: 'a', url: 'https://a.com', tier: 'T1', dimensions_seen: ['price', 'date'] }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.ok(Array.isArray(findings[0].dimensions_seen));
  assert.equal(findings[0].dimensions_seen[0].dimension, 'price');
  assert.equal(findings[0].dimensions_seen[1].dimension, 'date');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: URL normalized (lowercase host, no utm)', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'finding', claim: 'a', url: 'https://Example.com/pricing?utm_source=foo&id=1', tier: 'T1' }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.ok(findings[0].url.includes('example.com'), 'host lowercased');
  assert.ok(!findings[0].url.includes('utm_'), 'utm params removed');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== gap / red_flag =====

test('normalize: gap and red_flag pass through', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'gap', what: 'missing pricing', reason: 'no official source' }) + '\n' +
      JSON.stringify({ type: 'red_flag', claim: 'conflicting prices', reason: 'A says $1, B says $2' }) + '\n',
  });

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings.length, 2);
  assert.equal(findings[0].type, 'gap');
  assert.equal(findings[1].type, 'red_flag');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== parse errors =====

test('normalize: malformed lines go to parse_errors.log', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': '{ broken json\n' +
      JSON.stringify({ type: 'finding', claim: 'good', url: 'https://a.com', tier: 'T1' }) + '\n',
  });

  runNormalize(dir);
  assert.ok(existsSync(path.join(dir, 'parse_errors.log')), 'parse_errors.log must exist');
  const errors = readFileSync(path.join(dir, 'parse_errors.log'), 'utf8');
  assert.ok(errors.includes('broken json'), 'error must mention the bad line');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: finding missing required fields → rejected', () => {
  const dir = setupTaskDir({
    'search-test.jsonl': JSON.stringify({ type: 'finding', claim: 'no url', tier: 'T1' }) + '\n',
  });

  // 脚本在 >50% 行被拒时 exit(1)，这是预期行为
  try {
    runNormalize(dir);
  } catch {
    // exit(1) 是正常的——表示 Agent 结果质量太差
  }
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings.length, 0, 'finding without url should be rejected');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== stats-summary.json =====

test('normalize: stats-summary.json has correct structure', () => {
  const dir = setupTaskDir({
    'search-test.jsonl':
      JSON.stringify({ type: 'finding', claim: 'Intercom pricing $1', url: 'https://intercom.com/p1', tier: 'T1' }) + '\n' +
      JSON.stringify({ type: 'finding', claim: 'Intercom features', url: 'https://intercom.com/p2', tier: 'T1' }) + '\n' +
      JSON.stringify({ type: 'gap', what: 'missing', reason: 'none' }) + '\n',
  });

  // 写 task_spec.md
  fs.writeFileSync(path.join(dir, 'task_spec.md'),
    '# task_spec\n\n## 子问题\n\n- [ ] 1. Intercom 定价\n  - min_sources: 2\n  - min_t1: 1\n  - required_fields: []\n  - max_age_days: 365\n',
    'utf8');

  runNormalize(dir);
  const summary = readJson(path.join(dir, 'stats-summary.json'));

  assert.ok(summary.total_findings !== undefined);
  assert.ok(summary.by_type);
  assert.ok(summary.by_tier);
  assert.equal(summary.by_type.finding, 2);
  assert.equal(summary.by_type.gap, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: gaps_to_resolve populated from follow_up_questions and gaps', () => {
  const dir = setupTaskDir({
    'search-test.jsonl':
      JSON.stringify({ type: 'finding', claim: 'Intercom pricing $1', url: 'https://intercom.com/p1', tier: 'T1', follow_up_questions: ['Intercom API 限制?'] }) + '\n' +
      JSON.stringify({ type: 'gap', what: 'Intercom 企业定价缺失', reason: '联系销售' }) + '\n',
  });

  fs.writeFileSync(path.join(dir, 'task_spec.md'),
    '# task_spec\n\n## 子问题\n\n- [ ] 1. Intercom 定价\n  - min_sources: 2\n  - min_t1: 1\n  - required_fields: []\n  - max_age_days: 365\n',
    'utf8');

  runNormalize(dir);
  const summary = readJson(path.join(dir, 'stats-summary.json'));

  // gaps_to_resolve 应该包含 follow_up_questions + gap 的 what
  const gaps = summary.by_subquestion['1'].gaps_to_resolve;
  assert.ok(gaps.length >= 2, `gaps_to_resolve should have follow_up + gap, got ${gaps.length}`);
  assert.ok(gaps.some((g) => g.includes('API 限制')), 'should contain follow_up_question');
  assert.ok(gaps.some((g) => g.includes('企业定价')), 'should contain gap what');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== append behavior =====

test('normalize: appends to existing findings.jsonl (not overwrite)', () => {
  const dir = setupTaskDir({
    'search-round2.jsonl': JSON.stringify({ type: 'finding', claim: 'round2 finding', url: 'https://r2.com', tier: 'T2' }) + '\n',
  });

  // 先写一个已有的 findings.jsonl
  fs.writeFileSync(path.join(dir, 'findings.jsonl'),
    JSON.stringify({ type: 'finding', claim: 'existing', url: 'https://old.com', tier: 'T1' }) + '\n',
    'utf8');

  runNormalize(dir);
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  assert.equal(findings.length, 2, 'should have 1 existing + 1 new');
  assert.equal(findings[0].claim, 'existing');
  assert.equal(findings[1].claim, 'round2 finding');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== error cases =====

test('normalize: exits non-zero when raw/ missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-test-'));
  assert.throws(() => runNormalize(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: exits non-zero when task-dir arg missing', () => {
  assert.throws(() => execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
});
