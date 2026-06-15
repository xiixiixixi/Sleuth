import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGGER = fileURLToPath(new URL('../session-logger.mjs', import.meta.url));
const SESSIONS_DIR = join(homedir(), '.sleuth', 'sessions');
const SID = 'test-finish-gate-0001';
const FILE = join(SESSIONS_DIR, SID + '.json');

function seed(ops) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(
    FILE,
    JSON.stringify(
      {
        session_id: SID,
        query: 't',
        query_type: '其他',
        started: new Date().toISOString(),
        finished: null,
        outcome: null,
        operations: ops,
      },
      null,
      2
    )
  );
}

function finish(outcome, extra = []) {
  return execFileSync(
    'node',
    [LOGGER, '--action', 'finish', '--sid', SID, '--outcome', outcome, ...extra],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

afterEach(() => {
  try { rmSync(FILE); } catch {}
});

const LOW = { type: 'subagent_done', name: 'kling', searches: 22, fetches: 0, browser: 0, low_verification: true };
const OK = { type: 'subagent_done', name: 'runway', searches: 18, fetches: 8, browser: 6 };
const OK2 = { type: 'subagent_done', name: 'pika', searches: 10, fetches: 5, browser: 3 };
const REVIEW = { type: 'review_done', is_enough: true };
const DELIVER = { type: 'deliver', content_type: 'doc', file: '/tmp/report.md' };
const VISIT = { type: 'visit', url: 'https://example.com/pricing', domain: 'example.com' };
const REVIEW_FAIL = { type: 'review_done', is_enough: false };
const DELIVER_SHOT = { type: 'deliver', content_type: 'screenshot', file: '/tmp/shot.png' };

test('blocks success when an unverified (low_verification) subagent exists', () => {
  seed([LOW]);
  let threw = false;
  try { finish('success'); } catch (e) { threw = true; assert.match(String(e.stderr), /low_verification/); }
  assert.ok(threw, 'finish success should exit non-zero when blocked');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null, 'outcome must NOT be stamped success');
});

test('--force does NOT bypass the hard gate (no override allowed)', () => {
  seed([LOW]);
  let threw = false;
  try { finish('success', ['--force']); } catch (e) { threw = true; }
  assert.ok(threw, '--force must not let success through');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null, '--force must not stamp success over unverified work');
});

test('allows partial as the honest fallback when unverified', () => {
  seed([LOW]);
  finish('partial');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'partial');
});

test('allows success normally when no subagent is low_verification', () => {
  seed([OK]);
  finish('success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'success');
});

test('deep research (>=2 subagents) blocks success without a review_done', () => {
  seed([OK, OK2]);
  let threw = false;
  try { finish('success'); } catch (e) { threw = true; assert.match(String(e.stderr), /审查/); }
  assert.ok(threw, 'deep research success should require a review pass');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null);
});

test('deep research --force does NOT bypass the missing-review gate', () => {
  seed([OK, OK2]);
  let threw = false;
  try { finish('success', ['--force']); } catch (e) { threw = true; }
  assert.ok(threw, '--force must not skip required review');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null);
});

test('deep research success is allowed once a review_done is logged', () => {
  seed([OK, OK2, REVIEW]);
  finish('success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'success');
});

test('single-subagent success does not require a review', () => {
  seed([OK]);
  finish('success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'success');
});

test('floor gate: delivered report with zero verification trace blocks success', () => {
  seed([DELIVER]); // 交付了报告，但 0 visit、0 verified subagent
  let threw = false;
  try { finish('success'); } catch (e) { threw = true; assert.match(String(e.stderr), /一手核验/); }
  assert.ok(threw, 'success should be blocked when no verification was logged');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null);
});

test('floor gate: --force does NOT bypass the floor', () => {
  seed([DELIVER]);
  let threw = false;
  try { finish('success', ['--force']); } catch (e) { threw = true; }
  assert.ok(threw, '--force must not bypass the verification floor');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null);
});

test('floor gate: a single logged visit satisfies the floor', () => {
  seed([DELIVER, VISIT]);
  finish('success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'success');
});

test('floor gate: a verified subagent satisfies the floor', () => {
  seed([DELIVER, OK]); // OK 带 fetches/browser>0；单个 subagent，不触发审查门
  finish('success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'success');
});

test('floor gate: partial is always allowed even with zero trace', () => {
  seed([DELIVER]);
  finish('partial');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'partial');
});

test('review-verdict gate: a review with is_enough=false blocks success', () => {
  seed([OK, OK2, REVIEW_FAIL]); // 深度研究，审查跑了但判定不够
  let threw = false;
  try { finish('success'); } catch (e) { threw = true; assert.match(String(e.stderr), /is_enough=false/); }
  assert.ok(threw, 'a failing review must block success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null);
});

test('review-verdict gate: --force does NOT bypass is_enough=false', () => {
  seed([OK, OK2, REVIEW_FAIL]);
  let threw = false;
  try { finish('success', ['--force']); } catch (e) { threw = true; }
  assert.ok(threw, '--force must not bypass a failing review');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, null);
});

test('review-verdict gate: is_enough=false still allows partial', () => {
  seed([OK, OK2, REVIEW_FAIL]);
  finish('partial');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'partial');
});

test('review-verdict gate: a later passing re-review unblocks success', () => {
  seed([OK, OK2, REVIEW_FAIL, REVIEW]); // 先 false，补查后重审为 true → 以最新为准
  finish('success');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'success');
});

// ── deliver-time 早期预警 + partial 诚实披露闸 ──────────────────────

// 直接走 session-logger --action log 记一条 deliver，捕获 stderr。
function logOp(op) {
  return spawnSync(
    'node',
    [LOGGER, '--action', 'log', '--sid', SID, '--operation', JSON.stringify(op)],
    { encoding: 'utf8' }
  );
}

const DELIVER_WARN = /尚无任何一手核验/;

test('deliver-time gate: a doc deliver with zero verification trace warns', () => {
  seed([]);
  const r = logOp(DELIVER); // DELIVER = content_type:'doc'
  assert.match(r.stderr, DELIVER_WARN, 'delivering a doc with no verification must warn');
});

test('deliver-time gate: a prior visit suppresses the warning', () => {
  seed([VISIT]);
  const r = logOp(DELIVER);
  assert.doesNotMatch(r.stderr, DELIVER_WARN, 'a logged visit means verification exists');
});

test('deliver-time gate: a verified subagent suppresses the warning', () => {
  seed([OK]); // OK 带 fetches/browser>0
  const r = logOp(DELIVER);
  assert.doesNotMatch(r.stderr, DELIVER_WARN, 'a verified subagent means verification exists');
});

test('deliver-time gate: a non-doc deliver (screenshot) does not warn', () => {
  seed([]);
  const r = logOp(DELIVER_SHOT);
  assert.doesNotMatch(r.stderr, DELIVER_WARN, 'only doc reports trigger the snippet-only warning');
});

test('partial disclosure gate: partial + delivered report + zero verification flags unverified_delivery', () => {
  seed([DELIVER]);
  finish('partial');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'partial', 'partial stays the honest fallback');
  assert.strictEqual(s.unverified_delivery, true, 'a silent unverified partial must leave an audit flag');
});

test('partial disclosure gate: a verification trace means no unverified_delivery flag', () => {
  seed([DELIVER, VISIT]);
  finish('partial');
  const s = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.strictEqual(s.outcome, 'partial');
  assert.notStrictEqual(s.unverified_delivery, true, 'verified partial must not be flagged');
});
