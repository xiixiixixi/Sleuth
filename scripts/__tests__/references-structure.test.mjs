/** 主流程与 references 的契约测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('references 只保留当前 5 个角色/工具文档', () => {
  const files = readdirSync(path.join(ROOT, 'references')).filter((file) => !file.startsWith('.')).sort();
  assert.deepEqual(files, ['AGENTS.md', 'boundary.md', 'review.md', 'scout.md', 'search.md', 'tool-guide.md']);
});

test('已废弃 references 和会话系统不会回归', () => {
  for (const file of ['search-guide.md', 'deep-research.md', 'multi-agent.md', 'orchestration.md', 'research.md', 'synthesis.md']) {
    assert.equal(existsSync(path.join(ROOT, 'references', file)), false);
  }
  const all = ['SKILL.md', 'references/search.md', 'references/boundary.md', 'references/review.md', 'scripts/spawn-subagent.mjs'].map(read).join('\n');
  assert.doesNotMatch(all, /session-logger|--main-sid|subagent_done|deliver\.mjs|research-index/);
});

test('SKILL.md 保持精简且只承担主调度', () => {
  const skill = read('SKILL.md');
  const lines = skill.split('\n').length;
  assert.ok(lines <= 150, `SKILL.md 应不超过 150 行，当前 ${lines}`);
  assert.match(skill, /主 Agent 只调度/);
  assert.doesNotMatch(skill, /```jsonl/);
  assert.doesNotMatch(skill, /## Tier 分级|## 5 级可信度/);
});

test('SKILL.md 的机器步骤顺序完整', () => {
  const skill = read('SKILL.md');
  const commands = ['check-deps.mjs', 'spawn-subagent.mjs --role scout', '--phase 1.5', '--phase 2', '--phase 2-typecheck', '--role search', '--phase 3-raw', 'normalize.mjs', 'check-depth.mjs', '--phase 3-findings', 'calc-novelty.mjs', '--role boundary', '--phase 4', 'inject-hints.mjs', '--phase 7-ready', '--role synthesize', '--phase 7-draft', '--role review', '--phase 8-audit'];
  let cursor = -1;
  for (const command of commands) {
    const next = skill.indexOf(command, cursor + 1);
    assert.ok(next > cursor, `${command} 缺失或顺序错误`);
    cursor = next;
  }
});

test('SKILL.md 不自动启动 Chrome，并保留安全边界', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /禁止自动运行 `launch-chrome\.mjs`/);
  assert.match(skill, /最多并行 5/);
  assert.match(skill, /改变范围前必须询问用户/);
  assert.match(skill, /只有 `8-audit` 通过才能交付/);
});

test('search.md 定义可审计的多来源 finding', () => {
  const search = read('references/search.md');
  for (const field of ['claim_key', 'subquestion_ids', 'fields_covered', 'sources', 'source_date', 'observed_at', 'context_links']) {
    assert.match(search, new RegExp(field));
  }
  assert.match(search, /禁止只保留一个网址/);
  assert.match(search, /red_flag.*sources/);
  assert.match(search, /禁止只把 URL 塞在 reason/);
});

test('search.md 保留搜索判断、失败处理与多模态流程', () => {
  const search = read('references/search.md');
  for (const section of ['必搜 vs 必不搜', '起步查询规则', '工具选择决策树', '核心循环', '终止信号', '失败兜底', '视频', '音频', 'PDF', '图片']) {
    assert.match(search, new RegExp(section));
  }
});

test('boundary.md 支持 7 种深度类型和跨 Agent 证据连接', () => {
  const boundary = read('references/boundary.md');
  for (const type of ['comparison', 'deep_dive', 'timeline', 'causal', 'problem_solving', 'enumeration', 'debate']) {
    assert.match(boundary, new RegExp(type));
  }
  assert.match(boundary, /source_claim_keys/);
  assert.match(boundary, /evidence_map/);
  assert.match(boundary, /boundary-report\.json/);
  assert.doesNotMatch(boundary, /```yaml/);
});

test('boundary.md 保留覆盖、偏移、实体和追问四项检查', () => {
  const boundary = read('references/boundary.md');
  for (const item of ['覆盖度', '方向偏移', '实体准确', 'Follow-ups 状态', 'entity_mismatch', 'follow_ups_unresolved']) {
    assert.match(boundary, new RegExp(item));
  }
});

test('review.md 使用 JSON 审计并规定抽样率', () => {
  const review = read('references/review.md');
  assert.match(review, /audit-report\.json/);
  assert.match(review, /critical/);
  assert.match(review, /non_critical/);
  assert.match(review, /Tier 2.*50%/);
  assert.match(review, /Tier 3.*100%/);
  assert.match(review, /都为空时.*passed.*true/);
  assert.doesNotMatch(review, /```yaml/);
});

test('scout 和 tool guide 的职责不重叠', () => {
  const scout = read('references/scout.md');
  const tool = read('references/tool-guide.md');
  assert.match(scout, /不开浏览器/);
  assert.match(tool, /pushstate/);
  assert.match(tool, /network requests/);
  assert.match(tool, /截图默认存到/);
  assert.match(tool, /不要用.*--file/);
});

test('references 不反向引用 SKILL.md', () => {
  for (const file of ['search.md', 'boundary.md', 'review.md', 'scout.md', 'tool-guide.md']) {
    assert.doesNotMatch(read(`references/${file}`), /SKILL\.md/, file);
  }
});

test('README、AGENTS 和 CLAUDE 引用的核心文件都存在', () => {
  for (const doc of ['README.md', 'AGENTS.md', 'CLAUDE.md']) {
    const text = read(doc);
    for (const match of text.matchAll(/`((?:scripts|references)\/[A-Za-z0-9_./-]+\.(?:mjs|md))`/g)) {
      assert.ok(existsSync(path.join(ROOT, match[1])), `${doc} 引用了不存在的 ${match[1]}`);
    }
  }
});
