/**
 * references/ + SKILL.md 结构防回潮测试。
 *
 * 文档结构（2026-06-19 第三次重构）：
 *   SKILL.md            主 Agent 操作手册（含合成/证据分层/交付）
 *   references/
 *     search.md         搜索子 Agent
 *     boundary.md       边界子 Agent
 *     review.md         审查子 Agent
 *     tool-guide.md     通用工具手册
 *
 * 旧文件（research.md / synthesis.md / search-guide.md / deep-research.md /
 * multi-agent.md / orchestration.md）必须不存在。
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const REFERENCES = join(ROOT, 'references');

function readRel(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

test('references/ has exactly AGENTS.md + boundary.md + review.md + search.md + tool-guide.md', () => {
  const files = readdirSync(REFERENCES).filter(f => !f.startsWith('.'));
  files.sort();
  assert.deepEqual(files, ['AGENTS.md', 'boundary.md', 'review.md', 'search.md', 'tool-guide.md'],
    `references/ must contain only AGENTS.md + boundary.md + review.md + search.md + tool-guide.md, got: ${files.join(', ')}`);
});

test('old references files are gone (no rollback)', () => {
  const oldFiles = [
    'search-guide.md',
    'deep-research.md',
    'multi-agent.md',
    'orchestration.md',
    'research.md',
    'synthesis.md',
  ];
  for (const f of oldFiles) {
    assert.strictEqual(existsSync(join(REFERENCES, f)), false, `${f} must not exist in references/`);
  }
});

test('tool-guide.md preserved as independent file', () => {
  assert.ok(existsSync(join(REFERENCES, 'tool-guide.md')), 'tool-guide.md must exist');
  const tool = readFileSync(join(REFERENCES, 'tool-guide.md'), 'utf8');
  assert.match(tool, /pushstate/, 'must contain SPA pushstate command');
  assert.match(tool, /frame/, 'must contain iframe frame command');
  assert.match(tool, /network requests/, 'must contain network requests command');
  assert.match(tool, /keyboard type|mouse move/, 'must contain low-level mouse/keyboard');
  assert.match(tool, /find text|find role|find label/, 'must contain find by text/role/label');
});

test('SKILL.md references search.md + boundary.md + review.md + tool-guide.md', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /references\/search\.md/, 'must reference search.md');
  assert.match(skill, /references\/boundary\.md/, 'must reference boundary.md');
  assert.match(skill, /references\/review\.md/, 'must reference review.md');
  assert.match(skill, /tool-guide\.md/, 'must reference tool-guide.md');
  assert.doesNotMatch(skill, /references\/synthesis\.md/, 'must not reference removed synthesis.md');
});

test('root AGENTS.md points to new references structure', () => {
  const agents = readRel('AGENTS.md');
  assert.match(agents, /references\/search\.md/);
  assert.match(agents, /references\/boundary\.md/);
  assert.match(agents, /references\/review\.md/);
  assert.match(agents, /references\/tool-guide\.md/);
  assert.doesNotMatch(agents, /references\/synthesis\.md/);
});

test('README.md directory tree lists all 4 references', () => {
  const readme = readRel('README.md');
  assert.match(readme, /search\.md/);
  assert.match(readme, /boundary\.md/);
  assert.match(readme, /review\.md/);
  assert.match(readme, /tool-guide\.md/);
  assert.doesNotMatch(readme, /synthesis\.md/);
});

test('references/AGENTS.md lists all 4 references', () => {
  const meta = readFileSync(join(REFERENCES, 'AGENTS.md'), 'utf8');
  assert.match(meta, /search\.md/);
  assert.match(meta, /boundary\.md/);
  assert.match(meta, /review\.md/);
  assert.match(meta, /tool-guide\.md/);
  assert.doesNotMatch(meta, /synthesis\.md/);
});

// ===== search.md 内容 =====

test('search.md covers required content blocks', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /## 1\. 必搜 vs 必不搜/);
  assert.match(search, /## 2\. 起步查询规则/);
  assert.match(search, /## 3\. 工具选择决策树/);
  assert.match(search, /## 4\. 核心循环/);
  assert.match(search, /## 5\. 终止信号/);
  assert.match(search, /失败兜底/);
  assert.match(search, /视频|音频|PDF|图片/);
});

test('search.md requires dimensions_seen in JSONL output', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /dimensions_seen/);
});

// ===== boundary.md 内容 =====

test('boundary.md has 4 fixed dimensions + terminate_recommended + output schema', () => {
  const boundary = readFileSync(join(REFERENCES, 'boundary.md'), 'utf8');
  assert.match(boundary, /来源类型多样性/);
  assert.match(boundary, /视角覆盖/);
  assert.match(boundary, /时间覆盖/);
  assert.match(boundary, /地域\/语境覆盖/);
  assert.match(boundary, /terminate_recommended/);
  assert.match(boundary, /uncovered_dimensions/);
  assert.match(boundary, /priority 均为.*low.*数量 ≤ 2.*terminate_recommended: true/);
});

// ===== review.md 内容 =====

test('review.md has 4 audit items + Tier grading + layered sampling + 5-level confidence', () => {
  const review = readFileSync(join(REFERENCES, 'review.md'), 'utf8');
  assert.match(review, /缺源 claim/);
  assert.match(review, /幻觉 URL/);
  assert.match(review, /抹平冲突/);
  assert.match(review, /可信度分级错误/);
  assert.match(review, /Tier 1.*抽 5-10/);
  assert.match(review, /Tier 2.*抽 50%/);
  assert.match(review, /Tier 3.*100%/);
  assert.match(review, /已验证事实/);
  assert.match(review, /高置信推断/);
  assert.match(review, /sampled_stats/);
  assert.match(review, /允许 WebFetch 验证已有 URL/);
});

// ===== SKILL.md 结构 =====

test('SKILL.md has operation-manual structure (第 0-7 步)', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /## 第 0 步.*环境检查/);
  assert.match(skill, /## 第 1 步.*判断任务复杂度/);
  assert.match(skill, /## 第 2 步.*task_spec/);
  assert.match(skill, /## 第 3 步.*派搜索 Agent/);
  assert.match(skill, /## 第 4 步.*派边界 Agent/);
  assert.match(skill, /## 第 5 步.*检查终止信号/);
  assert.match(skill, /## 第 6 步.*写新方向/);
  assert.match(skill, /## 第 7 步.*合成.*审查/);
  assert.match(skill, /task_spec\.md/);
  assert.match(skill, /findings\.jsonl/);
  assert.match(skill, /directions\.json/);
});

test('SKILL.md has synthesis rules inlined (Tier + 5-level + conflict + citation)', () => {
  const skill = readRel('SKILL.md');
  // 证据分层（从 synthesis.md §5 移入）
  assert.match(skill, /Tier 1/);
  assert.match(skill, /Tier 2/);
  assert.match(skill, /Tier 3/);
  assert.match(skill, /已验证事实/);
  assert.match(skill, /高置信推断/);
  // 冲突处理
  assert.match(skill, /冲突处理/);
  // 引用纪律
  assert.match(skill, /引用纪律/);
  assert.match(skill, /内联来源 URL/);
});

test('SKILL.md has claim_id + round schema + directions.json schema', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /claim_id.*sha1/);
  assert.match(skill, /round.*loop 轮次/);
  assert.match(skill, /Set Round N.*Set Round N-1/);
  assert.match(skill, /directions\.json 格式/);
  assert.match(skill, /"direction".*"source_type".*"agent".*"ts"/);
  assert.match(skill, /direction.*source_type.*重复.*换路/);
});

test('SKILL.md has goal-oriented prompt principle', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /说要什么，不说怎么做/);
  assert.match(skill, /must-verify/);
  assert.match(skill, /spawn-subagent\.mjs/);
});

test('SKILL.md has "长程任务行为" section with 3 behavioral constraints', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /## 长程任务行为/);
  assert.match(skill, /零交互/);
  assert.match(skill, /就绪即执行/);
  assert.match(skill, /状态持久化/);
  assert.match(skill, /认知循环/);
});

test('SKILL.md does NOT contain system-layer framework details', () => {
  const skill = readRel('SKILL.md');
  assert.doesNotMatch(skill, /心跳看门狗|heartbeat watchdog/);
  assert.doesNotMatch(skill, /stale_count/);
  assert.doesNotMatch(skill, /progress\.json/);
  assert.doesNotMatch(skill, /iteration_log/);
  assert.doesNotMatch(skill, /L0.*L1.*L2|三层相互校验/);
  assert.doesNotMatch(skill, /\/loop 2h|cron|resident shell|hourly patrol/);
});

test('boundary.md and review.md do NOT duplicate tool-guide.md commands', () => {
  const boundary = readFileSync(join(REFERENCES, 'boundary.md'), 'utf8');
  assert.doesNotMatch(boundary, /pushstate/);
  assert.doesNotMatch(boundary, /frame "#iframe-selector"|frame main/);
  assert.doesNotMatch(boundary, /network requests/);

  const review = readFileSync(join(REFERENCES, 'review.md'), 'utf8');
  assert.doesNotMatch(review, /pushstate/);
  assert.doesNotMatch(review, /frame "#iframe-selector"|frame main/);
  assert.doesNotMatch(review, /network requests/);
});

test('references/ do NOT contain system-layer scheduling details', () => {
  for (const f of ['search.md', 'boundary.md', 'review.md', 'tool-guide.md']) {
    const content = readFileSync(join(REFERENCES, f), 'utf8');
    assert.doesNotMatch(content, /心跳看门狗|heartbeat watchdog/);
    assert.doesNotMatch(content, /stale_count/);
    assert.doesNotMatch(content, /L0.*L1.*L2|三层相互校验/);
  }
});

test('references/ do NOT reference SKILL.md (self-contained for sub-agents)', () => {
  for (const f of ['search.md', 'boundary.md', 'review.md', 'tool-guide.md']) {
    const content = readFileSync(join(REFERENCES, f), 'utf8');
    assert.doesNotMatch(content, /SKILL\.md/, `${f} must not reference SKILL.md (sub-agents can't read it)`);
  }
});
