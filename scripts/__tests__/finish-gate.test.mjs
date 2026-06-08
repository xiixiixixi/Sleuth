import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
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
