import { test } from 'node:test';
import assert from 'node:assert';
import { isAppleScriptAvailable, execJS, listTabs, openTab } from '../lib/applescript-bridge.mjs';

test('isAppleScriptAvailable returns boolean', async () => {
  const result = await isAppleScriptAvailable();
  assert.strictEqual(typeof result, 'boolean');
});

test('isAppleScriptAvailable returns false on non-macOS', async () => {
  if (process.platform !== 'darwin') {
    const result = await isAppleScriptAvailable();
    assert.strictEqual(result, false);
  }
});

test('execJS executes JavaScript in Chrome and returns result', async () => {
  if (process.platform !== 'darwin') return;
  const available = await isAppleScriptAvailable();
  if (!available) return;
  const result = await execJS('document.title');
  assert.strictEqual(typeof result, 'string');
});

test('listTabs returns array of {url, title}', async () => {
  if (process.platform !== 'darwin') return;
  const available = await isAppleScriptAvailable();
  if (!available) return;
  const tabs = await listTabs();
  assert.ok(Array.isArray(tabs));
  if (tabs.length > 0) {
    assert.ok('url' in tabs[0]);
    assert.ok('title' in tabs[0]);
  }
});

test('openTab opens a URL in Chrome', async () => {
  if (process.platform !== 'darwin') return;
  const available = await isAppleScriptAvailable();
  if (!available) return;
  await openTab('https://example.com');
  await new Promise(r => setTimeout(r, 2000));
  const tabs = await listTabs();
  const found = tabs.some(t => t.url.includes('example.com'));
  assert.ok(found, 'example.com should be open in Chrome');
});
