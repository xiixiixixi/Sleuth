import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../spawn-subagent.mjs', import.meta.url));

function run(args) {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

// ===== search role =====

test('search role: has environment variables + absolute doc path + safety + task fields', () => {
  const out = run([
    '--goal', '验证产品当前公开定价',
    '--must-verify', '价格数字',
    '--must-verify', '计费单位',
    '--known-clue', '域名: example.com',
  ]);
  assert.match(out, /references\/search\.md/);
  assert.match(out, /Chrome 调试端口/);
  assert.match(out, /不提取 cookie/);
  assert.match(out, /不绕付费墙/);
  assert.match(out, /产生状态变更.*先停下问/);
  assert.match(out, /验证产品当前公开定价/);
  assert.match(out, /价格数字/);
  assert.match(out, /计费单位/);
  assert.match(out, /example\.com/);
  assert.match(out, /raw\/search-/);   // v2: 直写 raw/
  assert.match(out, /ts .* round .* agent .* claim_id 由归一化器补/);  // v2: 归一化器补，不是主 Agent
  assert.match(out, /agent-browser close --all/);
  assert.match(out, /agent_done/);  // v2: EOF sentinel
  assert.match(out, /网络失败处理/);  // v2: 网络失败重试规则
  assert.match(out, /WebFetch 单 URL 重试上限.*3 次/);  // v2: 重试上限
});

test('search role: exits non-zero when --goal is missing', () => {
  assert.throws(() => run(['--must-verify', 'x']));
});

test('search role: defaults when must-verify/known-clue/stop-criteria not provided', () => {
  const out = run(['--goal', '了解某产品']);
  assert.match(out, /按目标自行判断/);
  assert.match(out, /最保守方式解释/);
  assert.match(out, /search\.md §5 终止信号/);
});

test('search role: --deliverable injects', () => {
  const out = run(['--goal', 'x', '--deliverable', '含 3 个独立源的定价对比表']);
  assert.match(out, /含 3 个独立源的定价对比表/);
});

test('search role: --stop-criteria injects as bullet list', () => {
  const out = run(['--goal', 'x', '--stop-criteria', '至少 3 个独立源', '--stop-criteria', '每个数字有时间戳']);
  assert.match(out, /- 至少 3 个独立源/);
  assert.match(out, /- 每个数字有时间戳/);
});

test('search role: --task-dir injects simplified task context', () => {
  const out = run(['--goal', 'x', '--task-dir', '/tmp/test-task/']);
  assert.match(out, /\/tmp\/test-task\//);
  assert.match(out, /读 directions\.json 避开已试方向/);
  assert.match(out, /不要读 findings\.jsonl/);  // v2: search Agent 不读 findings
});

test('search role: --agent-name sets raw file name + sentinel agent field', () => {
  const out = run(['--goal', 'x', '--task-dir', '/tmp/test/', '--agent-name', 'intercom']);
  assert.match(out, /raw\/search-intercom\.jsonl/, 'file name must use agent-name');
  assert.match(out, /"agent":"intercom"/, 'sentinel agent field must use agent-name');
});

test('search role: --round injects loop round', () => {
  const out = run(['--goal', 'x', '--round', '2']);
  assert.match(out, /Round 2/);
});

test('search role: --role search explicit works', () => {
  const out = run(['--role', 'search', '--goal', 'x']);
  assert.match(out, /搜索执行/);
});

// ===== boundary role =====

test('boundary role: has env var + absolute doc path + safety + task context', () => {
  const out = run([
    '--role', 'boundary',
    '--goal', '评估覆盖度',
    '--task-dir', '/tmp/test/',
  ]);
  assert.match(out, /边界评估/);
  assert.match(out, /references\/boundary\.md/);
  assert.match(out, /只读已有 findings/);
  assert.match(out, /评估覆盖度/);
  assert.match(out, /\/tmp\/test\//);
  assert.match(out, /按 boundary\.md 定义的 YAML schema 返回/);
  assert.doesNotMatch(out, /来源类型多样性/);
});

test('boundary role: exits non-zero when --task-dir missing', () => {
  assert.throws(() => run(['--role', 'boundary', '--goal', 'x']));
});

test('boundary role: exits non-zero when --goal missing', () => {
  assert.throws(() => run(['--role', 'boundary', '--task-dir', '/tmp/x/']));
});

// ===== review role =====

test('review role: has env var + absolute doc path + safety + draft path', () => {
  const out = run([
    '--role', 'review',
    '--goal', '审计报告',
    '--task-dir', '/tmp/test/',
    '--draft-path', '/tmp/test/draft.md',
  ]);
  assert.match(out, /证据链审计/);
  assert.match(out, /references\/review\.md/);
  assert.match(out, /仅允许 WebFetch 验证/);
  assert.match(out, /审计报告/);
  assert.match(out, /\/tmp\/test\//);
  assert.match(out, /draft\.md/);
  assert.match(out, /按 review\.md 定义的 YAML schema 返回.*sampled_stats/);
  assert.doesNotMatch(out, /T3 来源.*100% 抽样/);
});

test('review role: exits non-zero when --task-dir missing', () => {
  assert.throws(() => run(['--role', 'review', '--goal', 'x', '--draft-path', '/tmp/d.md']));
});

test('review role: exits non-zero when --draft-path missing', () => {
  assert.throws(() => run(['--role', 'review', '--goal', 'x', '--task-dir', '/tmp/x/']));
});

// ===== synthesize role =====

test('synthesize role: generates prompt with findings + task_spec + draft output', () => {
  const out = run([
    '--role', 'synthesize',
    '--task-dir', '/tmp/test/',
  ]);
  assert.match(out, /合成子 Agent/);
  assert.match(out, /findings\.jsonl/);
  assert.match(out, /task_spec\.md/);
  assert.match(out, /draft\.md/);
  assert.match(out, /\/tmp\/test\//);
});

test('synthesize role: has synthesis rules (tiers, citation, conflict)', () => {
  const out = run(['--role', 'synthesize', '--task-dir', '/tmp/test/']);
  assert.match(out, /T1\/T2\/T3/);
  assert.match(out, /每个核心结论必须内联/);
  assert.match(out, /冲突.*明示/);
  assert.match(out, /不许读 raw/);
  assert.match(out, /不许写 draft\.md 之外/);
});

test('synthesize role: --audit-fix injects feedback', () => {
  const out = run([
    '--role', 'synthesize',
    '--task-dir', '/tmp/test/',
    '--audit-fix', '第5章URL失效',
  ]);
  assert.match(out, /审计反馈/);
  assert.match(out, /第5章URL失效/);
});

test('synthesize role: exits non-zero when --task-dir missing', () => {
  assert.throws(() => run(['--role', 'synthesize']));
});

test('synthesize role: does NOT contain session/deliver/sid references', () => {
  const out = run(['--role', 'synthesize', '--task-dir', '/tmp/x/']);
  assert.doesNotMatch(out, /--sid|session-logger|deliver|--main-sid|--role subagent|subagent_done/);
});

// ===== invalid role =====

test('invalid --role exits non-zero', () => {
  assert.throws(() => run(['--role', 'invalid', '--goal', 'x']));
});

// ===== regression =====

test('does NOT contain session/deliver/sid references in any role', () => {
  const searchOut = run(['--goal', 'test']);
  assert.doesNotMatch(searchOut, /--sid|session-logger|deliver|--main-sid|--role subagent|subagent_done/);

  const boundaryOut = run(['--role', 'boundary', '--goal', 'test', '--task-dir', '/tmp/x/']);
  assert.doesNotMatch(boundaryOut, /--sid|session-logger|deliver|--main-sid|--role subagent|subagent_done/);

  const reviewOut = run(['--role', 'review', '--goal', 'test', '--task-dir', '/tmp/x/', '--draft-path', '/tmp/d.md']);
  assert.doesNotMatch(reviewOut, /--sid|session-logger|deliver|--main-sid|--role subagent|subagent_done/);
});

// ===== Scout role tests =====

test('scout role: generates prompt with landscape.json format', () => {
  const out = run(['--role', 'scout', '--goal', 'test landscape']);
  assert.match(out, /Scout/);
  assert.match(out, /landscape\.json/);
  assert.match(out, /entities/);
  assert.match(out, /perspectives/);
  assert.match(out, /source_hints/);
});

test('scout role: points to scout.md for strategy (no hardcoded types)', () => {
  const out = run(['--role', 'scout', '--goal', 'test']);
  assert.match(out, /scout\.md.*广度扫描策略/);
  assert.doesNotMatch(out, /实体发现.*结构对比.*技术维度/);
});

test('scout role: exits non-zero when --goal missing', () => {
  assert.throws(() => run(['--role', 'scout']), /scout role requires --goal/);
});
test('scout role: has no tool-call hardcap', () => {
  const out = run(['--role', 'scout', '--goal', 'test']);
  assert.doesNotMatch(out, /硬上限.*tool call/);
});

test('scout role: does NOT contain session/deliver/sid references', () => {
  const out = run(['--role', 'scout', '--goal', 'test']);
  assert.doesNotMatch(out, /--sid|session-logger|deliver|--main-sid|--role subagent|subagent_done/);
});
