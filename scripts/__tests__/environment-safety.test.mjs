/** 环境模式、Chrome 启动安全和本地 URL 参数测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNodeRuntime } from '../lib/check-deps-core.mjs';

const CHECK = fileURLToPath(new URL('../check-deps.mjs', import.meta.url));
const LAUNCH = fileURLToPath(new URL('../launch-chrome.mjs', import.meta.url));
const FIX_PERMISSION = fileURLToPath(new URL('../fix-chrome-debug-permission.mjs', import.meta.url));
const FIND = fileURLToPath(new URL('../find-url.mjs', import.meta.url));
const CHECK_CORE_URL = new URL('../lib/check-deps-core.mjs', import.meta.url).href;

test('浏览器兜底明确要求 Node.js 24，轻量模式仍可使用 Node.js 18', () => {
  assert.deepEqual(checkNodeRuntime('18.20.0'), {
    version: 'v18.20.0',
    major: 18,
    browserSupported: false,
    browserMinimum: 'v24.0.0',
  });
  assert.equal(checkNodeRuntime('24.0.0').browserSupported, true);
});

test('Node.js 18 的 full 执行模式不会尝试安装不兼容 CLI', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-old-node-'));
  const bin = path.join(root, 'bin');
  const marker = path.join(root, 'npm-ran');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'npm'), `#!/bin/sh
/usr/bin/touch "$FAKE_NPM_MARKER"
`, 'utf8');
  chmodSync(path.join(bin, 'npm'), 0o755);
  const source = `import { main } from ${JSON.stringify(CHECK_CORE_URL)};
await main({ mode: 'full', checkOnly: false, json: true, nodeVersion: '18.20.0' });`;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    env: { ...process.env, HOME: root, PATH: bin, FAKE_NPM_MARKER: marker },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.nodeRuntime.browserSupported, false);
  assert.equal(data.cliProvisioning.status, 'blocked-unsupported-node');
  assert.equal(data.nextActions[0].action, 'upgrade_node_runtime');
  assert.equal(existsSync(marker), false);
});

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
  const data = JSON.parse(result.stdout);
  assert.equal(data.ready, false);
  assert.equal(data.connectionTarget, 'existing-user-chrome');
  assert.deepEqual(data.nextActions.map((item) => item.action), [
    'install_agent_browser_cli',
    'enable_existing_chrome_control',
    'rerun_check',
  ]);
  assert.equal(data.nextActions[0].command, 'npm i -g agent-browser@latest');
});

test('full 模式按顺序引导安装 CLI 并开启现有登录态 Chrome', () => {
  const result = spawnSync(process.execPath, [CHECK, '--mode', 'full', '--check-only'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 1);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /安装 agent-browser CLI：npm i -g agent-browser@latest/);
  assert.match(output, /平时使用、已经登录的 Chrome/);
  assert.match(output, /chrome:\/\/inspect\/#remote-debugging/);
  assert.match(output, /不会另开、重启或下载新的浏览器/);
});

test('full 执行模式缺少 CLI 时自动安装，而不是跳过浏览器兜底', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-auto-cli-'));
  const bin = path.join(root, 'bin');
  const npmPath = path.join(bin, 'npm');
  const agentBrowserPath = path.join(bin, 'agent-browser');
  const npmArgsPath = path.join(root, 'npm-args');
  mkdirSync(bin, { recursive: true });
  writeFileSync(npmPath, `#!/bin/sh
printf '%s\n' "$@" > "$FAKE_NPM_ARGS_PATH"
printf '%s\n' '#!/bin/sh' 'echo "agent-browser 0.33.2"' > "$FAKE_AGENT_BROWSER_PATH"
/bin/chmod +x "$FAKE_AGENT_BROWSER_PATH"
`, 'utf8');
  chmodSync(npmPath, 0o755);

  const result = spawnSync(process.execPath, [
    CHECK, '--mode', 'full', '--json', '--task-name', 'auto-cli-test',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      PATH: bin,
      FAKE_AGENT_BROWSER_PATH: agentBrowserPath,
      FAKE_NPM_ARGS_PATH: npmArgsPath,
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(data.agentBrowser.status, 'ok');
  assert.equal(data.agentBrowser.version, 'v0.33.2');
  assert.deepEqual(data.cliProvisioning, {
    attempted: true,
    status: 'installed',
    command: 'npm i -g agent-browser@latest',
  });
  assert.equal(data.nextActions.some((item) => item.action === 'install_agent_browser_cli'), false);
  assert.equal(existsSync(agentBrowserPath), true);
  assert.deepEqual(readFileSync(npmArgsPath, 'utf8').trim().split('\n'), [
    'i', '-g', 'agent-browser@latest',
  ]);
});

test('full 执行模式遇到过旧 CLI 时自动升级并重新验版本', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-upgrade-cli-'));
  const bin = path.join(root, 'bin');
  const npmPath = path.join(bin, 'npm');
  const agentBrowserPath = path.join(bin, 'agent-browser');
  mkdirSync(bin, { recursive: true });
  writeFileSync(agentBrowserPath, '#!/bin/sh\necho "agent-browser 0.27.1"\n', 'utf8');
  writeFileSync(npmPath, `#!/bin/sh
printf '%s\n' '#!/bin/sh' 'echo "agent-browser 0.33.2"' > "$FAKE_AGENT_BROWSER_PATH"
/bin/chmod +x "$FAKE_AGENT_BROWSER_PATH"
`, 'utf8');
  chmodSync(agentBrowserPath, 0o755);
  chmodSync(npmPath, 0o755);

  const result = spawnSync(process.execPath, [
    CHECK, '--mode', 'full', '--json', '--task-name', 'upgrade-cli-test',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      PATH: bin,
      FAKE_AGENT_BROWSER_PATH: agentBrowserPath,
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(data.agentBrowser.status, 'ok');
  assert.equal(data.agentBrowser.version, 'v0.33.2');
  assert.equal(data.cliProvisioning.status, 'upgraded');
  assert.equal(data.nextActions.some((item) => item.action === 'upgrade_agent_browser_cli'), false);
});

test('check-only 缺少 CLI 时只报告，不执行自动安装', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-check-only-cli-'));
  const bin = path.join(root, 'bin');
  const marker = path.join(root, 'npm-ran');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'npm'), `#!/bin/sh
touch "$FAKE_NPM_MARKER"
`, 'utf8');
  chmodSync(path.join(bin, 'npm'), 0o755);

  const result = spawnSync(process.execPath, [
    CHECK, '--mode', 'full', '--check-only', '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: root, PATH: bin, FAKE_NPM_MARKER: marker },
  });

  assert.equal(result.status, 1);
  assert.equal(existsSync(marker), false);
});

test('自动安装命令失败时保持未就绪并给出可重试动作', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-cli-fail-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "registry unavailable" >&2\nexit 23\n', 'utf8');
  chmodSync(path.join(bin, 'npm'), 0o755);

  const result = spawnSync(process.execPath, [CHECK, '--mode', 'full', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: root, PATH: bin },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.ready, false);
  assert.equal(data.agentBrowser.status, 'not-found');
  assert.equal(data.cliProvisioning.status, 'failed');
  assert.match(data.cliProvisioning.error, /registry unavailable/);
  assert.equal(data.nextActions[0].action, 'install_agent_browser_cli');
});

test('安装命令成功但版本复验仍失败时不能伪装成已安装', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sleuth-cli-unverified-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(path.join(bin, 'npm'), 0o755);

  const result = spawnSync(process.execPath, [CHECK, '--mode', 'full', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: root, PATH: bin },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.ready, false);
  assert.equal(data.agentBrowser.status, 'not-found');
  assert.equal(data.cliProvisioning.status, 'failed');
  assert.match(data.cliProvisioning.error, /仍不可用/);
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

test('调试许可脚本不再承诺永久免授权确认', () => {
  const help = spawnSync(process.execPath, [FIX_PERMISSION, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /仍可能要求确认一次/);
  assert.doesNotMatch(help.stdout, /压住.*弹窗|不再弹/);
});

test('find-url 的参数错误和 help 路径可执行', () => {
  assert.equal(spawnSync(process.execPath, [FIND, '--only', 'wrong']).status, 1);
  assert.equal(spawnSync(process.execPath, [FIND, '--help']).status, 0);
});
