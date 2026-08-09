/** normalize.mjs 的两轮、去重、完成条件与兼容性测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../normalize.mjs', import.meta.url));

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-normalize-'));
  fs.mkdirSync(path.join(dir, 'raw'));
  return dir;
}

function writeRaw(dir, file, rows, agent = 'agent') {
  const sentinel = { type: 'agent_done', agent, lines_written: rows.length, ts: '2026-07-18T00:00:00Z' };
  fs.writeFileSync(path.join(dir, 'raw', file), `${[...rows, sentinel].map(JSON.stringify).join('\n')}\n`);
}

function finding(overrides = {}) {
  return {
    type: 'finding',
    claim: '这是包含背景、限制条件和场景影响的完整证据结论，用来验证多轮研究的结构化数据是否正确。',
    claim_key: '1:entity:field',
    subquestion_ids: ['1'],
    fields_covered: ['价格'],
    sources: [{ url: 'https://example.com/a', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }],
    dimensions_seen: [{ dimension: '价格/合同条款', observation: '公开定价' }],
    ...overrides,
  };
}

function writeSpec(dir, extra = '') {
  fs.writeFileSync(path.join(dir, 'task_spec.md'), `# task\n\ntask_type: comparison\n\n- [ ] 1. 中文价格问题\n  - min_sources: 2\n  - min_t1: 1\n  - required_fields: [价格, 限制]\n  - max_age_days: 365\n${extra}`);
}

function run(dir) {
  return execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
}

function jsonl(dir) {
  return fs.readFileSync(path.join(dir, 'findings.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

test('normalize 确定性重建：同一批 raw 重跑不会追加', () => {
  const dir = makeDir();
  writeRaw(dir, 'search-r1-a.jsonl', [finding()]);
  run(dir);
  const first = fs.readFileSync(path.join(dir, 'findings.jsonl'), 'utf8');
  run(dir);
  const second = fs.readFileSync(path.join(dir, 'findings.jsonl'), 'utf8');
  assert.equal(second, first);
  assert.equal(jsonl(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('两轮同一 claim_key 合并来源，并保留 rounds_seen', () => {
  const dir = makeDir();
  writeSpec(dir);
  writeRaw(dir, 'search-r1-a.jsonl', [finding({
    fields_covered: ['价格'],
    sources: [{ url: 'https://vendor.example/pricing', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }],
  })], 'a');
  writeRaw(dir, 'search-r2-b.jsonl', [finding({
    claim: '同一结论的第二轮表述更完整，并补充独立来源、限制和跨实体对比，不能被当作新的事实重复计数。',
    fields_covered: ['限制'],
    sources: [{ url: 'https://review.example/analysis', tier: 'T2', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }],
    context_links: [{ claim_key: '1:other:field', relationship: 'compares' }],
  })], 'b');
  run(dir);
  const rows = jsonl(dir);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].rounds_seen, [1, 2]);
  assert.equal(rows[0].sources.length, 2);
  assert.equal(rows[0].confidence, '已验证事实');
  assert.deepEqual(rows[0].fields_covered, ['价格', '限制']);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json')));
  assert.equal(stats.total_findings, 1);
  assert.equal(stats.by_subquestion['1'].meets_criteria, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('同一 claim_key 的后续轮次会替换更长但陈旧的 claim', () => {
  const dir = makeDir();
  writeSpec(dir);
  const oldClaim = '第一轮只能把可核验时间下限写到 2013 年；这是一条刻意写得更长的旧结论，用来证明归一化器不能继续只按字数选择正文。';
  const updatedClaim = '第二轮把现存页面下限推进到 2012 年。';
  writeRaw(dir, 'search-r1-a.jsonl', [finding({
    claim: oldClaim,
    sources: [{ url: 'https://old.example/2013', tier: 'T2', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }],
  })], 'a');
  writeRaw(dir, 'search-r2-b.jsonl', [finding({
    claim: updatedClaim,
    sources: [{ url: 'https://new.example/2012', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }],
    context_links: [{ claim_key: '1:entity:field', relationship: 'extends' }],
  })], 'b');
  run(dir);
  const [row] = jsonl(dir);
  assert.equal(row.claim, updatedClaim);
  assert.deepEqual(row.rounds_seen, [1, 2]);
  assert.equal(row.sources.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('完成条件只认 subquestion_ids 和 fields_covered，不猜中文标题', () => {
  const dir = makeDir();
  writeSpec(dir);
  writeRaw(dir, 'search-r1-a.jsonl', [finding({ subquestion_ids: [], fields_covered: ['价格', '限制'] })]);
  run(dir);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json')));
  assert.equal(stats.unassigned_findings, 1);
  assert.equal(stats.by_subquestion['1'].findings_count, 0);
  assert.equal(stats.by_subquestion['1'].meets_criteria, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('required_fields 全覆盖后可完成，缺一个字段则不能完成', () => {
  const dir = makeDir();
  writeSpec(dir);
  writeRaw(dir, 'search-r1-a.jsonl', [finding({
    fields_covered: ['价格'],
    sources: [
      { url: 'https://a.example/x', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' },
      { url: 'https://b.example/x', tier: 'T2', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' },
    ],
  })]);
  run(dir);
  let stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json')));
  assert.deepEqual(stats.by_subquestion['1'].fields_missing, ['限制']);
  assert.equal(stats.by_subquestion['1'].meets_criteria, false);
  writeRaw(dir, 'search-r2-b.jsonl', [finding({ claim_key: '1:entity:limit', fields_covered: ['限制'], sources: [{ url: 'https://c.example/x', tier: 'T2', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' }] })]);
  run(dir);
  stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json')));
  assert.deepEqual(stats.by_subquestion['1'].fields_missing, []);
  assert.equal(stats.by_subquestion['1'].meets_criteria, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('过期来源不计入完成标准', () => {
  const dir = makeDir();
  writeSpec(dir);
  writeRaw(dir, 'search-r1-a.jsonl', [finding({
    fields_covered: ['价格', '限制'],
    sources: [
      { url: 'https://old-a.example/x', tier: 'T1', stance: 'supports', observed_at: '2020-01-01T00:00:00Z' },
      { url: 'https://old-b.example/x', tier: 'T2', stance: 'supports', observed_at: '2020-01-01T00:00:00Z' },
    ],
  })]);
  run(dir);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json')));
  assert.equal(stats.by_subquestion['1'].unique_urls, 0);
  assert.equal(stats.by_subquestion['1'].stale_sources, 2);
  assert.equal(stats.by_subquestion['1'].meets_criteria, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('相同结论的支持与反对来源会生成冲突信息', () => {
  const dir = makeDir();
  writeRaw(dir, 'search-r1-a.jsonl', [finding({ sources: [
    { url: 'https://a.example/x', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z' },
    { url: 'https://b.example/x', tier: 'T1', stance: 'contradicts', observed_at: '2026-07-18T00:00:00Z' },
  ] })]);
  run(dir);
  assert.equal(jsonl(dir)[0].confidence, '冲突信息');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gap 和 follow_up 按 subquestion_ids 进入对应缺口', () => {
  const dir = makeDir();
  writeSpec(dir);
  writeRaw(dir, 'search-r1-a.jsonl', [
    finding({ follow_up_questions: ['还要核对合同限制'] }),
    { type: 'gap', what: '企业价未公开', reason: '需联系销售', subquestion_ids: ['1'] },
  ]);
  run(dir);
  const gaps = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json'))).by_subquestion['1'].gaps_to_resolve;
  assert.deepEqual(gaps.sort(), ['企业价未公开', '还要核对合同限制'].sort());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('red_flag 保留结构化来源，供成稿解释版本冲突', () => {
  const dir = makeDir();
  writeRaw(dir, 'search-r1-a.jsonl', [{
    type: 'red_flag', claim: '旧版数字不能代表当前产品', reason: '产品代际不同', subquestion_ids: ['1'],
    sources: [{ url: 'https://legacy.example/limit', tier: 'T1', stance: 'supports', observed_at: '2026-07-18T00:00:00Z', source_date: '2024-01-01' }],
  }]);
  run(dir);
  const row = jsonl(dir)[0];
  assert.equal(row.type, 'red_flag');
  assert.equal(row.sources[0].url, 'https://legacy.example/limit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('旧 screenshot_path 会转成结构化 visual，并保留 context_links', () => {
  const dir = makeDir();
  writeRaw(dir, 'search-r2-a.jsonl', [finding({ screenshot_path: 'screenshots/a.png', context_links: [{ claim_key: '1:x:y', relationship: 'compares' }] })]);
  run(dir);
  const row = jsonl(dir)[0];
  assert.equal(row.screenshot_path, 'screenshots/a.png');
  assert.equal(row.visuals[0].screenshot_path, 'screenshots/a.png');
  assert.equal(row.visuals[0].source_page_url, 'https://example.com/a');
  assert.deepEqual(row.context_links, [{ claim_key: '1:x:y', relationship: 'compares' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('结构化图片会去重、合并并写入视觉统计', () => {
  const dir = makeDir();
  writeSpec(dir);
  const visual = { kind: 'table', image_url: 'https://example.com/pricing.png', source_page_url: 'https://example.com/a', caption: '官方套餐表展示三个档位', observed_at: '2026-07-18T00:00:00Z' };
  writeRaw(dir, 'search-r1-a.jsonl', [finding({ visuals: [visual] })], 'a');
  writeRaw(dir, 'search-r2-b.jsonl', [finding({ visuals: [visual], context_links: [{ claim_key: '1:other:field', relationship: 'compares' }] })], 'b');
  run(dir);
  assert.equal(jsonl(dir)[0].visuals.length, 1);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats-summary.json')));
  assert.equal(stats.total_visuals, 1);
  assert.equal(stats.by_visual_kind.table, 1);
  assert.equal(stats.by_subquestion['1'].visuals_count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('旧文件名不被静默算成第 1 轮', () => {
  const dir = makeDir();
  writeRaw(dir, 'search-legacy.jsonl', [finding()]);
  run(dir);
  const row = jsonl(dir)[0];
  assert.equal(row.round, null);
  assert.equal(row.legacy_round_unknown, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('非法 type 被拒绝，不伪装成 finding', () => {
  const dir = makeDir();
  writeRaw(dir, 'search-r1-a.jsonl', [{ type: 'funding_round', claim: 'x', url: 'https://x.example', tier: 'T1' }]);
  const result = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(fs.readFileSync(path.join(dir, 'parse_errors.log'), 'utf8'), /type 无效/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('坏 JSON 写入 parse_errors.log，仍保留有效行', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'raw', 'search-r1-a.jsonl'), `{bad}\n${JSON.stringify(finding())}\n${JSON.stringify({ type: 'agent_done', agent: 'a', lines_written: 2 })}\n`);
  run(dir);
  assert.equal(jsonl(dir).length, 1);
  assert.match(fs.readFileSync(path.join(dir, 'parse_errors.log'), 'utf8'), /JSON parse error/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('缺 raw 或缺参数时非零退出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-normalize-missing-'));
  assert.notEqual(spawnSync('node', [SCRIPT, dir]).status, 0);
  assert.equal(spawnSync('node', [SCRIPT]).status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
