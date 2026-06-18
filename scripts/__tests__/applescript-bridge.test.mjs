import { test } from 'node:test';
import assert from 'node:assert';
import { isAppleScriptAvailable } from '../lib/applescript-bridge.mjs';

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
