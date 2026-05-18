import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, 'scripts/lib/check-deps-core.mjs'), 'utf8');

test('check-deps-core exports managed state persistence helper', async () => {
  const mod = await import('../scripts/lib/check-deps-core.mjs');
  assert.equal(typeof mod.persistManagedState, 'function');
  assert.equal(typeof mod.ensureCDP, 'function');
  assert.equal(typeof mod.getBrowserStatus, 'function');
});

test('auth verified state is persisted without dropping port and pid', () => {
  assert.match(source, /function persistManagedState/);
  assert.match(source, /auth_verified_domains/);
  assert.match(source, /port: cdpStatus\.cdp_port/);
  assert.match(source, /pid: current\.pid \|\| findManagedBrowserProcess\(\)\?\.pid \|\| null/);
});

test('JSON-mode console suppression is restored with finally', () => {
  assert.match(source, /const origLog = console\.log/);
  assert.match(source, /finally \{\s*console\.log = origLog;\s*console\.error = origErr;\s*\}/s);
});

test('login URL opening uses a dedicated agent-browser session when possible', () => {
  assert.match(source, /'--session', 'sleuth-login'/);
  assert.match(source, /json\/new\?\$\{encodeURIComponent\(loginUrl\)\}/);
});

test('real-browser mode denies all domains when domain is not explicit', () => {
  assert.match(source, /domains_allowed: normalizedDomain \? \[normalizedDomain\] : \[\]/);
  assert.match(source, /未指定 --domain，默认拒绝所有域名访问/);
});
