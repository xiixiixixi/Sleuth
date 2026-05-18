import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAuthFrontmatter,
  buildVerifyResult,
  normalizeDomain,
  extractDomain,
} from '../scripts/lib/auth-verify.mjs';

test('parseAuthFrontmatter extracts login URL and DOM selector', () => {
  const auth = parseAuthFrontmatter(`
domain: example.com
auth:
  login_url: "https://example.com/login"
  verify:
    type: "dom"
    selector: "[data-testid='account-menu']"
updated: 2026-05-18
`);

  assert.deepEqual(auth, {
    login_url: 'https://example.com/login',
    verify: {
      type: 'dom',
      selector: "[data-testid='account-menu']",
    },
  });
});

test('parseAuthFrontmatter returns null when auth block is missing', () => {
  assert.equal(parseAuthFrontmatter('domain: example.com\nupdated: 2026-05-18'), null);
});

test('parseAuthFrontmatter supports login-only auth config', () => {
  const auth = parseAuthFrontmatter(`
auth:
  login_url: 'https://example.com/signin'
`);

  assert.deepEqual(auth, {
    login_url: 'https://example.com/signin',
    verify: null,
  });
});

test('normalizeDomain removes www prefix and lowercases', () => {
  assert.equal(normalizeDomain('WWW.Example.COM'), 'example.com');
});

test('extractDomain normalizes URL hostnames', () => {
  assert.equal(extractDomain('https://www.example.com/path?q=1'), 'example.com');
  assert.equal(extractDomain('not a url'), '');
});

test('buildVerifyResult identifies site-specific verification correctly', () => {
  const result = buildVerifyResult('www.example.com', 'verified', ['not_login_url', 'site_selector_found']);

  assert.equal(result.domain, 'example.com');
  assert.equal(result.verification_method, 'site_specific');
  assert.equal(result.sensitive_values_printed, false);
});
