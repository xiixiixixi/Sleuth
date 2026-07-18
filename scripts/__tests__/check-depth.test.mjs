/** check-depth.mjs 检查证据结构和跨 Agent 递进。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../check-depth.mjs', import.meta.url));

function setup(taskType = 'comparison') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-depth-'));
  fs.mkdirSync(path.join(dir, 'raw'));
  fs.writeFileSync(path.join(dir, 'task_spec.md'), `task_type: ${taskType}\n`);
  return dir;
}

function finding(key, contextLinks = []) {
  return {
    type: 'finding', claim: '证据结论', claim_key: key, subquestion_ids: ['1'], fields_covered: [],
    sources: [{ url: `https://${key.replace(/[^a-z0-9]/gi, '')}.example/x`, tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }],
    dimensions_seen: [], context_links: contextLinks,
  };
}

function writeRaw(dir, file, rows) {
  const all = [...rows, { type: 'agent_done', agent: 'a', lines_written: rows.length }];
  fs.writeFileSync(path.join(dir, 'raw', file), `${all.map(JSON.stringify).join('\n')}\n`);
}

function run(dir) {
  return spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
}

test('第一轮结构完整即可通过，短说明只提醒不冒充证据质量', () => {
  const dir = setup();
  writeRaw(dir, 'search-r1-a.jsonl', [finding('1:a:x')]);
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /提醒/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'depth-report.json'))).passed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('同一 Agent 重复 claim_key 会失败', () => {
  const dir = setup();
  writeRaw(dir, 'search-r1-a.jsonl', [finding('1:a:x'), finding('1:a:x')]);
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /重复 claim_key/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('零有效产出会失败', () => {
  const dir = setup();
  writeRaw(dir, 'search-r1-a.jsonl', []);
  assert.equal(run(dir).status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('comparison 第二轮没有 context_links 会失败', () => {
  const dir = setup('comparison');
  writeRaw(dir, 'search-r2-a.jsonl', [finding('1:a:x')]);
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /没有 context_links/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('comparison 第二轮必须出现 compares 关系', () => {
  const dir = setup('comparison');
  writeRaw(dir, 'search-r2-a.jsonl', [finding('1:a:x', [{ claim_key: '1:b:x', relationship: 'compares' }])]);
  assert.equal(run(dir).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deep_dive 第二轮用错误关系失败，用 extends 通过', () => {
  const dir = setup('deep_dive');
  writeRaw(dir, 'search-r2-a.jsonl', [finding('1:a:x', [{ claim_key: '1:a:parent', relationship: 'compares' }])]);
  assert.equal(run(dir).status, 1);
  writeRaw(dir, 'search-r2-a.jsonl', [finding('1:a:x', [{ claim_key: '1:a:parent', relationship: 'extends' }])]);
  assert.equal(run(dir).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('general 第二轮不强制跨 Agent 关系', () => {
  const dir = setup('general');
  writeRaw(dir, 'search-r2-a.jsonl', [finding('1:a:x')]);
  assert.equal(run(dir).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const [taskType, relationship] of Object.entries({
  comparison: 'compares', deep_dive: 'extends', timeline: 'follows', causal: 'causes',
  problem_solving: 'bounds', enumeration: 'complements', debate: 'contradicts',
})) {
  test(`${taskType} 的第二轮接受对应递进关系 ${relationship}`, () => {
    const dir = setup(taskType);
    writeRaw(dir, 'search-r2-a.jsonl', [finding('1:a:x', [{ claim_key: '1:prior:x', relationship }])]);
    assert.equal(run(dir).status, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('缺 raw 或参数错误返回 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-depth-missing-'));
  assert.equal(run(dir).status, 2);
  assert.equal(spawnSync('node', [SCRIPT]).status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
