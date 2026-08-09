import { test } from 'node:test';
import assert from 'node:assert';
import {
  knownBrowsers,
  checkPort,
  classifyBrowserProcess,
  getBrowserConnection,
} from '../lib/browser-discovery.mjs';

test('knownBrowsers returns non-empty array for current platform', () => {
  const browsers = knownBrowsers();
  assert.ok(Array.isArray(browsers));
  assert.ok(browsers.length > 0);
  assert.ok('id' in browsers[0]);
  assert.ok('label' in browsers[0]);
  assert.ok('devToolsPath' in browsers[0]);
});

test('knownBrowsers includes Chrome on all platforms', () => {
  const browsers = knownBrowsers();
  const ids = browsers.map(b => b.id);
  assert.ok(ids.includes('chrome'), 'should include chrome');
});

test('checkPort returns boolean', async () => {
  const result = await checkPort(59999);
  assert.strictEqual(typeof result, 'boolean');
});

test('日常 Google Chrome 的默认用户目录可以通过身份检查', () => {
  const browser = {
    id: 'chrome',
    defaultDataDir: '/Users/example/Library/Application Support/Google/Chrome',
  };
  const result = classifyBrowserProcess(browser, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  assert.deepEqual(result, { accepted: true, reason: 'verified-user-chrome' });
});

test('Chrome for Testing、Chrome Dev 和 Chromium 不能冒充用户登录态 Chrome', () => {
  const browser = {
    id: 'chrome',
    defaultDataDir: '/Users/example/Library/Application Support/Google/Chrome',
  };
  const commands = [
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --remote-debugging-port=9222',
    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev --remote-debugging-port=9222',
    '/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9222',
  ];

  for (const command of commands) {
    assert.equal(classifyBrowserProcess(browser, {
      executablePath: command.split(' --')[0],
      command,
    }).accepted, false, command);
  }
});

test('正式 Chrome 程序使用独立自动化用户目录时也必须拒绝', () => {
  const browser = {
    id: 'chrome',
    defaultDataDir: '/Users/example/Library/Application Support/Google/Chrome',
  };
  const command = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/Users/example/.sleuth/chrome-live --restart';
  const result = classifyBrowserProcess(browser, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    command,
  });

  assert.deepEqual(result, { accepted: false, reason: 'non-default-user-data-dir' });
});

test('普通进程把 Chrome 路径塞进参数也不能伪装成用户 Chrome', () => {
  const browser = {
    id: 'chrome',
    defaultDataDir: '/Users/example/Library/Application Support/Google/Chrome',
  };
  const result = classifyBrowserProcess(browser, {
    executablePath: '/usr/local/bin/node',
    command: 'node fake-cdp.mjs --label="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
  });

  assert.deepEqual(result, { accepted: false, reason: 'not-stable-google-chrome' });
});

test('明确指向日常默认目录的稳定版 Chrome 不会被误拒绝', () => {
  const browser = {
    id: 'chrome',
    defaultDataDir: '/Users/example/Library/Application Support/Google/Chrome',
  };
  const result = classifyBrowserProcess(browser, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/example/Library/Application Support/Google/Chrome',
  });

  assert.deepEqual(result, { accepted: true, reason: 'verified-user-chrome' });
});

test('端口文件指向独立用户目录时完整连接判定必须拒绝', async () => {
  const browser = {
    id: 'chrome',
    label: 'Google Chrome',
    defaultDataDir: '/Users/example/Library/Application Support/Google/Chrome',
    devToolsPath: '/fake/DevToolsActivePort',
  };
  const result = await getBrowserConnection({
    browsers: [browser],
    readFile: () => '9222\n/devtools/browser/fake\n',
    checkPort: async () => true,
    inspectPortOwner: async () => ({
      pid: 42,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/example/.sleuth/chrome-live',
    }),
  });

  assert.equal(result.kind, 'rejected');
  assert.equal(result.rejected[0].identity, 'non-default-user-data-dir');
});
