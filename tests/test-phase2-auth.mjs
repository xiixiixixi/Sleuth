/**
 * Phase 2 测试 — Auth Verify 模块
 *
 * 覆盖：
 * - parseSiteAuth() 解析 site-pattern 中的 auth 配置
 * - buildVerifyResult() 输出格式
 * - extractDomain() 域名提取
 * - sensitive_values_printed 始终为 false
 * - auth_verified_domains 持久化
 */

import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const LIB_DIR = path.resolve(import.meta.dirname, '..', 'scripts', 'lib');

let authVerify;
let core;
before(async () => {
  authVerify = await import(path.join(LIB_DIR, 'auth-verify.mjs'));
  core = await import(path.join(LIB_DIR, 'check-deps-core.mjs'));
});

describe('Phase 2: extractDomain', () => {
  it('从完整 URL 中提取域名', () => {
    assert.strictEqual(authVerify.extractDomain('https://github.com/foo/bar'), 'github.com');
    assert.strictEqual(authVerify.extractDomain('https://www.example.com/page'), 'www.example.com');
  });

  it('纯域名（无协议）严格返回空字符串', () => {
    // extractDomain 需要完整 URL，纯域名无法解析
    const result = authVerify.extractDomain('github.com');
    assert.strictEqual(result, '');
  });

  it('空值返回空字符串', () => {
    assert.strictEqual(authVerify.extractDomain(''), '');
    assert.strictEqual(authVerify.extractDomain(null), '');
    assert.strictEqual(authVerify.extractDomain(undefined), '');
  });
});

describe('Phase 2: buildVerifyResult', () => {
  it('输出格式符合文档规定', () => {
    const result = authVerify.buildVerifyResult('example.com', 'verified', ['menu_present']);
    assert.strictEqual(result.domain, 'example.com');
    assert.strictEqual(result.auth_state, 'verified');
    assert.deepStrictEqual(result.signals, ['menu_present']);
    assert.strictEqual(result.sensitive_values_printed, false);
  });

  it('sensitive_values_printed 始终为 false', () => {
    const states = ['verified', 'not_verified', 'skipped', 'unknown'];
    for (const state of states) {
      const result = authVerify.buildVerifyResult('x.com', state, []);
      assert.strictEqual(result.sensitive_values_printed, false,
        `auth_state=${state} 时 sensitive_values_printed 应为 false`);
    }
  });
});

describe('Phase 2: parseSiteAuth', () => {
  it('对不存在的域名严格返回 null', () => {
    const result = authVerify.parseSiteAuth('nonexistent-domain-xyz-12345.com');
    assert.strictEqual(result, null, '不存在的域名不应有 auth 配置');
  });
});

// ── verifyAuth 逻辑路径测试（mock fetch） ──

describe('Phase 2: verifyAuth 核心逻辑', () => {
  let originalFetch;

  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('CDP /json/list 请求失败 → 返回 unknown + cdp_list_failed', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    const result = await authVerify.verifyAuth(19999, 'https://github.com/test');
    assert.strictEqual(result.auth_state, 'unknown');
    assert.ok(result.signals.includes('cdp_list_failed'));
  });

  it('无页面标签 → 返回 unknown + no_pages', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const result = await authVerify.verifyAuth(19999, 'https://github.com/test');
    assert.strictEqual(result.auth_state, 'unknown');
    assert.ok(result.signals.includes('no_pages'));
  });

  it('目标域名不在任何标签页 → 返回 unknown + target_domain_not_found_in_tabs', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [{ url: 'https://example.com/page' }],
    });
    const result = await authVerify.verifyAuth(19999, 'https://github.com/test');
    assert.strictEqual(result.auth_state, 'unknown');
    assert.ok(result.signals.includes('target_domain_not_found_in_tabs'));
  });

  it('页面 URL 为登录页（/login）→ 标记为 not_verified + on_login_url', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [{ url: 'https://github.com/login' }],
    });
    const result = await authVerify.verifyAuth(19999, 'https://github.com/login');
    assert.strictEqual(result.auth_state, 'not_verified');
    assert.ok(result.signals.includes('on_login_url'),
      '登录页应产生 on_login_url 信号');
  });

  it('fetch 异常（网络错误）→ 返回 unknown', async () => {
    globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
    const result = await authVerify.verifyAuth(19999, 'https://github.com/test');
    assert.strictEqual(result.auth_state, 'unknown');
    assert.ok(result.signals.includes('verification_error'));
  });
});

describe('Phase 2: evalViaWebSocket 错误处理', () => {
  let originalWebSocket;
  let originalSetTimeout;
  let originalClearTimeout;

  before(() => {
    originalWebSocket = globalThis.WebSocket;
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  it('WebSocket 不可用时应 reject 明确错误', async () => {
    globalThis.WebSocket = undefined;

    await assert.rejects(
      authVerify.evalViaWebSocket('ws://127.0.0.1/devtools/page/1', 'document.title'),
      /WebSocket 不可用/
    );
  });

  it('连接错误时应 reject WebSocket 连接失败', async () => {
    class ErrorWebSocket {
      constructor() {
        this.readyState = 0;
        queueMicrotask(() => this.onerror?.(new Error('boom')));
      }
      close() {}
      send() {}
    }

    globalThis.WebSocket = ErrorWebSocket;

    await assert.rejects(
      authVerify.evalViaWebSocket('ws://127.0.0.1/devtools/page/1', 'document.title'),
      /WebSocket 连接失败/
    );
  });

  it('收到非法 JSON 消息时应 fail-closed 返回 null', async () => {
    let closed = false;

    class InvalidJsonWebSocket {
      constructor() {
        queueMicrotask(() => this.onopen?.());
        queueMicrotask(() => this.onmessage?.({ data: 'not-json' }));
      }
      close() { closed = true; }
      send() {}
    }

    globalThis.WebSocket = InvalidJsonWebSocket;

    const result = await authVerify.evalViaWebSocket('ws://127.0.0.1/devtools/page/1', 'document.title');
    assert.strictEqual(result, null);
    assert.strictEqual(closed, true, '收到非法消息后应关闭连接');
  });

  it('超时时应关闭连接并 reject', async () => {
    let closed = false;

    class HangingWebSocket {
      close() { closed = true; }
      send() {}
    }

    globalThis.WebSocket = HangingWebSocket;
    globalThis.setTimeout = (fn) => {
      queueMicrotask(fn);
      return 1;
    };
    globalThis.clearTimeout = () => {};

    await assert.rejects(
      authVerify.evalViaWebSocket('ws://127.0.0.1/devtools/page/1', 'document.title'),
      /WebSocket eval 超时/
    );
    assert.strictEqual(closed, true, '超时后应关闭连接');
  });
});

describe('Phase 2: --auth-required 通用登录引导', () => {
  it('无 site-pattern login_url 时仍显示通用登录提示并允许 skip', async () => {
    let server;
    let port;
    const logs = [];
    const originalLog = console.log;
    const originalExecPath = process.execPath;
    const activePortFile = path.join(core.CDP_PROFILE_DIR, 'DevToolsActivePort');
    const stateFile = core.STATE_FILE;
    const prevActivePort = fs.existsSync(activePortFile) ? fs.readFileSync(activePortFile, 'utf-8') : null;
    const prevState = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf-8') : null;
    const stdinOnce = process.stdin.once.bind(process.stdin);
    const stdinResume = process.stdin.resume.bind(process.stdin);
    const stdinPause = process.stdin.pause.bind(process.stdin);

    try {
      server = http.createServer((req, res) => {
        if (req.url === '/json/version') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/mock` }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });

      fs.mkdirSync(core.CDP_PROFILE_DIR, { recursive: true });
      fs.writeFileSync(activePortFile, `${port}\n/devtools/browser/mock\n`, 'utf-8');
      fs.writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port }, null, 2), 'utf-8');

      console.log = (...args) => logs.push(args.join(' '));
      process.stdin.once = (event, handler) => {
        if (event === 'data') {
          queueMicrotask(() => handler(Buffer.from('skip\n')));
          return process.stdin;
        }
        return stdinOnce(event, handler);
      };
      process.stdin.resume = () => process.stdin;
      process.stdin.pause = () => process.stdin;

      const result = await core.main({
        authRequired: true,
        loginUrl: 'https://no-pattern-auth.example/dashboard',
      });

      assert.strictEqual(result.authVerify.auth_state, 'skipped');
      assert.ok(logs.some((line) => line.includes('请在浏览器中完成登录，完成后按回车继续（输入 skip 跳过）')),
        '应输出通用登录引导');
    } finally {
      console.log = originalLog;
      process.execPath = originalExecPath;
      process.stdin.once = stdinOnce;
      process.stdin.resume = stdinResume;
      process.stdin.pause = stdinPause;
      if (server) await new Promise((resolve) => server.close(resolve));
      if (prevActivePort === null) {
        try { fs.unlinkSync(activePortFile); } catch {}
      } else {
        fs.writeFileSync(activePortFile, prevActivePort, 'utf-8');
      }
      if (prevState === null) {
        try { fs.unlinkSync(stateFile); } catch {}
      } else {
        fs.writeFileSync(stateFile, prevState, 'utf-8');
      }
    }
  });
});
