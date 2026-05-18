import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

test('documented top-level runtime references exist', () => {
  const required = [
    'SKILL.md',
    'README.md',
    'references/search-guide.md',
    'references/subagent-guide.md',
    'references/tool-guide.md',
    'references/content-extraction.md',
    'references/tool-boundary.md',
    'references/decision-kernel.md',
    'docs/browser-auth-and-channel-intelligence-plan.md',
    'scripts/check-deps.mjs',
    'scripts/sleuth-browser.mjs',
    'scripts/session-logger.mjs',
    'scripts/deliver.mjs',
    'scripts/research-index.mjs',
    'scripts/find-url.mjs',
  ];

  for (const file of required) {
    assert.equal(exists(file), true, `${file} should exist`);
  }
});

test('SKILL references core decision guides', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /references\/tool-boundary\.md/);
  assert.match(skill, /references\/decision-kernel\.md/);
  assert.match(skill, /references\/search-guide\.md/);
});

test('Node runtime requirement is aligned with native WebSocket usage', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=22');
});

test('docs and tests are not ignored', () => {
  const gitignore = read('.gitignore');
  assert.equal(/^docs\/$/m.test(gitignore), false);
  assert.equal(/^tests\/$/m.test(gitignore), false);
});
