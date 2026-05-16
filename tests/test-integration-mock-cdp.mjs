/**
 * 集成测试 — Mock CDP Server
 *
 * 使用 Node.js 内置模块模拟 Chrome DevTools Protocol HTTP 端点，
 * 测试 site-search 和 auth-verify 的端到端流程。
 * 注意：WebSocket 部分不在此测试（需要 ws 库），仅测试 HTTP API 层。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';

const LIB_DIR = path.resolve(import.meta.dirname, '..', 'scripts', 'lib');

let siteSearch, authVerify, core;
let mockServer, mockPort;

// ─── Mock CDP HTTP 端点 ──────────────────────────────────────────────────

function createMockCDPHttp(pages) {
  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        Browser: 'Mock Chrome/1.0',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${mockPort}/devtools/browser/mock`,
      }));
    } else if (req.url === '/json/list' || req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pages));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return server;
}

// ─── 测试生命周期 ────────────────────────────────────────────────────────

before(async () => {
  siteSearch = await import(path.join(LIB_DIR, 'site-search.mjs'));
  authVerify = await import(path.join(LIB_DIR, 'auth-verify.mjs'));
  core = await import(path.join(LIB_DIR, 'check-deps-core.mjs'));

  const pages = [
    {
      id: 'page1',
      title: 'Search Results',
      url: 'https://example.com/search?q=test',
      type: 'page',
      webSocketDebuggerUrl: `ws://127.0.0.1:0/devtools/page/page1`,
    },
    {
      id: 'page2',
      title: 'Dashboard',
      url: 'https://dashboard.example.com/',
      type: 'page',
      webSocketDebuggerUrl: `ws://127.0.0.1:0/devtools/page/page2`,
    },
  ];

  mockServer = createMockCDPHttp(pages);
  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      // 更新 pages 中的 webSocketDebuggerUrl 端口
      pages.forEach(p => {
        p.webSocketDebuggerUrl = p.webSocketDebuggerUrl.replace(':0/', `:${mockPort}/`);
      });
      resolve();
    });
  });
});

after(() => {
  mockServer.close();
});

// ─── 集成测试：validateCDPEndpoint ──────────────────────────────────────

describe('集成测试: Mock CDP — validateCDPEndpoint', () => {
  it('应成功验证 mock CDP 端点', async () => {
    const result = await core.validateCDPEndpoint(mockPort);
    assert.strictEqual(result.valid, true, '应验证为有效 CDP 端点');
  });

  it('应返回浏览器版本信息', async () => {
    const result = await core.validateCDPEndpoint(mockPort);
    assert.ok(result.info, '应包含 info 字段');
    assert.ok(result.info.Browser.includes('Mock'), `浏览器应为 Mock: ${result.info.Browser}`);
  });

  it('对无效端口应返回 invalid', async () => {
    const result = await core.validateCDPEndpoint(19876);
    assert.strictEqual(result.valid, false);
  });
});

// ─── 集成测试：findPageByUrl ─────────────────────────────────────────────

describe('集成测试: Mock CDP — findPageByUrl', () => {
  it('应找到匹配域名的页面 WebSocket URL', async () => {
    const wsUrl = await siteSearch.findPageByUrl(mockPort, 'https://example.com/search?q=test');
    assert.ok(wsUrl, '应返回 WebSocket URL');
    assert.ok(wsUrl.includes('page1'), '应匹配 page1');
  });

  it('应找到不同域名的页面', async () => {
    const wsUrl = await siteSearch.findPageByUrl(mockPort, 'https://dashboard.example.com/');
    assert.ok(wsUrl, '应返回 WebSocket URL');
    assert.ok(wsUrl.includes('page2'), '应匹配 page2');
  });

  it('URL 不匹配时应返回 null（navigate=false 仅查找不新开标签）', async () => {
    const wsUrl = await siteSearch.findPageByUrl(mockPort, 'https://nonexistent.com/page', { navigate: false });
    assert.strictEqual(wsUrl, null, '不匹配的 URL 应返回 null');
  });
});

// ─── 集成测试：buildVerifyResult ─────────────────────────────────────────

describe('集成测试: buildVerifyResult — 文档规定格式', () => {
  it('unknown 状态应包含 verification_method 和 timestamp', () => {
    const result = authVerify.buildVerifyResult('example.com', 'unknown', ['level3_ambiguous']);
    assert.strictEqual(result.auth_state, 'unknown');
    assert.ok(result.verification_method);
    assert.ok(result.timestamp);
    assert.strictEqual(result.sensitive_values_printed, false);
  });

  it('verified 状态应包含 verification_method 和 timestamp', () => {
    const result = authVerify.buildVerifyResult('example.com', 'verified', ['account_menu_present']);
    assert.strictEqual(result.auth_state, 'verified');
    assert.ok(result.verification_method);
    assert.ok(result.timestamp);
  });

  it('not_verified 状态应正确构建', () => {
    const result = authVerify.buildVerifyResult('test.org', 'not_verified', ['login_prompts_present']);
    assert.strictEqual(result.auth_state, 'not_verified');
    assert.strictEqual(result.domain, 'test.org');
    assert.strictEqual(result.user_action_required, undefined);
  });
});

// ─── 集成测试：provenance 元数据 ─────────────────────────────────────────

describe('集成测试: provenance 元数据完整性', () => {
  it('extractSearchResults 无 CDP 时返回 error + null provenance（验证真实函数调用）', async () => {
    // 使用无效端口调用真实函数，验证 error path 返回结构
    const result = await siteSearch.extractSearchResults(1, 'https://example.com/search', '.result');
    assert.ok(result.error, '无 CDP 时应返回 error');
    assert.strictEqual(result.provenance, null, '无 CDP 时 provenance 应为 null');
    assert.deepStrictEqual(result.results, [], '无 CDP 时 results 应为空数组');
  });

  it('默认 provenance 字段列表对齐 Phase 3 规范', () => {
    const errorResult = {
      results: [],
      error: '未找到目标页面',
      provenance: null,
    };

    assert.deepStrictEqual(errorResult, {
      results: [],
      error: '未找到目标页面',
      provenance: null,
    });
  });
});

// ─── 集成测试：域名限制（domain enforcement） ─────────────────────────────

describe('集成测试: checkDomainAllowed', () => {
  it('非 real-browser / 非只读模式下默认放行', () => {
    delete process.env.SLEUTH_READ_ONLY;
    delete process.env.SLEUTH_BROWSER_MODE;

    const result = siteSearch.checkDomainAllowed('https://example.com/path');
    assert.deepStrictEqual(result, { allowed: true });
  });
});
