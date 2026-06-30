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
  assert.deepEqual(files, ['AGENTS.md', 'boundary.md', 'review.md', 'scout.md', 'search.md', 'tool-guide.md'],
    `references/ must contain only AGENTS.md + boundary.md + review.md + scout.md + search.md + tool-guide.md, got: ${files.join(', ')}`);
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
  assert.match(boundary, /所有 uncovered priority 均为.*low/, 'must have low-priority termination rule');
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
  assert.match(review, /允许网页读取工具验证已有 URL/);
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
  assert.match(skill, /## 第 6 步.*混合派发/);
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
  assert.match(skill, /claim_id.*归一化/);
  assert.match(skill, /round.*loop 轮次/);
  assert.match(skill, /收敛检查/, 'must have convergence-based termination check');
  assert.match(skill, /directions\.json 格式/);
  assert.match(skill, /"direction".*"source_type".*"agent".*"ts"/);
  assert.match(skill, /direction.*source_type.*重复.*换路/);
});

// ===== M4: findings.jsonl schema completeness =====

test('findings.jsonl schema documents all three types and field applicability', () => {
  const skill = readRel('SKILL.md');
  // type 字段必填，枚举 finding/gap/red_flag
  assert.match(skill, /type.*finding.*gap.*red_flag/);
  // claim_id 仅 finding 需要
  assert.match(skill, /claim_id.*finding.*gap.*red_flag.*不需要/);
  // what 字段仅 gap 使用
  assert.match(skill, /\`what\` \| gap/);
  // reason 字段 gap 和 red_flag 都使用
  assert.match(skill, /\`reason\` \| gap \/ red_flag/);
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

// ===== M4: Schema 归一化巩固 =====

test('search.md §4.3 has hard constraint language for type/confidence/tier', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /硬约束.*不允许自创/, 'must have hard constraint language');
  assert.match(search, /只允许以下 3 个值/, 'must enumerate allowed type values on one line');
  assert.match(search, /整数不接受/, 'must reject integer tier values');
});

test('SKILL.md §3.3 has normalization step', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /校验.*归一化/, 'must have normalization step');
  assert.match(skill, /type.*不在.*强制改.*finding/, 'must force non-standard type to finding');
  assert.match(skill, /tier.*整数.*映射/, 'must map integer tier to string');
});

// ===== M6: 并发控制 =====

test('SKILL.md has concurrency cap of 5', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /最多并行 5/, 'must have ≤5 concurrency cap');
  assert.match(skill, /分两批/, 'must have batching strategy');
});

// ===== M7: One-shot 合成 =====

test('SKILL.md §7 has one-shot synthesis rule', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /一次性完成/, 'must have one-shot synthesis rule');
  assert.match(skill, /不要让.*Agent.*写/, 'must prohibit sub-agents from writing report');
});

// ===== M9: 截图/视频工作流 =====

test('tool-guide.md has correct screenshot save workflow', () => {
  const tool = readFileSync(join(REFERENCES, 'tool-guide.md'), 'utf8');
  assert.match(tool, /截图默认存到.*agent-browser.*tmp/, 'must document default save path');
  assert.match(tool, /不要用.*--file/, 'must warn against --file flag');
});

test('tool-guide.md uses t0/t1/t2 tab format (not raw integers)', () => {
  const tool = readFileSync(join(REFERENCES, 'tool-guide.md'), 'utf8');
  assert.match(tool, /tab t2/, 'must use t0/t1/t2 format');
  assert.doesNotMatch(tool, /tab 2\s/, 'must not show raw integer tab switching');
});

test('search.md §6.2 has screenshot→analyze→embed workflow', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /截图.*分析.*内嵌/, 'must have screenshot→analyze→embed flow');
  assert.match(search, /vision 工具分析/, 'must mention vision tool analysis');
});

// ===== M1: Scout Agent =====

test('search.md has no scout-specific content (scout reads search.md §2+§3 only)', () => {
  // scout prompt is generated by spawn-subagent.mjs, not stored in search.md
  // this test just verifies search.md §2+§3 exist for scout to read
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /## 2\. 起步查询规则/, 'scout reads §2');
  assert.match(search, /## 3\. 工具选择决策树/, 'scout reads §3');
});

// ===== M2: Search self-iteration =====

test('search.md §4 has hard loop constraint — no single-round return', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /不允许搜一轮就返回/, 'must prohibit single-round return');
  assert.match(search, /硬约束/, 'must be labeled as hard constraint');
});

test('search.md §4 has explicit exit conditions with tool call cap', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /退出条件/, 'must have exit conditions');
  assert.match(search, /10 次 tool call/, 'must have 10-call hard cap');
});

test('search.md §4.5 has cleanup step with follow_up_questions', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /### 4\.5 返回前 cleanup/, 'must have §4.5 cleanup section');
  assert.match(search, /follow_up_questions/, 'must mention follow_up_questions');
  assert.match(search, /不返回 raw HTML/, 'must prohibit returning raw content');
});

// ===== M3: follow_ups 机制 =====

test('search.md §4.3 JSONL has follow_up_questions field', () => {
  const search = readFileSync(join(REFERENCES, 'search.md'), 'utf8');
  assert.match(search, /follow_up_questions.*Genesys/, 'JSONL example must have follow_up_questions');
});

test('SKILL.md has follow_ups.json in state schema', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /follow_ups\.json/, 'must list follow_ups.json in state files');
  assert.match(skill, /resolved.*false/, 'must define resolved field');
});

test('SKILL.md §6 references follow_ups as direction source', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /follow_ups\.json.*resolved.*false/, 'must reference follow_ups.json with resolved');
});

// ===== M5: 边界重定义 =====

test('boundary.md has 4 check dimensions', () => {
  const boundary = readFileSync(join(REFERENCES, 'boundary.md'), 'utf8');
  assert.match(boundary, /覆盖度.*Coverage/);
  assert.match(boundary, /方向偏移.*Direction Drift/);
  assert.match(boundary, /实体准确.*Entity Accuracy/);
  assert.match(boundary, /Follow-ups 状态/);
});

test('boundary.md output schema has direction_drift + entity_mismatch + follow_ups_unresolved', () => {
  const boundary = readFileSync(join(REFERENCES, 'boundary.md'), 'utf8');
  assert.match(boundary, /direction_drift:/);
  assert.match(boundary, /entity_mismatch:/);
  assert.match(boundary, /follow_ups_unresolved:/);
});

test('boundary.md entity_mismatch forces no-terminate', () => {
  const boundary = readFileSync(join(REFERENCES, 'boundary.md'), 'utf8');
  assert.match(boundary, /entity_mismatch.*强制不终止/);
});

// ===== M8: 审计分级 =====

test('review.md has critical / non_critical grading', () => {
  const review = readFileSync(join(REFERENCES, 'review.md'), 'utf8');
  assert.match(review, /critical/);
  assert.match(review, /non_critical/);
  assert.match(review, /回 LOOP/);
});

test('SKILL.md §7.8 has re-loop trigger with hard cap 3', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /critical.*回 LOOP/);
  assert.match(skill, /最多 3 次/);
});

// ===== M12: task_spec 动态格式 =====

test('SKILL.md §2 has task_spec with status tracking + hierarchy', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /- \[ \].*子问题/, 'task_spec must use [ ] status prefix');
  assert.match(skill, /- \[x\].*✅/, 'task_spec must show [x] done format');
  assert.match(skill, /1\.1.*follow_up/, 'task_spec must support hierarchical sub-nodes');
});

test('SKILL.md §2.2 has task_spec operation rules', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /标记完成.*\[ \].*→.*\[x\]/, 'must have mark-done rule');
  assert.match(skill, /挂载 follow_up/, 'must have attach-followup rule');
  assert.match(skill, /新增子问题/, 'must have add-new rule');
  assert.match(skill, /合并子问题/, 'must have merge rule');
});

// ===== M13: task_spec 每轮更新 =====

test('SKILL.md has §3.5 task_spec update step', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /### 3\.5 更新 task_spec/, 'must have §3.5');
  assert.match(skill, /每轮必做/, 'must be mandatory each round');
  assert.match(skill, /派边界 Agent 之前做/, 'must run before boundary');
});

// ===== M14: 边界加完成度检查 =====

test('boundary.md has task_spec completion check', () => {
  const boundary = readFileSync(join(REFERENCES, 'boundary.md'), 'utf8');
  assert.match(boundary, /task_spec 完成度.*Task Spec Completion/, 'must have completion dimension');
  assert.match(boundary, /uncovered_subquestions/, 'must output uncovered subquestions');
  assert.match(boundary, /uncovered_subquestions.*强制不终止/, 'uncovered subquestions must block termination');
});

// ===== M15: 终止条件含完成度前置 =====

test('SKILL.md §5 has task_spec completion precondition', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /前置条件.*task_spec.*\[x\]/, 'must have completion precondition');
  assert.match(skill, /有.*\[ \].*子问题.*回第 6 步/, 'unchecked items must go to step 6');
});

// ===== M16: 混合派发 =====

test('SKILL.md §6 has mixed dispatch strategy', () => {
  const skill = readRel('SKILL.md');
  assert.match(skill, /P1 垂直深挖/, 'must have P1 vertical deep-dive');
  assert.match(skill, /P2 广度推进/, 'must have P2 breadth advance');
  assert.match(skill, /分配规则/, 'must have allocation rules');
});