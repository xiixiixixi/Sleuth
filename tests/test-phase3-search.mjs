/**
 * Phase 3 测试 — Site Search 模块
 *
 * 覆盖：
 * - parseSiteSearch() 解析搜索 schema
 * - buildSearchUrl() URL 构建
 * - routeSearchMode() 路由判断逻辑
 * - expandQuery() 查询扩展
 * - SCROLL_LIMITS 默认值合理性
 * - 只读模式阻断写操作
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const LIB_DIR = path.resolve(import.meta.dirname, '..', 'scripts', 'lib');
const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

let siteSearch;
before(async () => {
  siteSearch = await import(path.join(LIB_DIR, 'site-search.mjs'));
});

describe('Phase 3: SCROLL_LIMITS 默认配置', () => {
  it('限制值应合理', () => {
    const limits = siteSearch.SCROLL_LIMITS;
    assert.ok(limits.MAX_SCROLL_ROUNDS > 0 && limits.MAX_SCROLL_ROUNDS <= 50);
    assert.ok(limits.MAX_RESULTS > 0 && limits.MAX_RESULTS <= 500);
    assert.ok(limits.SCROLL_PAUSE_MS >= 500);
    assert.ok(limits.DEDUP_THRESHOLD >= 1);
  });
});

describe('Phase 3: buildSearchUrl', () => {
  it('模板替换 {query} 为编码后的查询词', () => {
    const schema = { url_template: 'https://example.com/search?q={query}' };
    const url = siteSearch.buildSearchUrl(schema, 'hello world');
    assert.ok(url.includes('hello%20world') || url.includes('hello+world'),
      `URL 应包含编码后的查询词: ${url}`);
  });

  it('处理带 filter 的模板', () => {
    const schema = {
      url_template: 'https://example.com/search?q={query}&type={type}',
      filters: [{ name: 'type', values: ['code', 'issues'] }],
    };
    const url = siteSearch.buildSearchUrl(schema, 'test', { type: 'code' });
    assert.ok(url.includes('type=code'), `URL 应包含 filter: ${url}`);
  });

  it('无 schema 返回 null', () => {
    const url = siteSearch.buildSearchUrl(null, 'test');
    assert.strictEqual(url, null);
  });
});

describe('Phase 3: routeSearchMode', () => {
  it('有 schema + 有 auth → site 模式', () => {
    const result = siteSearch.routeSearchMode({
      domain: 'github.com',
      query: 'test',
      hasAuth: true,
      searchSchema: { url_template: 'https://github.com/search?q={query}' },
    });
    assert.strictEqual(result.mode, 'site');
  });

  it('有 schema + 无 auth → both 模式', () => {
    const result = siteSearch.routeSearchMode({
      domain: 'github.com',
      query: 'test',
      hasAuth: false,
      searchSchema: { url_template: 'https://github.com/search?q={query}' },
    });
    assert.strictEqual(result.mode, 'both');
  });

  it('无 schema → public 模式', () => {
    const result = siteSearch.routeSearchMode({
      domain: 'unknown-site.com',
      query: 'test',
      hasAuth: false,
      searchSchema: null,
    });
    assert.strictEqual(result.mode, 'public');
  });
});

describe('Phase 3: expandQuery', () => {
  it('应返回包含原始查询的数组', () => {
    const expanded = siteSearch.expandQuery('react hooks');
    assert.ok(Array.isArray(expanded), '应返回数组');
    assert.ok(expanded.length >= 1, '至少包含原始查询');
    // 返回格式为 [{query, reason}]
    assert.ok(expanded.some(e => e.query === 'react hooks'), '应包含原始查询');
  });

  it('带 aliases / timebound / exclude 时应生成对应变体', () => {
    const expanded = siteSearch.expandQuery('GitHub issue', {
      primaryName: 'GitHub',
      aliases: ['GH'],
      timebound: '2026',
      exclude: ['archive', 'mirror'],
    });

    assert.ok(expanded.some(e => e.query === 'GH issue' && e.reason.includes('别名变体')),
      '应包含别名变体');
    assert.ok(expanded.some(e => e.query === 'GitHub issue 2026' && e.reason.includes('时间限定')),
      '应包含时间限定变体');
    assert.ok(expanded.some(e => e.query.includes('-archive') && e.query.includes('-mirror')),
      '应包含排除词变体');
  });
});

describe('Phase 3: parseSiteSearch', () => {
  const fixtureFile = path.join(SITE_PATTERNS_DIR, 'fixture-search-domain.example.md');
  let backup = null;

  afterEach(() => {
    if (backup === null) {
      try { fs.unlinkSync(fixtureFile); } catch {}
    } else {
      fs.mkdirSync(SITE_PATTERNS_DIR, { recursive: true });
      fs.writeFileSync(fixtureFile, backup, 'utf-8');
      backup = null;
    }
  });

  it('对不存在的域名返回 null', () => {
    const schema = siteSearch.parseSiteSearch('nonexistent-xyz-98765.com');
    assert.strictEqual(schema, null);
  });

  it('应从真实 site-pattern YAML 中解析正向 search schema', () => {
    fs.mkdirSync(SITE_PATTERNS_DIR, { recursive: true });
    backup = fs.existsSync(fixtureFile) ? fs.readFileSync(fixtureFile, 'utf-8') : null;
    fs.writeFileSync(fixtureFile, `---
domain: fixture-search-domain.example
search:
  url_template: "https://fixture-search-domain.example/search?q={query}&type={type}"
  result_selector: ".search-result"
  pagination: "cursor"
  filters:
    type: "repo"
updated: 2026-05-16
---

## 测试 fixture
`, 'utf-8');

    const schema = siteSearch.parseSiteSearch('fixture-search-domain.example');

    assert.deepStrictEqual(schema, {
      url_template: 'https://fixture-search-domain.example/search?q={query}&type={type}',
      result_selector: '.search-result',
      pagination: 'cursor',
      filters: {
        type: 'repo',
      },
    });
  });
});

describe('Phase 3: 只读模式阻断写操作', () => {
  it('isWriteOperation 阻断 .click() 调用', () => {
    assert.ok(siteSearch.isWriteOperation('el.click()'));
  });

  it('isWriteOperation 阻断 fetch POST', () => {
    assert.ok(siteSearch.isWriteOperation('fetch("/api", {method: "POST"})'));
  });

  it('isWriteOperation 放行只读 DOM 查询', () => {
    assert.ok(!siteSearch.isWriteOperation('document.querySelectorAll(".item").length'));
  });

  it('isWriteOperation 阻断 appendChild', () => {
    assert.ok(siteSearch.isWriteOperation('parent.appendChild(child)'));
  });

  it('isWriteOperation 阻断 localStorage.setItem', () => {
    assert.ok(siteSearch.isWriteOperation('localStorage.setItem("k","v")'));
  });

  it('isWriteOperation 阻断 innerHTML 赋值', () => {
    assert.ok(siteSearch.isWriteOperation('el.innerHTML = "<div>x</div>"'));
  });

  it('isWriteOperation 阻断 document.cookie 赋值', () => {
    assert.ok(siteSearch.isWriteOperation('document.cookie = "a=b"'));
  });

  it('isWriteOperation 阻断 navigator.sendBeacon', () => {
    assert.ok(siteSearch.isWriteOperation('navigator.sendBeacon("/log", data)'));
  });

  it('isWriteOperation 阻断 dispatchEvent', () => {
    assert.ok(siteSearch.isWriteOperation('el.dispatchEvent(new Event("click"))'));
  });

  it('isWriteOperation 放行 getComputedStyle', () => {
    assert.ok(!siteSearch.isWriteOperation('getComputedStyle(el).color'));
  });

  it('isWriteOperation 放行 textContent 读取', () => {
    assert.ok(!siteSearch.isWriteOperation('el.textContent'));
  });
});

describe('Phase 3: buildSearchUrl 多 filter 组合', () => {
  it('多个 filter 同时替换', () => {
    const schema = {
      url_template: 'https://x.com/search?q={query}&lang={lang}&sort={sort}',
      filters: { lang: 'string', sort: 'string' },
    };
    const url = siteSearch.buildSearchUrl(schema, 'test', { lang: 'zh', sort: 'date' });
    assert.ok(url.includes('lang=zh'), `应包含 lang=zh: ${url}`);
    assert.ok(url.includes('sort=date'), `应包含 sort=date: ${url}`);
  });

  it('filter 值包含特殊字符时正确编码', () => {
    const schema = {
      url_template: 'https://x.com/search?q={query}&tag={tag}',
      filters: { tag: 'string' },
    };
    const url = siteSearch.buildSearchUrl(schema, 'hello', { tag: 'c++ & java' });
    assert.ok(url.includes('c%2B%2B'), `应编码 +: ${url}`);
  });

  it('未提供的 filter 占位符保留原样', () => {
    const schema = {
      url_template: 'https://x.com/search?q={query}&page={page}',
      filters: { page: 'number' },
    };
    const url = siteSearch.buildSearchUrl(schema, 'test', {});
    assert.ok(url.includes('{page}'), `未提供的 filter 应保留: ${url}`);
  });
});

describe('Phase 3: evalViaCDP 错误处理', () => {
  let originalWebSocket;
  let originalSetTimeout;
  let originalClearTimeout;

  before(() => {
    originalWebSocket = globalThis.WebSocket;
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
  });

  afterEach(() => {
    delete process.env.SLEUTH_READ_ONLY;
    delete process.env.SLEUTH_BROWSER_MODE;
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  it('收到 exceptionDetails 时应返回错误对象', async () => {
    class ExceptionWebSocket {
      constructor() {
        queueMicrotask(() => this.onopen?.());
        queueMicrotask(() => this.onmessage?.({
          data: JSON.stringify({
            id: 1,
            result: {
              exceptionDetails: { text: 'ReferenceError: foo is not defined' },
            },
          }),
        }));
      }
      close() {}
      send() {}
    }

    globalThis.WebSocket = ExceptionWebSocket;

    const result = await siteSearch.evalViaCDP(
      'ws://127.0.0.1/devtools/page/1',
      'foo()',
      { pageUrl: 'https://example.com/page' }
    );

    assert.deepStrictEqual(result, { error: 'ReferenceError: foo is not defined' });
  });

  it('收到非法 JSON 时应返回解析错误对象', async () => {
    class InvalidJsonWebSocket {
      constructor() {
        queueMicrotask(() => this.onopen?.());
        queueMicrotask(() => this.onmessage?.({ data: 'not-json' }));
      }
      close() {}
      send() {}
    }

    globalThis.WebSocket = InvalidJsonWebSocket;

    const result = await siteSearch.evalViaCDP(
      'ws://127.0.0.1/devtools/page/1',
      'document.title',
      { pageUrl: 'https://example.com/page' }
    );

    assert.ok(result.error);
    assert.match(result.error, /JSON|Unexpected token|not valid JSON/i);
  });

  it('连接错误时应返回 WebSocket 连接失败', async () => {
    class ErrorWebSocket {
      constructor() {
        queueMicrotask(() => this.onerror?.(new Error('boom')));
      }
      close() {}
      send() {}
    }

    globalThis.WebSocket = ErrorWebSocket;

    const result = await siteSearch.evalViaCDP(
      'ws://127.0.0.1/devtools/page/1',
      'document.title',
      { pageUrl: 'https://example.com/page' }
    );

    assert.deepStrictEqual(result, { error: 'WebSocket 连接失败' });
  });

  it('超时时应返回超时错误', async () => {
    class HangingWebSocket {
      close() {}
      send() {}
    }

    globalThis.WebSocket = HangingWebSocket;
    globalThis.setTimeout = (fn) => {
      queueMicrotask(fn);
      return 1;
    };
    globalThis.clearTimeout = () => {};

    const result = await siteSearch.evalViaCDP(
      'ws://127.0.0.1/devtools/page/1',
      'document.title',
      { pageUrl: 'https://example.com/page' }
    );

    assert.deepStrictEqual(result, { error: '超时' });
  });
});

describe('Phase 3: 结果级 provenance 字段', () => {
  it('默认提取脚本应包含 author 和 date 字段', async () => {
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;

    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('/json/list')) {
          return {
            ok: true,
            json: async () => [{ url: 'https://example.com/search', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' }],
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      };

      globalThis.WebSocket = class {
        constructor() {
          queueMicrotask(() => this.onopen?.());
        }
        send(payload) {
          const msg = JSON.parse(payload);
          queueMicrotask(() => this.onmessage?.({
            data: JSON.stringify({
              id: msg.id,
              result: {
                result: {
                  value: [{
                    title: '标题',
                    url: 'https://example.com/post-1',
                    snippet: '摘要正文',
                    rank: 1,
                    author: '来源作者',
                    date: '2026-05-16',
                  }],
                },
              },
            }),
          }));
        }
        close() {}
      };

      const result = await siteSearch.extractSearchResults(9222, 'https://example.com/search', '.result');

      assert.strictEqual(result.results.length, 1);
      assert.strictEqual(result.results[0].author, '来源作者');
      assert.strictEqual(result.results[0].date, '2026-05-16');
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
    }
  });
});
