/**
 * Phase 1 测试 — Managed Browser 基础设施
 *
 * 覆盖：
 * - findChromeBinary() 路径检测
 * - selectFreePort() 端口选择
 * - validateCDPEndpoint() 验证逻辑
 * - readState() 状态持久化读取
 * - --check-only 非破坏性检查
 * - flag 校验（互斥参数）
 * - detectManagedCDPPort() managed 端口检测
 * - launchManagedBrowser() 成功路径
 * - stopManagedBrowser() 清理状态并终止进程
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SCRIPTS_DIR = path.resolve(import.meta.dirname, '..', 'scripts');
const LIB_DIR = path.join(SCRIPTS_DIR, 'lib');

// 动态 import，避免模块副作用
let core;
before(async () => {
  core = await import(path.join(LIB_DIR, 'check-deps-core.mjs'));
});

function backupFile(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function restoreFile(filePath, backup) {
  try {
    if (backup === null) {
      fs.unlinkSync(filePath);
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, backup);
  } catch {}
}

async function waitFor(fn, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function loadIsolatedCoreForLaunch({ homeDir, spawnCalls }) {
  const sourcePath = path.join(LIB_DIR, 'check-deps-core.mjs');
  const tempModulePath = path.join(os.tmpdir(), `sleuth-check-deps-core-${Date.now()}-${Math.random()}.mjs`);
  const original = fs.readFileSync(sourcePath, 'utf-8');
  const transformed = original
    .replace(
      "import { execSync, spawn } from 'node:child_process';",
      "const { execSync, spawn } = globalThis.__sleuthPhase1ChildProcess;"
    )
    .replace(
      "import fs from 'node:fs';",
      "const fs = globalThis.__sleuthPhase1Fs;"
    )
    .replace(
      "import os from 'node:os';",
      "const os = globalThis.__sleuthPhase1Os;"
    )
    .replace(
      "import { resolveOutputDir, ensureOutputDir } from './output.mjs';",
      "const resolveOutputDir = () => '/tmp/sleuth-output'; const ensureOutputDir = () => {};"
    );

  fs.writeFileSync(tempModulePath, transformed, 'utf-8');

  const profileDir = path.join(homeDir, '.sleuth', 'cdp-profile');
  globalThis.__sleuthPhase1Os = {
    platform: () => 'linux',
    homedir: () => homeDir,
  };
  globalThis.__sleuthPhase1Fs = {
    existsSync(target) {
      if (target === '/usr/bin/google-chrome-stable') return true;
      return fs.existsSync(target);
    },
    mkdirSync: fs.mkdirSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    readdirSync: fs.readdirSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
  };
  globalThis.__sleuthPhase1ChildProcess = {
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return {
        pid: 4321,
        unref() {},
      };
    },
    execSync() {
      return `user 9876 0.0 0.0 chrome --user-data-dir=${profileDir}`;
    },
  };

  const mod = await import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`);

  return {
    mod,
    cleanup() {
      delete globalThis.__sleuthPhase1Os;
      delete globalThis.__sleuthPhase1Fs;
      delete globalThis.__sleuthPhase1ChildProcess;
      try { fs.unlinkSync(tempModulePath); } catch {}
    },
  };
}

describe('Phase 1: findChromeBinary', () => {
  it('应返回有效的 Chrome 路径', () => {
    const binary = core.findChromeBinary();
    assert.ok(binary, 'Chrome 路径不应为空');
    assert.ok(fs.existsSync(binary), `Chrome 路径不存在: ${binary}`);
  });
});

describe('Phase 1: selectFreePort', () => {
  it('应返回可用端口号', async () => {
    const port = await core.selectFreePort();
    assert.ok(typeof port === 'number', '端口应为数字');
    assert.ok(port >= 1024 && port <= 65535, `端口超出范围: ${port}`);
    assert.strictEqual(await core.checkPort(port), false, '返回的端口在绑定前应处于空闲状态');
  });

  it('被绑定的端口应被 checkPort 检测为已监听', async () => {
    const port = await core.selectFreePort();
    const server = http.createServer((_, res) => res.end('ok'));
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

    try {
      assert.strictEqual(await core.checkPort(port), true);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe('Phase 1: validateCDPEndpoint', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
  });

  it('对未监听端口应返回 invalid', async () => {
    // 用一个极不可能被占用的端口
    const result = await core.validateCDPEndpoint(19999);
    assert.strictEqual(result.valid, false);
  });

  it('对返回 webSocketDebuggerUrl 的 mock CDP 端点应返回 valid', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Browser: 'Mock Chrome/1.0',
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/mock',
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const { port } = server.address();
    const result = await core.validateCDPEndpoint(port);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.info.Browser, 'Mock Chrome/1.0');
  });
});

describe('Phase 1: readState (cdp-state.json)', () => {
  let stateBackup;

  beforeEach(() => {
    stateBackup = backupFile(core.STATE_FILE);
  });

  afterEach(() => {
    restoreFile(core.STATE_FILE, stateBackup);
  });

  it('readState 在文件不存在时返回 null', () => {
    try { fs.unlinkSync(core.STATE_FILE); } catch {}
    const result = core.readState();
    assert.strictEqual(result, null);
  });

  it('readState 应读取完整 JSON 状态', () => {
    const expected = {
      pid: 12345,
      port: 9222,
      startedAt: '2026-05-16T00:00:00.000Z',
      auth_verified_domains: ['github.com'],
    };
    fs.mkdirSync(path.dirname(core.STATE_FILE), { recursive: true });
    fs.writeFileSync(core.STATE_FILE, JSON.stringify(expected), 'utf-8');

    const result = core.readState();
    assert.deepStrictEqual(result, expected);
  });
});

describe('Phase 1: detectManagedCDPPort', () => {
  let server;
  let stateBackup;
  let activePortBackup;
  let activePortFile;

  beforeEach(() => {
    activePortFile = path.join(os.homedir(), '.sleuth', 'cdp-profile', 'DevToolsActivePort');
    stateBackup = backupFile(core.STATE_FILE);
    activePortBackup = backupFile(activePortFile);
  });

  afterEach(async () => {
    restoreFile(core.STATE_FILE, stateBackup);
    restoreFile(activePortFile, activePortBackup);
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
  });

  it('state 文件中的 managed 端口可用时应优先返回该端口', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/mock' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    fs.mkdirSync(path.dirname(core.STATE_FILE), { recursive: true });
    fs.writeFileSync(core.STATE_FILE, JSON.stringify({ pid: process.pid, port }), 'utf-8');

    const result = await core.detectManagedCDPPort();
    assert.strictEqual(result.port, port);
    assert.ok(result.info.webSocketDebuggerUrl);
  });
});

describe('Phase 1: CLI --check-only 非破坏性', () => {
  it('--check-only 不应启动浏览器', () => {
    const sid = `phase1-check-only-${Date.now()}`;
    const outDir = core.resolveOutputDir(sid);
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}

    execSync(
      `node ${path.join(SCRIPTS_DIR, 'check-deps.mjs')} --check-only --sid ${sid}`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    assert.strictEqual(fs.existsSync(outDir), false, '--check-only 不应创建输出目录');
  });
});

describe('Phase 1: flag 优先级', () => {
  it('--real-browser 与 --check-only 同时指定时 real-browser 优先', () => {
    const output = execSync(
      `node ${path.join(SCRIPTS_DIR, 'check-deps.mjs')} --check-only --real-browser --json 2>&1`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const result = JSON.parse(output);
    assert.strictEqual(result.browser_mode, 'real-browser',
      'real-browser 模式应优先于 check-only');
  });
});

describe('Phase 1: launchManagedBrowser 成功路径（隔离 mock）', () => {
  let server;
  let isolated;
  let spawnCalls;
  const tempHome = path.join(os.tmpdir(), `sleuth-phase1-home-${Date.now()}`);

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
    if (isolated) {
      isolated.cleanup();
      isolated = null;
    }
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  });

  it('应写入 state 文件并返回 ready=true', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Browser: 'Mock Chrome/1.0',
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/mock',
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const { port } = server.address();
    spawnCalls = [];
    isolated = await loadIsolatedCoreForLaunch({ homeDir: tempHome, spawnCalls });

    const result = await isolated.mod.launchManagedBrowser({ port });
    const expectedStateFile = path.join(tempHome, '.sleuth', 'cdp-state.json');
    const state = JSON.parse(fs.readFileSync(expectedStateFile, 'utf-8'));

    assert.deepStrictEqual(result, { ready: true, port, pid: 9876 });
    assert.strictEqual(spawnCalls.length, 1, '应调用一次 spawn');
    assert.ok(spawnCalls[0].args.includes(`--remote-debugging-port=${port}`));
    assert.ok(spawnCalls[0].args.some(arg => arg.includes('--user-data-dir=')));
    assert.strictEqual(state.port, port);
    assert.strictEqual(state.pid, 9876);
  });
});

describe('Phase 1: stopManagedBrowser', () => {
  let stateBackup;

  beforeEach(() => {
    stateBackup = backupFile(core.STATE_FILE);
  });

  afterEach(() => {
    restoreFile(core.STATE_FILE, stateBackup);
  });

  it('应终止 state 中记录的进程并删除状态文件', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });

    try {
      fs.mkdirSync(path.dirname(core.STATE_FILE), { recursive: true });
      fs.writeFileSync(core.STATE_FILE, JSON.stringify({ pid: child.pid, port: 9222 }), 'utf-8');

      core.stopManagedBrowser();

      const exited = await waitFor(() => {
        try {
          process.kill(child.pid, 0);
          return false;
        } catch {
          return true;
        }
      });

      assert.strictEqual(exited, true, 'stopManagedBrowser 应终止记录中的进程');
      assert.strictEqual(fs.existsSync(core.STATE_FILE), false, 'stopManagedBrowser 应删除状态文件');
    } finally {
      try { child.kill('SIGKILL'); } catch {}
    }
  });
});
