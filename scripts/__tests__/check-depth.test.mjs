/**
 * check-depth.mjs 测试。
 *
 * Integration 风格：构造 raw/ 文件，跑脚本，验证 exit code + stderr。
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const SCRIPT = fileURLToPath(new URL('../check-depth.mjs', import.meta.url));

/** 创建临时 task-dir + raw/ 文件 */
function setupTaskDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-depth-'));
  const rawDir = path.join(dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(rawDir, name), content, 'utf8');
  }
  return dir;
}

function runCheckDepth(taskDir) {
  return execFileSync('node', [SCRIPT, taskDir], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runCheckDepthExpectFail(taskDir) {
  try {
    const out = execFileSync('node', [SCRIPT, taskDir], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// 生成一条深度 finding（≥200 字符）的辅助函数
function deepFinding(claim, url = 'https://example.com/page') {
  return JSON.stringify({
    type: 'finding',
    claim,
    url,
    confidence: '已验证事实',
    tier: 'T1',
  });
}

// 标准深度 claim（约 480 字符，确保 6 条 ≥ 2880 > 2000 总字符阈值）
const DEEP_CLAIM = 'Claude API 输入定价 $3/M tokens、输出 $15/M tokens（2026 年 7 月调价后，prompt caching 命中再降 90%）。对比 GPT-4o 的 $5/$15，Claude 输入侧便宜 40% 但输出侧持平。对高吞吐场景（如客服机器人，输入远多于输出），Claude 成本优势明显；对长生成场景（如代码生成），成本与 GPT-4o 接近。100K context window 加价 +100%，200K 加价 +200%，长上下文场景成本翻倍。批量 API 再打 5 折但响应延迟约 12 小时，适合离线批处理而非实时对话。';

// 生成一条浅断言（<200 字符）
function shallowFinding(claim = 'Intercom 支持 AI。', url = 'https://example.com') {
  return JSON.stringify({ type: 'finding', claim, url, confidence: '已验证事实', tier: 'T1' });
}

// ===== 深度足够 → exit 0 =====

test('check-depth: deep findings pass (chars >= 2000, urls >= 5, short <= 30%)', () => {
  const lines = [];
  // 8 条深度 finding，每条 6 个独立 URL 之一
  const urls = [
    'https://docs.example.com/api',
    'https://docs.example.com/pricing',
    'https://docs.example.com/limits',
    'https://blog.example.com/updates',
    'https://status.example.com',
    'https://github.com/example/repo',
  ];
  for (let i = 0; i < 8; i++) {
    lines.push(deepFinding(DEEP_CLAIM, urls[i % urls.length]));
  }
  lines.push(JSON.stringify({ type: 'agent_done', agent: 'test', lines_written: 8, ts: '2026-07-13T00:00:00Z' }));

  const dir = setupTaskDir({ 'search-test.jsonl': lines.join('\n') + '\n' });

  const out = runCheckDepth(dir);
  assert.match(out, /深度门通过/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 深度不足：字符太少 → exit 1 =====

test('check-depth: too few chars → exit 1', () => {
  const lines = [];
  // 5 条浅断言，总字符远不够 2000
  for (let i = 0; i < 5; i++) {
    lines.push(shallowFinding(`产品 ${i} 支持 AI 功能。`, `https://example.com/page${i}`));
  }
  lines.push(JSON.stringify({ type: 'agent_done', agent: 'test', lines_written: 5, ts: '2026-07-13T00:00:00Z' }));

  const dir = setupTaskDir({ 'search-test.jsonl': lines.join('\n') + '\n' });

  const result = runCheckDepthExpectFail(dir);
  assert.equal(result.exitCode, 1, 'should exit 1 when depth insufficient');
  assert.match(result.stderr, /深度不足/);
  assert.match(result.stderr, /字符/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 深度不足：URL 太少 → exit 1 =====

test('check-depth: too few unique URLs → exit 1', () => {
  const deepClaim = '这是一条足够长的 finding 用于测试 URL 多样性检查。'.repeat(8);
  const lines = [];
  // 字符够了，但 URL 只重复一个
  for (let i = 0; i < 8; i++) {
    lines.push(deepFinding(deepClaim, 'https://example.com/same-url'));
  }
  lines.push(JSON.stringify({ type: 'agent_done', agent: 'test', lines_written: 8, ts: '2026-07-13T00:00:00Z' }));

  const dir = setupTaskDir({ 'search-test.jsonl': lines.join('\n') + '\n' });

  const result = runCheckDepthExpectFail(dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /URL/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 深度不足：短断言占比太高 → exit 1 =====

test('check-depth: high short-finding ratio → exit 1', () => {
  const deepClaim = '这是一条足够长的 finding，用于拉高总字符数并通过字符检查。'.repeat(8);
  const lines = [];
  // 2 条深度（够字符），8 条浅断言 → 短占比 80%
  lines.push(deepFinding(deepClaim, 'https://example.com/p1'));
  lines.push(deepFinding(deepClaim, 'https://example.com/p2'));
  for (let i = 0; i < 8; i++) {
    lines.push(shallowFinding(`浅 ${i}`, `https://example.com/s${i}`));
  }
  lines.push(JSON.stringify({ type: 'agent_done', agent: 'test', lines_written: 10, ts: '2026-07-13T00:00:00Z' }));

  const dir = setupTaskDir({ 'search-test.jsonl': lines.join('\n') + '\n' });

  const result = runCheckDepthExpectFail(dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /短断言/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 零产出 → exit 1 =====

test('check-depth: zero findings → exit 1', () => {
  const lines = [
    JSON.stringify({ type: 'agent_done', agent: 'test', lines_written: 0, ts: '2026-07-13T00:00:00Z' }),
  ];
  const dir = setupTaskDir({ 'search-test.jsonl': lines.join('\n') + '\n' });

  const result = runCheckDepthExpectFail(dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /零产出|深度不足/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== raw/ 缺失 → exit 2 =====

test('check-depth: missing raw/ dir → exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-depth-'));
  const result = runCheckDepthExpectFail(dir);
  assert.equal(result.exitCode, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 多 agent：部分深部分浅 → exit 1（只报浅的）=====

test('check-depth: mixed agents → only shallow ones flagged', () => {
  const deepUrls = ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com'];

  // agent-deep：达标（8 条深度 finding × ~285 字符 = ~2280 > 2000）
  const deepLines = [];
  for (let i = 0; i < 8; i++) {
    deepLines.push(deepFinding(DEEP_CLAIM, deepUrls[i % deepUrls.length]));
  }
  deepLines.push(JSON.stringify({ type: 'agent_done', agent: 'deep', lines_written: 8, ts: '2026-07-13T00:00:00Z' }));

  // agent-shallow：不达标
  const shallowLines = [];
  for (let i = 0; i < 3; i++) {
    shallowLines.push(shallowFinding(`浅 ${i}`, `https://x.com/${i}`));
  }
  shallowLines.push(JSON.stringify({ type: 'agent_done', agent: 'shallow', lines_written: 3, ts: '2026-07-13T00:00:00Z' }));

  const dir = setupTaskDir({
    'search-deep.jsonl': deepLines.join('\n') + '\n',
    'search-shallow.jsonl': shallowLines.join('\n') + '\n',
  });

  const result = runCheckDepthExpectFail(dir);
  assert.equal(result.exitCode, 1);
  // shallow 被点名，deep 不点名
  assert.match(result.stderr, /shallow/);
  // deep agent 应该通过——stderr 里不应出现 deep 失败
  assert.doesNotMatch(result.stderr, /deep.*字符.*< 2000|deep.*短断言/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== 参数错误 → exit 2 =====

test('check-depth: missing task-dir arg → exit 2', () => {
  assert.throws(() => execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
});
