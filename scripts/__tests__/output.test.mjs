/**
 * output.mjs 单元测试 + check-deps --task-name 集成测试。
 *
 * 覆盖：
 *   - sanitizeTaskName 合法/非法输入
 *   - resolveOutputDir 默认（按日期）/ 任务模式（按 task-name）
 *   - ensureOutputDir 创建目录
 *   - check-deps CLI --task-name flag
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOutputDir, ensureOutputDir, sanitizeTaskName } from '../lib/output.mjs';

// ===== unit: sanitizeTaskName =====

test('sanitizeTaskName accepts legal names', () => {
  assert.strictEqual(sanitizeTaskName('openai-2026'), 'openai-2026');
  assert.strictEqual(sanitizeTaskName('my_task'), 'my_task');
  assert.strictEqual(sanitizeTaskName('task.v2'), 'task.v2');
  assert.strictEqual(sanitizeTaskName('abc123'), 'abc123');
});

test('sanitizeTaskName rejects empty / null / undefined', () => {
  assert.throws(() => sanitizeTaskName(''));
  assert.throws(() => sanitizeTaskName(null));
  assert.throws(() => sanitizeTaskName(undefined));
});

test('sanitizeTaskName rejects path traversal', () => {
  assert.throws(() => sanitizeTaskName('../etc/passwd'));
  assert.throws(() => sanitizeTaskName('..'));
  assert.throws(() => sanitizeTaskName('.'));
  assert.throws(() => sanitizeTaskName('/etc/passwd'));
});

test('sanitizeTaskName rejects path separator', () => {
  assert.throws(() => sanitizeTaskName('foo/bar'));
  assert.throws(() => sanitizeTaskName('foo\\bar'));
});

test('sanitizeTaskName rejects special chars (spaces, $, ;, etc.)', () => {
  assert.throws(() => sanitizeTaskName('foo bar'));
  assert.throws(() => sanitizeTaskName('foo$bar'));
  assert.throws(() => sanitizeTaskName('foo;bar'));
  assert.throws(() => sanitizeTaskName('foo|bar'));
});

// ===== unit: resolveOutputDir =====

test('resolveOutputDir() without taskName returns date-based dir (backward compat)', () => {
  const dir = resolveOutputDir();
  // 跨平台兼容：Windows 用 \，Unix 用 /
  assert.match(dir, /[/\\]\.sleuth[/\\]output[/\\]\d{4}-\d{2}-\d{2}$/);
});

test('resolveOutputDir(taskName) returns task-name-based dir', () => {
  const dir = resolveOutputDir('openai-2026-06-19');
  assert.match(dir, /[/\\]\.sleuth[/\\]output[/\\]openai-2026-06-19$/);
});

test('resolveOutputDir(invalid taskName) throws', () => {
  assert.throws(() => resolveOutputDir('../etc'));
  assert.throws(() => resolveOutputDir('foo/bar'));
  assert.throws(() => resolveOutputDir('foo bar'));
  assert.throws(() => resolveOutputDir(''));
});

// ===== unit: ensureOutputDir =====

test('ensureOutputDir creates nested directory tree', () => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpRoot = path.join(tmpdir(), `sleuth-test-${nonce}`);
  const nested = path.join(tmpRoot, 'level1', 'level2');
  try {
    ensureOutputDir(nested);
    assert.ok(existsSync(nested), 'nested dir should exist');
    assert.ok(existsSync(path.join(nested, 'raw')), 'raw dir should exist');
    assert.ok(existsSync(path.join(nested, 'screenshots')), 'screenshots dir should exist');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ===== integration: check-deps CLI --task-name =====

const SCRIPT = fileURLToPath(new URL('../check-deps.mjs', import.meta.url));

// 检测 agent-browser 是否安装；缺失则跳过集成测试（CI 兼容）
let agentBrowserOk = true;
try {
  execSync('agent-browser --version', { stdio: 'ignore', timeout: 5000 });
} catch {
  agentBrowserOk = false;
}
const skipReason = agentBrowserOk ? false : 'agent-browser not installed';

function run(args) {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

test('check-deps --task-name <valid> --check-only resolves task-name dir', { skip: skipReason }, () => {
  const out = run(['--task-name', 'openai-test-2026', '--check-only']);
  // output-dir 不打印在 check-only 模式下，但 JSON 模式会输出
  // 这里改用 --json 验证
  const json = run(['--task-name', 'openai-test-2026', '--check-only', '--json']);
  const parsed = JSON.parse(json);
  assert.match(parsed.outputDir, /[/\\]\.sleuth[/\\]output[/\\]openai-test-2026$/);
});

test('check-deps --task-name <invalid> exits non-zero', { skip: skipReason }, () => {
  assert.throws(() => run(['--task-name', '../etc', '--check-only']));
  assert.throws(() => run(['--task-name', 'foo/bar', '--check-only']));
  assert.throws(() => run(['--task-name', 'foo bar', '--check-only']));
});

test('check-deps --task-name without value exits non-zero', { skip: skipReason }, () => {
  assert.throws(() => run(['--task-name']));
  assert.throws(() => run(['--task-name', '--check-only']));
});

test('check-deps without --task-name still works (backward compat)', { skip: skipReason }, () => {
  const out = run(['--check-only']);
  assert.match(out, /agent-browser: ok/);
});

test('check-deps --help mentions --task-name', () => {
  const out = run(['--help']);
  assert.match(out, /--task-name/);
  assert.match(out, /字母\/数字/);
});
