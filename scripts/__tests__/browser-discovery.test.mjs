import { test } from 'node:test';
import assert from 'node:assert';
import { knownBrowsers, checkPort } from '../lib/browser-discovery.mjs';

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
