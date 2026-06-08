import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../spawn-subagent.mjs', import.meta.url));

function run(args) {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

test('generates a contract containing every mandatory clause', () => {
  const out = run([
    '--sid', 'TESTSID',
    '--goal', '验证产品当前公开定价',
    '--enough-when', '找到官方 pricing 页能直接支持价格结论',
    '--browser-session', 'TESTSID-pricing',
    '--must-verify', '价格数字',
    '--must-verify', '计费单位',
    '--known-clue', '域名: example.com',
  ]);
  assert.match(out, /subagent-guide\.md/);          // 必读引用
  assert.match(out, /--role subagent/);             // 角色纪律
  assert.match(out, /--main-sid "TESTSID"/);        // deliver 归属
  assert.match(out, /TESTSID-pricing/);             // browser session 名
  assert.match(out, /subagent_done/);               // 完成上报
  assert.match(out, /价格数字/);                     // must_verify 注入
  assert.match(out, /计费单位/);
  assert.match(out, /example\.com/);                // known_clue 注入
  assert.match(out, /\$\{CLAUDE_SKILL_DIR\}/);      // 字面量未被本脚本展开
});

test('exits non-zero when --must-verify is missing for a research contract', () => {
  assert.throws(() =>
    run(['--sid', 'S', '--goal', 'g', '--enough-when', 'e', '--browser-session', 'b'])
  );
});

test('--review generates a review contract that logs review_done', () => {
  const out = run(['--review', '--sid', 'RID']);
  assert.match(out, /审查子 Agent/);                 // 审查角色
  assert.match(out, /review_done/);                  // 记 review_done（不是 subagent_done）
  assert.match(out, /is_enough/);                    // 必给 is_enough 判断
  assert.match(out, /--role subagent/);              // 仍受角色纪律约束
  assert.match(out, /RID/);                          // SID 注入
  assert.match(out, /\$\{CLAUDE_SKILL_DIR\}/);       // 字面量未展开
  assert.doesNotMatch(out, /"type":"subagent_done"/); // 审查不得记 subagent_done
});

test('--review requires --sid', () => {
  assert.throws(() => run(['--review']));
});
