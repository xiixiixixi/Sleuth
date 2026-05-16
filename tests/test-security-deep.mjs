/**
 * 深度安全测试 — 使用生产代码导出的守卫函数
 *
 * Oracle 反馈修复：
 * 1. 使用 siteSearch.isWriteOperation() 而非测试内自定义 regex
 * 2. 使用临时 fixture 文件测试 parseSiteAuth 真实解析
 * 3. execFileSync 安全性验证（无 shell 注入）
 * 4. 已知绕过不再是绿色测试，标为 TODO
 * 5. extractDomain / buildVerifyResult / routeSearchMode / expandQuery 完整覆盖
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const LIB_DIR = path.resolve(import.meta.dirname, '..', 'scripts', 'lib');

let siteSearch, authVerify;
before(async () => {
  siteSearch = await import(path.join(LIB_DIR, 'site-search.mjs'));
  authVerify = await import(path.join(LIB_DIR, 'auth-verify.mjs'));
});

// ─── 只读守卫：使用生产代码的 isWriteOperation ──────────────────────────

describe('只读守卫: isWriteOperation（生产代码导出）', () => {
  // 应阻断的表达式
  const BLOCKED = [
    'document.querySelector("btn").click()',
    'form.submit()',
    'el.reset()',
    'input.value = "hack"',
    'div.innerHTML = "<script>alert(1)</script>"',
    'el.remove()',
    'document.write("pwned")',
    'fetch("/api", {method: "POST"})',
    'fetch("/api", {method: "DELETE"})',
    'fetch("/api", {method: "PUT"})',
    'fetch("/api", {method: "PATCH"})',
    // 大小写变体（/i flag）
    'el.CLICK()',
    'el.Click()',
    'fetch("/x", {method: "post"})',
  ];

  // 应放行的表达式
  const ALLOWED = [
    'document.querySelectorAll(".item").length',
    'document.title',
    'JSON.stringify([...document.querySelectorAll("a")].map(a=>a.href))',
    'fetch("/api").then(r=>r.json())',
    'window.scrollTo(0, document.body.scrollHeight)',
    'document.body.innerText',
    'el.getAttribute("value")',
    'el.textContent',
  ];

  for (const expr of BLOCKED) {
    it(`阻断: ${expr.slice(0, 50)}`, () => {
      assert.ok(siteSearch.isWriteOperation(expr), `生产守卫未能阻断: ${expr}`);
    });
  }

  for (const expr of ALLOWED) {
    it(`放行: ${expr.slice(0, 50)}`, () => {
      assert.ok(!siteSearch.isWriteOperation(expr), `生产守卫误阻断: ${expr}`);
    });
  }
});

describe('只读守卫: WRITE_PATTERNS 与 isWriteOperation 一致性', () => {
  it('WRITE_PATTERNS 是 RegExp 实例', () => {
    assert.ok(siteSearch.WRITE_PATTERNS instanceof RegExp);
  });

  it('isWriteOperation 与 WRITE_PATTERNS.test 结果一致', () => {
    const exprs = ['el.click()', 'document.title', 'form.submit()'];
    for (const e of exprs) {
      assert.strictEqual(
        siteSearch.isWriteOperation(e),
        siteSearch.WRITE_PATTERNS.test(e),
        `不一致: ${e}`
      );
    }
  });
});

// ─── parseSiteAuth 使用临时 fixture 文件 ────────────────────────────────

describe('parseSiteAuth 真实解析（fixture 文件）', () => {
  const FIXTURE_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');
  const FIXTURE_FILE = path.join(FIXTURE_DIR, 'test-fixture-domain.com.md');
  const FIXTURE_CONTENT = `---
domain: test-fixture-domain.com
auth:
  login_url: "https://test-fixture-domain.com/login"
  type: dom
  selector: "[data-testid=user-avatar]"
updated: 2026-01-01
---
## 测试用 fixture
`;

  before(() => {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(FIXTURE_FILE, FIXTURE_CONTENT, 'utf-8');
  });

  after(() => {
    if (fs.existsSync(FIXTURE_FILE)) fs.unlinkSync(FIXTURE_FILE);
  });

  it('解析 login_url', () => {
    const result = authVerify.parseSiteAuth('test-fixture-domain.com');
    assert.notStrictEqual(result, null, '应解析成功');
    assert.strictEqual(result.login_url, 'https://test-fixture-domain.com/login');
  });

  it('解析 verify.type 和 verify.selector', () => {
    const result = authVerify.parseSiteAuth('test-fixture-domain.com');
    assert.notStrictEqual(result.verify, null);
    assert.strictEqual(result.verify.type, 'dom');
    assert.strictEqual(result.verify.selector, '[data-testid=user-avatar]');
  });

  it('verify.type === "dom" 匹配 verifyAuth 期望格式', () => {
    // verifyAuth 要求 siteAuth.verify.type === 'dom'
    const result = authVerify.parseSiteAuth('test-fixture-domain.com');
    assert.strictEqual(result.verify.type, 'dom',
      'type 必须是 "dom" 才能触发 site-specific DOM 验证器');
  });

  it('不存在的域名返回 null', () => {
    assert.strictEqual(authVerify.parseSiteAuth('nonexistent-xyz-99999.com'), null);
  });

  it('www. 前缀剥离匹配', () => {
    // 访问 www.test-fixture-domain.com 应匹配 test-fixture-domain.com.md
    const result = authVerify.parseSiteAuth('www.test-fixture-domain.com');
    assert.notStrictEqual(result, null, 'www. 前缀应匹配');
  });
});

// ─── extractDomain 边界情况 ──────────────────────────────────────────────

describe('extractDomain 边界情况', () => {
  it('标准 HTTPS URL', () => {
    assert.strictEqual(authVerify.extractDomain('https://github.com/foo'), 'github.com');
  });

  it('带端口的 URL', () => {
    assert.strictEqual(authVerify.extractDomain('http://localhost:3000/path'), 'localhost');
  });

  it('裸域名（无协议）返回空字符串', () => {
    assert.strictEqual(authVerify.extractDomain('github.com'), '');
  });

  it('空字符串返回空', () => {
    assert.strictEqual(authVerify.extractDomain(''), '');
  });

  it('null/undefined 不抛异常', () => {
    assert.doesNotThrow(() => authVerify.extractDomain(null));
    assert.doesNotThrow(() => authVerify.extractDomain(undefined));
  });

  it('子域名保留完整', () => {
    assert.strictEqual(authVerify.extractDomain('https://api.github.com/v3'), 'api.github.com');
  });
});

// ─── buildVerifyResult 测试 ─────────────────────────────────────────────

describe('buildVerifyResult 各种状态组合', () => {
  it('verified 状态包含完整结构', () => {
    const r = authVerify.buildVerifyResult('github.com', 'verified', ['has_avatar', 'has_username']);
    assert.strictEqual(r.auth_state, 'verified');
    assert.strictEqual(r.domain, 'github.com');
    assert.deepStrictEqual(r.signals, ['has_avatar', 'has_username']);
    assert.strictEqual(r.sensitive_values_printed, false);
  });

  it('not_verified 状态', () => {
    const r = authVerify.buildVerifyResult('x.com', 'not_verified', ['login_form_present']);
    assert.strictEqual(r.auth_state, 'not_verified');
    assert.strictEqual(r.domain, 'x.com');
    assert.strictEqual(r.sensitive_values_printed, false);
  });

  it('skipped 状态', () => {
    const r = authVerify.buildVerifyResult('example.com', 'skipped', []);
    assert.strictEqual(r.auth_state, 'skipped');
    assert.deepStrictEqual(r.signals, []);
    assert.strictEqual(r.sensitive_values_printed, false);
  });

  it('unknown 状态', () => {
    const r = authVerify.buildVerifyResult('test.com', 'unknown', ['cdp_error']);
    assert.strictEqual(r.auth_state, 'unknown');
    assert.deepStrictEqual(r.signals, ['cdp_error']);
    assert.strictEqual(r.sensitive_values_printed, false);
  });

  it('sensitive_values_printed 始终为 false（安全约束）', () => {
    // 验证无论传入什么参数，sensitive_values_printed 都是 false
    const states = ['verified', 'not_verified', 'skipped', 'unknown'];
    for (const s of states) {
      const r = authVerify.buildVerifyResult('d.com', s, []);
      assert.strictEqual(r.sensitive_values_printed, false,
        `${s} 状态下 sensitive_values_printed 应为 false`);
    }
  });
});

// ─── routeSearchMode 完整矩阵 ──────────────────────────────────────────

describe('routeSearchMode 完整决策矩阵', () => {
  const schema = { url_template: 'https://x.com/search?q={query}' };

  it('schema=yes, auth=yes → site', () => {
    const r = siteSearch.routeSearchMode({ domain: 'x.com', query: 'q', hasAuth: true, searchSchema: schema });
    assert.strictEqual(r.mode, 'site');
  });

  it('schema=yes, auth=no → both', () => {
    const r = siteSearch.routeSearchMode({ domain: 'x.com', query: 'q', hasAuth: false, searchSchema: schema });
    assert.strictEqual(r.mode, 'both');
  });

  it('schema=no, auth=yes → public（无搜索入口）', () => {
    const r = siteSearch.routeSearchMode({ domain: 'x.com', query: 'q', hasAuth: true, searchSchema: null });
    assert.strictEqual(r.mode, 'public');
  });

  it('schema=no, auth=no → public', () => {
    const r = siteSearch.routeSearchMode({ domain: 'x.com', query: 'q', hasAuth: false, searchSchema: null });
    assert.strictEqual(r.mode, 'public');
  });

  it('返回值包含 reason 字段（字符串）', () => {
    const r = siteSearch.routeSearchMode({ domain: 'x.com', query: 'q', hasAuth: true, searchSchema: schema });
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  });
});

// ─── expandQuery 详细测试 ────────────────────────────────────────────────

describe('expandQuery 详细行为', () => {
  it('返回的每个元素都有 query 和 reason', () => {
    const results = siteSearch.expandQuery('test query');
    for (const r of results) {
      assert.ok('query' in r, `缺少 query 字段: ${JSON.stringify(r)}`);
      assert.ok('reason' in r, `缺少 reason 字段: ${JSON.stringify(r)}`);
      assert.ok(typeof r.query === 'string' && r.query.length > 0);
      assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    }
  });

  it('第一个结果应为原始查询', () => {
    const results = siteSearch.expandQuery('exact query');
    assert.strictEqual(results[0].query, 'exact query');
  });

  it('空查询不抛异常', () => {
    assert.doesNotThrow(() => siteSearch.expandQuery(''));
  });

  it('带 context 时仍返回有效数组', () => {
    const results = siteSearch.expandQuery('deploy', { domain: 'github.com', language: 'zh' });
    assert.ok(Array.isArray(results) && results.length >= 1);
    assert.ok(results.every(r => typeof r.query === 'string'));
  });
});

// ─── SCROLL_LIMITS 安全边界 ─────────────────────────────────────────────

describe('SCROLL_LIMITS 安全边界', () => {
  it('MAX_RESULTS 不超过 500 防止内存溢出', () => {
    assert.ok(siteSearch.SCROLL_LIMITS.MAX_RESULTS <= 500);
  });

  it('MAX_SCROLL_ROUNDS 不超过 50 防止无限循环', () => {
    assert.ok(siteSearch.SCROLL_LIMITS.MAX_SCROLL_ROUNDS <= 50);
  });

  it('SCROLL_PAUSE_MS 至少 500ms 防止被反爬', () => {
    assert.ok(siteSearch.SCROLL_LIMITS.SCROLL_PAUSE_MS >= 500);
  });

  it('DEDUP_THRESHOLD 至少为 1', () => {
    assert.ok(siteSearch.SCROLL_LIMITS.DEDUP_THRESHOLD >= 1);
  });
});

// ─── evalOnPage 安全性：验证不使用 shell ────────────────────────────────

describe('evalOnPage 安全性', () => {
  it('auth-verify.mjs 不使用 execSync（fail-closed，无 agent-browser 降级）', async () => {
    // evalOnPage 已改为 fail-closed：无 WebSocket 时返回 null，不调用外部进程
    const src = fs.readFileSync(path.join(LIB_DIR, 'auth-verify.mjs'), 'utf-8');
    // 确认不使用 execSync（排除 execFileSync 中的子串）
    const withoutExecFile = src.replace(/execFileSync/g, '');
    assert.ok(!withoutExecFile.includes('execSync'), '不应使用 execSync（shell 注入风险）');
  });

  it('auth-verify.mjs 不使用 shell: true 选项', async () => {
    const src = fs.readFileSync(path.join(LIB_DIR, 'auth-verify.mjs'), 'utf-8');
    assert.ok(!src.includes('shell: true'), '不应设置 shell: true');
    assert.ok(!src.includes('shell:true'), '不应设置 shell:true');
  });
});

describe('evalViaCDP 只读模式集成测试', () => {
  let originalEnv;

  before(() => { originalEnv = process.env.SLEUTH_READ_ONLY; });
  after(() => {
    if (originalEnv === undefined) delete process.env.SLEUTH_READ_ONLY;
    else process.env.SLEUTH_READ_ONLY = originalEnv;
  });

  it('只读模式下 evalViaCDP 阻断写操作并返回 error 对象', async () => {
    process.env.SLEUTH_READ_ONLY = 'true';
    // 设置 state 允许所有域名，以通过域名校验，专注测试写操作拦截
    const statePath = path.join(os.homedir(), '.sleuth', 'cdp-state.json');
    const origState = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf-8') : null;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ domains_allowed: ['*'] }));
    try {
      const result = await siteSearch.evalViaCDP('ws://127.0.0.1:1/invalid', 'document.body.innerHTML = "hacked"', { pageUrl: 'https://example.com' });
      assert.ok(result.error, '应返回包含 error 的对象');
      assert.ok(result.error.includes('只读'), `错误信息应包含"只读": ${result.error}`);
    } finally {
      if (origState !== null) fs.writeFileSync(statePath, origState);
      else try { fs.unlinkSync(statePath); } catch {}
    }
  });

  it('只读模式下读操作不触发 guard（验证 guard 逻辑）', () => {
    process.env.SLEUTH_READ_ONLY = 'true';
    // 读操作不应被 isWriteOperation 识别
    assert.ok(!siteSearch.isWriteOperation('document.title'), '读操作不应被识别为写操作');
    // 因此 evalViaCDP 中的 guard 不会拦截
  });

  it('非只读模式下写操作不被 guard 拦截（验证 guard 逻辑）', () => {
    delete process.env.SLEUTH_READ_ONLY;
    // 不实际调用 evalViaCDP（会触发 WebSocket 连接），
    // 而是验证 isWriteOperation 在非只读模式下不影响流程
    // guard 逻辑：只在 SLEUTH_READ_ONLY=true 时检查
    assert.strictEqual(process.env.SLEUTH_READ_ONLY, undefined);
    // 写操作本身仍会被 isWriteOperation 识别，但 evalViaCDP 不会拦截
    assert.ok(siteSearch.isWriteOperation('el.click()'), 'isWriteOperation 仍能识别写操作');
  });
});

describe('负面路径：错误处理', () => {
  it('findPageByUrl 对无效端口返回 null', async () => {
    const result = await siteSearch.findPageByUrl(1, 'https://example.com');
    assert.strictEqual(result, null, '无效端口应返回 null');
  });

  it('extractSearchResults 对无效端口返回带 error 的结果', async () => {
    const result = await siteSearch.extractSearchResults(1, 'https://example.com', '.result');
    assert.ok(result.error, '应包含 error 字段');
    assert.deepStrictEqual(result.results, [], '结果应为空数组');
  });

  it('extractDomain 对非 URL 字符串返回空', () => {
    assert.strictEqual(authVerify.extractDomain('not-a-url'), '');
    assert.strictEqual(authVerify.extractDomain(''), '');
    assert.strictEqual(authVerify.extractDomain(null), '');
  });

  it('buildSearchUrl 对空 query 仍能生成 URL', () => {
    const schema = { url_template: 'https://x.com/search?q={query}' };
    const url = siteSearch.buildSearchUrl(schema, '');
    assert.strictEqual(url, 'https://x.com/search?q=');
  });
});

// ── Oracle round 6 补充测试 ──────────────────────────────────────────────────

describe('checkDomainAllowed 通配符与 deny-all 语义', () => {
  let origEnv, statePath;

  before(() => {
    origEnv = process.env.SLEUTH_READ_ONLY;
    process.env.SLEUTH_READ_ONLY = 'true';
    statePath = path.join(os.homedir(), '.sleuth', 'cdp-state.json');
  });
  after(() => {
    if (origEnv === undefined) delete process.env.SLEUTH_READ_ONLY;
    else process.env.SLEUTH_READ_ONLY = origEnv;
  });

  it('domains_allowed 含 "*" 时允许任意域名', () => {
    // 写临时 state
    const origState = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf-8') : null;
    fs.writeFileSync(statePath, JSON.stringify({ domains_allowed: ['*'], browser_mode: 'real-browser' }));
    try {
      const result = siteSearch.checkDomainAllowed('https://anything.example.org/path');
      assert.strictEqual(result.allowed, true);
    } finally {
      if (origState) fs.writeFileSync(statePath, origState);
      else fs.unlinkSync(statePath);
    }
  });

  it('domains_allowed 为空数组时 deny-all', () => {
    const origState = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf-8') : null;
    fs.writeFileSync(statePath, JSON.stringify({ domains_allowed: [], browser_mode: 'real-browser' }));
    try {
      const result = siteSearch.checkDomainAllowed('https://blocked.com/page');
      assert.strictEqual(result.allowed, false);
    } finally {
      if (origState) fs.writeFileSync(statePath, origState);
      else fs.unlinkSync(statePath);
    }
  });
});

describe('evalViaCDP fail-closed 无 WebSocket', () => {
  it('site-search.mjs 中不存在 evalViaAgentBrowser 函数', () => {
    const src = fs.readFileSync(path.join(LIB_DIR, 'site-search.mjs'), 'utf-8');
    assert.ok(!src.includes('function evalViaAgentBrowser'), '应已删除 evalViaAgentBrowser 死代码');
    assert.ok(!src.includes('evalViaAgentBrowser('), '不应有任何调用 evalViaAgentBrowser 的代码');
  });

  it('auth-verify.mjs 中不存在 agent-browser fallback 调用', () => {
    const src = fs.readFileSync(path.join(LIB_DIR, 'auth-verify.mjs'), 'utf-8');
    assert.ok(!src.includes('evalViaAgentBrowser'), '应已删除 evalViaAgentBrowser 调用');
    assert.ok(!src.includes('execFileSync(\'agent-browser\''), '不应通过 execFileSync 调用 agent-browser');
  });
});

describe('route-task.mjs 端口校验边界', () => {
  const routeTask = path.join(import.meta.dirname, '..', 'scripts', 'route-task.mjs');

  const invalidPorts = ['0', '-1', '1.5', '0x10', '08', '65536', 'abc', '99999'];

  for (const port of invalidPorts) {
    it(`拒绝非法端口: "${port}"`, () => {
      try {
        execFileSync(process.execPath, [routeTask, '--domain', 'x.com', '--query', 'test', '--cdp-port', port], {
          encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.fail(`应拒绝端口 "${port}"`);
      } catch (err) {
        // 非零退出码 = 校验生效
        assert.ok(err.status !== 0, `端口 "${port}" 应导致非零退出码`);
        // 确认是端口校验拦截，而非无关失败
        const output = (err.stderr || '') + (err.stdout || '');
        assert.ok(output.includes('--cdp-port'), `端口 "${port}" 的错误信息应提及 --cdp-port`);
      }
    });
  }
});

// ─── 域名限制纵深防御测试 ─────────────────────────────────────────────────────

describe('checkDomainAllowed 环境变量触发条件', () => {
  let origReadOnly, origBrowserMode;

  before(() => {
    origReadOnly = process.env.SLEUTH_READ_ONLY;
    origBrowserMode = process.env.SLEUTH_BROWSER_MODE;
  });

  after(() => {
    if (origReadOnly === undefined) delete process.env.SLEUTH_READ_ONLY;
    else process.env.SLEUTH_READ_ONLY = origReadOnly;
    if (origBrowserMode === undefined) delete process.env.SLEUTH_BROWSER_MODE;
    else process.env.SLEUTH_BROWSER_MODE = origBrowserMode;
  });

  it('SLEUTH_BROWSER_MODE=real-browser 时域名限制生效（无需 SLEUTH_READ_ONLY）', () => {
    delete process.env.SLEUTH_READ_ONLY;
    process.env.SLEUTH_BROWSER_MODE = 'real-browser';
    // 无 cdp-state.json → 默认拒绝
    const result = siteSearch.checkDomainAllowed('https://example.com');
    assert.strictEqual(result.allowed, false, '应被拒绝');
  });

  it('两个环境变量都不设置时域名限制不生效', () => {
    delete process.env.SLEUTH_READ_ONLY;
    delete process.env.SLEUTH_BROWSER_MODE;
    const result = siteSearch.checkDomainAllowed('https://example.com');
    assert.strictEqual(result.allowed, true, '应放行');
  });
});

describe('evalViaCDP 纵深防御：pageUrl 域名校验', () => {
  let origReadOnly, origBrowserMode;

  before(() => {
    origReadOnly = process.env.SLEUTH_READ_ONLY;
    origBrowserMode = process.env.SLEUTH_BROWSER_MODE;
  });

  after(() => {
    if (origReadOnly === undefined) delete process.env.SLEUTH_READ_ONLY;
    else process.env.SLEUTH_READ_ONLY = origReadOnly;
    if (origBrowserMode === undefined) delete process.env.SLEUTH_BROWSER_MODE;
    else process.env.SLEUTH_BROWSER_MODE = origBrowserMode;
  });

  it('传入 pageUrl 且域名不在允许列表时阻断', async () => {
    process.env.SLEUTH_BROWSER_MODE = 'real-browser';
    delete process.env.SLEUTH_READ_ONLY;
    const result = await siteSearch.evalViaCDP(
      'ws://127.0.0.1:1/invalid',
      'document.title',
      { pageUrl: 'https://blocked.example.com/page' }
    );
    assert.ok(result.error, '应返回 error');
    assert.ok(result.error.includes('域名限制'), `应包含域名限制: ${result.error}`);
  });

  it('不传 pageUrl 时受限模式默认拒绝（防绕过）', async () => {
    process.env.SLEUTH_READ_ONLY = 'true';
    // 受限模式下不传 pageUrl → 直接拒绝，不尝试连接
    const result = await siteSearch.evalViaCDP(
      'ws://127.0.0.1:1/invalid',
      'document.title'
    );
    assert.ok(result.error, '应返回错误');
    assert.ok(result.error.includes('必须提供 options.pageUrl'), '错误信息应提及 pageUrl 必须');
  });
});

// ── stale state 防护测试 ──────────────────────────────────────
describe('checkDomainAllowed stale state 防护', () => {
  const statePath = path.join(os.homedir(), '.sleuth', 'cdp-state.json');
  let originalContent;

  before(() => {
    try { originalContent = fs.readFileSync(statePath, 'utf-8'); } catch { originalContent = null; }
  });

  after(() => {
    if (originalContent !== null) {
      fs.writeFileSync(statePath, originalContent);
    } else {
      try { fs.unlinkSync(statePath); } catch {}
    }
    delete process.env.SLEUTH_BROWSER_MODE;
    delete process.env.SLEUTH_READ_ONLY;
  });

  it('旧 state 含 domains_allowed=["*"] 但当前模式为 real-browser 时仍读取 state 文件', () => {
    process.env.SLEUTH_BROWSER_MODE = 'real-browser';
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ domains_allowed: ['*'], browser_mode: 'managed' }));
    const result = siteSearch.checkDomainAllowed('https://any-domain.com/page');
    assert.strictEqual(result.allowed, true, '通配符 * 应放行');
  });

  it('旧 state 含 domains_allowed=["specific.com"] 时拒绝其他域名', () => {
    process.env.SLEUTH_BROWSER_MODE = 'real-browser';
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ domains_allowed: ['specific.com'], browser_mode: 'real-browser' }));
    const result = siteSearch.checkDomainAllowed('https://evil.com/page');
    assert.strictEqual(result.allowed, false, '非允许域名应被拒绝');
    assert.ok(result.error.includes('evil.com'), '错误应提及被拒绝的域名');
  });

  it('state 文件被删除时 real-browser 模式默认拒绝', () => {
    process.env.SLEUTH_BROWSER_MODE = 'real-browser';
    try { fs.unlinkSync(statePath); } catch {}
    const result = siteSearch.checkDomainAllowed('https://any.com/page');
    assert.strictEqual(result.allowed, false, '无 state 文件应默认拒绝');
  });
});
