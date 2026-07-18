/** 环境模式、Chrome 启动安全和本地 URL 参数测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHECK = fileURLToPath(new URL('../check-deps.mjs', import.meta.url));
const LAUNCH = fileURLToPath(new URL('../launch-chrome.mjs', import.meta.url));
const FIND = fileURLToPath(new URL('../find-url.mjs', import.meta.url));

test('light 模式在没有 agent-browser 时仍可用于基础研究', () => {
  const result = spawnSync(process.execPath, [CHECK, '--mode', 'light', '--check-only', '--json'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ready, true);
  assert.equal(data.agentBrowser.status, 'not-found');
});

test('full 模式在没有 agent-browser 时明确失败', () => {
  const result = spawnSync(process.execPath, [CHECK, '--mode', 'full', '--check-only', '--json'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ready, false);
});

test('check-deps 拒绝未知模式', () => {
  assert.equal(spawnSync(process.execPath, [CHECK, '--mode', 'wrong']).status, 2);
});

test('launch-chrome 没有用户确认时退出，不启动浏览器', () => {
  const result = spawnSync(process.execPath, [LAUNCH], {
    encoding: 'utf8',
    env: { ...process.env, SLEUTH_DEBUG_PORT: '65529', SLEUTH_CHROME_BIN: process.execPath },
  });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /--confirm-close-browser/);
});

test('launch-chrome 不再强制结束日常 Chrome', () => {
  const source = readFileSync(LAUNCH, 'utf8');
  assert.doesNotMatch(source, /pkill\s+-9.*Google Chrome/);
  const help = spawnSync(process.execPath, [LAUNCH, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /confirm-close-browser/);
});

test('find-url 的参数错误和 help 路径可执行', () => {
  assert.equal(spawnSync(process.execPath, [FIND, '--only', 'wrong']).status, 1);
  assert.equal(spawnSync(process.execPath, [FIND, '--help']).status, 0);
});
