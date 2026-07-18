/** calc-novelty 与 inject-hints 的闭环测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOVELTY = fileURLToPath(new URL('../calc-novelty.mjs', import.meta.url));
const HINTS = fileURLToPath(new URL('../inject-hints.mjs', import.meta.url));
const makeDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-loop-'));

test('连续两轮只有重复事实时触发 Rule A', () => {
  const dir = makeDir();
  const rows = [1, 2, 3].map((id) => ({ type: 'finding', claim_id: `c${id}`, claim_key: `1:a:${id}`, tier: 'T1', rounds_seen: [1, 2, 3] }));
  fs.writeFileSync(path.join(dir, 'findings.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
  execFileSync('node', [NOVELTY, dir]);
  const progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json')));
  assert.equal(progress.novelty_by_round['2'].novel_count, 0);
  assert.equal(progress.novelty_by_round['3'].novel_count, 0);
  assert.equal(progress.convergence.rule_a, true);
  assert.equal(progress.convergence.recommended, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('五轮信息增益持续下降且末轮低于 20% 时触发 Rule B', () => {
  const dir = makeDir();
  const discoveryCounts = [10, 4, 3, 2, 1];
  const rows = [];
  let id = 0;
  discoveryCounts.forEach((count, index) => {
    const discoveryRound = index + 1;
    for (let i = 0; i < count; i++) {
      id++;
      rows.push({ type: 'finding', claim_id: `c${id}`, claim_key: `1:a:${id}`, tier: 'T2', rounds_seen: Array.from({ length: 6 - discoveryRound }, (_, offset) => discoveryRound + offset) });
    }
  });
  fs.writeFileSync(path.join(dir, 'findings.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
  execFileSync('node', [NOVELTY, dir]);
  const convergence = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'))).convergence;
  assert.deepEqual(convergence.recent_novel_counts, [3, 2, 1]);
  assert.equal(convergence.rule_b, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject-hints 输出线索和 source_claim_keys，并支持 target 过滤', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'boundary-report.json'), JSON.stringify({ cross_agent_hints: [
    { target: 'Intercom', hint: '对比 Salesforce 的委派能力', source_claim_keys: ['1:salesforce:delegation'] },
    { target: 'Zendesk', hint: '补充流程限制', source_claim_keys: ['1:zendesk:limits'] },
  ] }));
  const output = execFileSync('node', [HINTS, dir, '--target', 'Intercom'], { encoding: 'utf8' });
  assert.match(output, /对比 Salesforce/);
  assert.match(output, /source_claim_keys: 1:salesforce:delegation/);
  assert.doesNotMatch(output, /Zendesk/);
  fs.rmSync(dir, { recursive: true, force: true });
});
