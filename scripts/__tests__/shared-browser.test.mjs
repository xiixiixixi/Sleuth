/** shared-browser.mjs 的动作级短锁与页面边界集成测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../shared-browser.mjs', import.meta.url));
const CDP_ENV = {
  SLEUTH_CDP_PORT: '9222',
  SLEUTH_CDP_WS: 'ws://127.0.0.1:9222/devtools/browser/test-browser',
};

function makeHarness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-shared-browser-'));
  const bin = path.join(root, 'bin');
  const testHome = path.join(root, 'home');
  const control = path.join(testHome, '.sleuth', 'shared-browser-control');
  const state = path.join(root, 'state');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });

  const fake = path.join(bin, 'agent-browser');
  writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const state = process.env.FAKE_AGENT_BROWSER_STATE;
const events = path.join(state, 'events.jsonl');
const labels = path.join(state, 'labels');
const current = path.join(state, 'current-tab');
fs.mkdirSync(labels, { recursive: true });
const log = (row) => fs.appendFileSync(events, JSON.stringify({ ...row, at: Date.now(), pid: process.pid }) + '\\n');

let cursor = 0;
while (cursor < args.length && args[cursor].startsWith('--')) {
  if (['--cdp', '--idle-timeout', '--config'].includes(args[cursor])) cursor += 2;
  else cursor += 1;
}
const command = args.slice(cursor);
log({
  event: 'invocation',
  args,
  inheritedEnv: {
    session: process.env.AGENT_BROWSER_SESSION ?? null,
    namespace: process.env.AGENT_BROWSER_NAMESPACE ?? null,
    profile: process.env.AGENT_BROWSER_PROFILE ?? null,
    cdp: process.env.AGENT_BROWSER_CDP ?? null,
    config: process.env.AGENT_BROWSER_CONFIG ?? null,
    idle: process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS ?? null,
  },
});

if (command[0] === 'tab' && command[1] === '--json') {
  const tabs = fs.readdirSync(labels).map((label, index) => ({ label, tabId: 't' + (index + 1) }));
  const duplicate = process.env.FAKE_DUPLICATE_LABEL;
  if (duplicate && tabs.some((tab) => tab.label === duplicate)) {
    tabs.push({ label: duplicate, tabId: 't-duplicate' });
  }
  process.stdout.write(JSON.stringify({ success: true, data: { tabs } }));
  process.exit(0);
}

if (command[0] === 'tab' && command[1] === 'new') {
  const labelIndex = command.indexOf('--label');
  const label = command[labelIndex + 1];
  fs.writeFileSync(path.join(labels, label), 'created');
  fs.writeFileSync(current, label);
  log({ event: 'tab-created', label });
  process.stdout.write(JSON.stringify({ created: label }));
  process.exit(0);
}

if (command[0] === 'tab' && command[1] !== 'close') {
  const label = command[1];
  if (!fs.existsSync(path.join(labels, label))) process.exit(4);
  if (process.env.FAKE_TAB_SELECT_ERROR_FOR === label) {
    process.stderr.write('transient tab selection failure');
    process.exit(7);
  }
  fs.writeFileSync(current, label);
  process.stdout.write(JSON.stringify({ selected: label }));
  process.exit(0);
}

if (command[0] !== 'batch') process.exit(8);

const batch = JSON.parse(fs.readFileSync(0, 'utf8'));
const expectedLabel = batch[0][1];
if (!fs.existsSync(path.join(labels, expectedLabel))) process.exit(5);
fs.writeFileSync(current, expectedLabel);
log({ event: 'batch-start', expectedLabel, batch });
await sleep(Number(process.env.FAKE_AGENT_BROWSER_DELAY_MS || 120));
const actualLabel = fs.readFileSync(current, 'utf8');
const browserCommand = batch[1];
log({ event: 'action', expectedLabel, actualLabel, browserCommand, batch });

if (browserCommand[0] === 'fail') {
  log({ event: 'batch-end', expectedLabel, failed: true });
  process.stderr.write('intentional browser failure');
  process.exit(9);
}

if (browserCommand[0] === 'tab' && browserCommand[1] === 'close') {
  fs.rmSync(path.join(labels, expectedLabel), { force: true });
  log({ event: 'batch-end', expectedLabel, closed: true });
  process.stdout.write(JSON.stringify([{ closed: expectedLabel }]));
  process.exit(0);
}

const pagePath = path.join(state, 'page-' + actualLabel + '.json');
if (browserCommand[0] === 'open') {
  fs.writeFileSync(pagePath, JSON.stringify({ url: browserCommand[1], title: 'title-' + actualLabel }));
}
if (browserCommand.includes('--new-tab')) fs.writeFileSync(current, 'foreign-new-tab');
if (batch[2]?.[0] === 'tab') fs.writeFileSync(current, batch[2][1]);
const verificationLabel = fs.readFileSync(current, 'utf8');
const verificationPagePath = path.join(state, 'page-' + verificationLabel + '.json');
const page = fs.existsSync(verificationPagePath)
  ? JSON.parse(fs.readFileSync(verificationPagePath, 'utf8'))
  : { url: 'about:blank', title: 'blank-' + verificationLabel };
log({ event: 'batch-end', expectedLabel, actualLabel, verificationLabel, page });
process.stdout.write(JSON.stringify([
  { selected: expectedLabel },
  { command: browserCommand },
  { value: page.url },
  { value: page.title }
]));
`, 'utf8');
  chmodSync(fake, 0o755);

  return {
    root,
    control,
    state,
    events: path.join(state, 'events.jsonl'),
    env: {
      ...process.env,
      ...CDP_ENV,
      HOME: testHome,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_AGENT_BROWSER_STATE: state,
      FAKE_AGENT_BROWSER_DELAY_MS: '120',
      SLEUTH_SHARED_BROWSER_WAIT_MS: '3000',
      AGENT_BROWSER_SESSION: 'rogue-session',
      AGENT_BROWSER_NAMESPACE: 'rogue-namespace',
      AGENT_BROWSER_PROFILE: 'rogue-profile',
      AGENT_BROWSER_CDP: '9333',
      AGENT_BROWSER_CONFIG: '/tmp/rogue-agent-browser.json',
      AGENT_BROWSER_IDLE_TIMEOUT_MS: '1',
    },
  };
}

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
}

function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function readEvents(file) {
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('两个并发调用只短暂串行浏览器批次，并始终在各自标签执行', async () => {
  const harness = makeHarness();
  const [alpha, beta] = await Promise.all([
    runAsync(['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'open', 'https://alpha.example/'], harness.env),
    runAsync(['exec', '--owner', 'beta', '--tab', 'beta', '--', 'open', 'https://beta.example/'], harness.env),
  ]);

  assert.equal(alpha.status, 0, alpha.stderr);
  assert.equal(beta.status, 0, beta.stderr);
  assert.match(alpha.stdout, /https:\/\/alpha\.example\//);
  assert.match(beta.stdout, /https:\/\/beta\.example\//);

  const events = readEvents(harness.events);
  const starts = events.filter((row) => row.event === 'batch-start');
  const ends = events.filter((row) => row.event === 'batch-end');
  const actions = events.filter((row) => row.event === 'action');
  assert.equal(starts.length, 2);
  assert.equal(ends.length, 2);
  assert.equal(actions.length, 2);
  assert.ok(ends[0].at <= starts[1].at, '第二条浏览器批次在第一条结束前进入，发生抢页');
  for (const action of actions) {
    assert.equal(action.actualLabel, action.expectedLabel, JSON.stringify(action));
    assert.equal(action.browserCommand[1], `https://${action.expectedLabel}.example/`);
    assert.deepEqual(action.batch[2], ['tab', action.expectedLabel], '核验前没有重新选择 owner 标签');
  }

  const invocations = events.filter((row) => row.event === 'invocation');
  assert.ok(invocations.length >= 4);
  for (const invocation of invocations) {
    assert.deepEqual(invocation.args.slice(0, 4), [
      '--cdp', CDP_ENV.SLEUTH_CDP_WS, '--idle-timeout', '0',
    ]);
    assert.equal(invocation.args.includes('--session'), false);
    assert.equal(invocation.args.includes('--namespace'), false);
    const configIndex = invocation.args.indexOf('--config');
    assert.ok(configIndex > -1, '底层 CLI 没有固定到协调器自己的空配置');
    assert.equal(invocation.args[configIndex + 1], path.join(harness.control, 'agent-browser.json'));
    assert.deepEqual(invocation.inheritedEnv, {
      session: null,
      namespace: null,
      profile: null,
      cdp: null,
      config: null,
      idle: null,
    });
  }
});

test('异常退出留下的锁不会被自动强拆', () => {
  const harness = makeHarness();
  const lockDir = path.join(harness.control, 'lock');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
    owner: 'killed-owner',
    tab: 'killed-owner',
    pid: 99999999,
    token: 'dead-token',
    started_at: new Date().toISOString(),
  }));

  const blocked = run(
    ['exec', '--owner', 'beta', '--tab', 'beta', '--', 'open', 'https://beta.example/'],
    { ...harness.env, SLEUTH_SHARED_BROWSER_WAIT_MS: '160' },
  );
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /BROWSER_BUSY.*异常退出.*禁止自动强拆/);
  const status = run(['status', '--json'], harness.env);
  assert.equal(JSON.parse(status.stdout).stale, true);
  const plainStatus = run(['status'], harness.env);
  assert.match(plainStatus.stdout, /残留保护锁.*人工核查/);
});

test('标签选择异常或标签重名时不会误建或继续执行', () => {
  const harness = makeHarness();
  const opened = run(['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'open', 'https://alpha.example/'], harness.env);
  assert.equal(opened.status, 0, opened.stderr);

  const before = readEvents(harness.events).filter((row) => row.event === 'tab-created').length;
  const selectFailed = run(
    ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'get', 'url'],
    { ...harness.env, FAKE_TAB_SELECT_ERROR_FOR: 'alpha' },
  );
  assert.notEqual(selectFailed.status, 0);
  assert.match(selectFailed.stderr, /BROWSER_CONTROL_REQUIRED.*选择任务标签失败/);
  const after = readEvents(harness.events).filter((row) => row.event === 'tab-created').length;
  assert.equal(after, before, '选择失败被误判为标签不存在，重复创建了标签');

  const duplicated = run(
    ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'get', 'url'],
    { ...harness.env, FAKE_DUPLICATE_LABEL: 'alpha' },
  );
  assert.notEqual(duplicated.status, 0);
  assert.match(duplicated.stderr, /任务标签.*不唯一/);
});

test('命令失败后自动释放短锁，下一位无需手动 release', () => {
  const harness = makeHarness();
  const failed = run(['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'fail'], harness.env);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /浏览器命令失败/);

  const afterFailure = run(['status', '--json'], harness.env);
  assert.equal(afterFailure.status, 0, afterFailure.stderr);
  assert.deepEqual(
    { locked: JSON.parse(afterFailure.stdout).locked, stale: JSON.parse(afterFailure.stdout).stale },
    { locked: false, stale: false },
    '失败命令退出时没有立即清理自己创建的短锁',
  );

  const next = run(['exec', '--owner', 'beta', '--tab', 'beta', '--', 'open', 'https://beta.example/'], harness.env);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /https:\/\/beta\.example\//);

  const status = run(['status', '--json'], harness.env);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).locked, false);
});

test('只允许单一 exec 入口并拒绝会绕过页面边界的参数', () => {
  const harness = makeHarness();
  const invalidCalls = [
    { args: ['acquire', '--owner', 'alpha'], message: /只支持 exec 或 status/ },
    { args: ['release', '--owner', 'alpha'], message: /只支持 exec 或 status/ },
    { args: ['exec', '--tab', 'alpha', '--', 'get', 'url'], message: /--owner/ },
    { args: ['exec', '--owner', 'alpha', '--', 'get', 'url'], message: /--tab/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'click', '@e1'], message: /@eN/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--session', 'other', 'get', 'url'], message: /--session/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--session=other', 'get', 'url'], message: /--session/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--namespace', 'other', 'get', 'url'], message: /--namespace/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--profile', 'Default', 'get', 'url'], message: /--profile/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--cdp=9333', 'get', 'url'], message: /--cdp/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--idle-timeout=1h', 'get', 'url'], message: /--idle-timeout/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--config=/tmp/other.json', 'get', 'url'], message: /--config/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', '--session-name=other', 'get', 'url'], message: /--session-name/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'click', 'a.docs', '--new-tab'], message: /--new-tab/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'eval', 'window.open("https://other.example")'], message: /window\.open/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'batch', 'get url'], message: /batch/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'close'], message: /close/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'tab', 'beta'], message: /tab/ },
    { args: ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'tab', 'close', 'beta'], message: /只能关闭自己的标签/ },
  ];

  for (const item of invalidCalls) {
    const result = run(item.args, harness.env);
    assert.notEqual(result.status, 0, item.args.join(' '));
    assert.match(result.stderr, item.message, item.args.join(' '));
  }
});

test('只接受同次核验的完整本机浏览器地址', () => {
  const harness = makeHarness();
  const invalidEnvs = [
    { SLEUTH_CDP_PORT: '', SLEUTH_CDP_WS: '' },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: '' },
    { SLEUTH_CDP_PORT: '', SLEUTH_CDP_WS: CDP_ENV.SLEUTH_CDP_WS },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: 'ws://127.0.0.1:9333/devtools/browser/test' },
    { SLEUTH_CDP_PORT: '9222', SLEUTH_CDP_WS: 'wss://remote.example/devtools/browser/test' },
  ];

  for (const invalid of invalidEnvs) {
    const result = run(
      ['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'get', 'url'],
      { ...harness.env, ...invalid },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BROWSER_CONTROL_REQUIRED/);
  }
});

test('允许通过相同 exec 入口关闭自己的任务标签', () => {
  const harness = makeHarness();
  const opened = run(['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'open', 'https://alpha.example/'], harness.env);
  assert.equal(opened.status, 0, opened.stderr);

  const closed = run(['exec', '--owner', 'alpha', '--tab', 'alpha', '--', 'tab', 'close', 'alpha'], harness.env);
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(closed.stdout, /closed.*alpha/);
});
