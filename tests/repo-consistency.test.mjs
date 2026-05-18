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

function collectMarkdownFiles(dir, base = dir, result = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (['.git', 'node_modules', '.sisyphus'].includes(entry)) continue;
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) collectMarkdownFiles(full, base, result);
    else if (st.isFile() && entry.endsWith('.md')) result.push(path.relative(base, full));
  }
  return result.sort();
}

test('only the two runtime markdown guides are required', () => {
  const required = [
    'SKILL.md',
    'SUBAGENT.md',
    'scripts/check-deps.mjs',
    'scripts/sleuth-browser.mjs',
    'scripts/on-stop.mjs',
    'scripts/session-logger.mjs',
    'scripts/deliver.mjs',
    'scripts/research-index.mjs',
    'scripts/find-url.mjs',
  ];

  for (const file of required) {
    assert.equal(exists(file), true, `${file} should exist`);
  }
});

test('runtime markdown surface is limited to SKILL and SUBAGENT', () => {
  assert.deepEqual(collectMarkdownFiles(root), ['SKILL.md', 'SUBAGENT.md']);
});

test('SKILL contains the search philosophy directly', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /搜索不是找链接/);
  assert.match(skill, /工具选择原则/);
  assert.match(skill, /Session 与输出规则/);
  assert.match(skill, /SUBAGENT\.md/);
});

test('SUBAGENT contains the child agent contract directly', () => {
  const subagent = read('SUBAGENT.md');
  assert.match(subagent, /Subagent Contract/);
  assert.match(subagent, /findings/);
  assert.match(subagent, /sources/);
  assert.match(subagent, /artifacts/);
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

test('on-stop does not globally clean agent-browser unless explicitly requested', () => {
  const script = read('scripts/on-stop.mjs');
  assert.match(script, /const CLEANUP_AGENT_BROWSER = hasFlag\('cleanup-agent-browser'\)/);
  assert.match(script, /if \(!CLEANUP_AGENT_BROWSER\) return/);
  assert.doesNotMatch(script, /cleanupAgentBrowser\(\);\s*$/m);
});

test('sleuth-browser open-login reuses existing managed browser before launch', () => {
  const script = read('scripts/sleuth-browser.mjs');
  assert.match(script, /const existing = await getBrowserStatus\(\)/);
  assert.match(script, /existing\.ready/);
  assert.match(script, /await launchManagedBrowser\(\)/);
});

test('check-deps supports query and agent-scoped output', () => {
  const script = read('scripts/check-deps.mjs');
  assert.match(script, /--query <text>/);
  assert.match(script, /--agent <name>/);
});

test('deliver supports agent-scoped final delivery', () => {
  const script = read('scripts/deliver.mjs');
  assert.match(script, /--agent <name>/);
  assert.match(script, /--final/);
  assert.match(script, /copyFinalToCwd/);
});
