/** 7 种任务类型的初判测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../classify-task.mjs', import.meta.url));
const cases = {
  comparison: '对比 Intercom 和 Zendesk 哪家更好',
  deep_dive: '深入研究 OpenAI 定价的底层机制',
  timeline: '梳理 Anthropic 融资历程和时间线',
  causal: '为什么 vLLM 比 llama.cpp 快',
  problem_solving: '如何解决本地 LLM 部署失败',
  enumeration: '列出所有支持 MCP 的工具',
  debate: 'Scala 现在还值得吗，给出正反观点',
  general: '介绍一下 MCP',
};

for (const [expected, goal] of Object.entries(cases)) {
  test(`classify ${expected}`, () => {
    const result = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--goal', goal], { encoding: 'utf8' }));
    assert.equal(result.task_type, expected);
  });
}

test('缺 goal 返回参数错误', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT]).status, 2);
});

test('明确深度调研不会被子问题里的“区别”误判成 comparison', () => {
  const goal = '深度调研什么叫神逻辑，并说明它与严密逻辑的区别';
  const result = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--goal', goal], { encoding: 'utf8' }));
  assert.equal(result.task_type, 'deep_dive');
  assert.equal(result.matched_signal, '深度调研');
});
