import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../spawn-subagent.mjs', import.meta.url));

function run(args) {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

test('generates a goal-driven prompt containing mandatory clauses', () => {
  const out = run([
    '--goal', '验证产品当前公开定价',
    '--must-verify', '价格数字',
    '--must-verify', '计费单位',
    '--known-clue', '域名: example.com',
  ]);
  assert.match(out, /必须加载 sleuth skill 并遵循指引/);   // skill 加载指令
  assert.match(out, /验证产品当前公开定价/);                 // goal 注入
  assert.match(out, /价格数字/);                              // must_verify 注入
  assert.match(out, /计费单位/);
  assert.match(out, /example\.com/);                          // known_clue 注入
  assert.match(out, /findings/);                              // 返回格式要求
  assert.match(out, /gaps/);
  assert.match(out, /red_flags/);
  assert.match(out, /agent-browser close --all/);             // tab 兜底关闭
});

test('exits non-zero when --goal is missing', () => {
  assert.throws(() =>
    run(['--must-verify', 'x'])
  );
});

test('defaults must-verify and known-clue blocks when not provided', () => {
  const out = run(['--goal', '了解某产品']);
  assert.match(out, /按目标自行判断需要验证什么/);  // must_verify 默认提示
  assert.match(out, /按最保守方式解释任务范围/);    // known_clue 默认提示
});

test('does NOT contain any session/deliver/sid references', () => {
  const out = run(['--goal', 'test']);
  assert.doesNotMatch(out, /--sid|session-logger|deliver|--main-sid|--role subagent|subagent_done/);
});
