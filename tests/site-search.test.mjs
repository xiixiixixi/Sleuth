import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchUrl,
  routeSearchMode,
  expandQuery,
  isWriteOperation,
} from '../scripts/lib/site-search.mjs';

test('buildSearchUrl replaces query and filter placeholders', () => {
  const url = buildSearchUrl(
    {
      url_template: 'https://example.com/search?q={query}&type={type}',
      filters: { type: ['docs', 'posts'] },
    },
    'agent search',
    { type: 'docs' },
  );

  assert.equal(url, 'https://example.com/search?q=agent%20search&type=docs');
});

test('routeSearchMode falls back to public search without a site schema', () => {
  assert.deepEqual(
    routeSearchMode({ domain: 'example.com', query: 'pricing', hasAuth: false, searchSchema: null }),
    { mode: 'public', reason: '站点无可用搜索配置，使用公共搜索' },
  );
});

test('routeSearchMode prefers site search when schema and auth are available', () => {
  assert.deepEqual(
    routeSearchMode({
      domain: 'example.com',
      query: 'pricing',
      hasAuth: true,
      searchSchema: { url_template: 'https://example.com/search?q={query}' },
    }),
    { mode: 'site', reason: '站点有搜索配置且已验证登录，优先使用站内搜索' },
  );
});

test('routeSearchMode recommends both paths when schema exists but auth is unverified', () => {
  assert.deepEqual(
    routeSearchMode({
      domain: 'example.com',
      query: 'pricing',
      hasAuth: false,
      searchSchema: { url_template: 'https://example.com/search?q={query}' },
    }),
    { mode: 'both', reason: '站点有搜索配置但未验证登录，建议同时尝试站内和公共搜索' },
  );
});

test('expandQuery keeps original query and adds contextual variants', () => {
  const variants = expandQuery('Acme pricing', {
    primaryName: 'Acme',
    aliases: ['Acme AI'],
    timebound: '2026',
    exclude: ['jobs'],
  });

  assert.deepEqual(variants.map(v => v.query), [
    'Acme pricing',
    'Acme AI pricing',
    'Acme pricing 2026',
    'Acme pricing -jobs',
  ]);
});

test('isWriteOperation catches common write expressions', () => {
  assert.equal(isWriteOperation('document.querySelector("button").click()'), true);
  assert.equal(isWriteOperation('document.body.innerText'), false);
  assert.equal(isWriteOperation('localStorage.setItem("x", "y")'), true);
  assert.equal(isWriteOperation('Array.from(document.querySelectorAll("a")).map(a => a.href)'), false);
});
