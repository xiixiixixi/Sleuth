/** spawn-subagent.mjs 的角色契约测试。 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../spawn-subagent.mjs', import.meta.url));
const TASK = '/tmp/sleuth-task';
const SEARCH_ARGS = ['--role', 'search', '--goal', '验证定价', '--task-dir', TASK, '--agent-name', 'pricing', '--round', '2', '--subquestion-id', '1'];

function run(args, env = {}) {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('search prompt 绑定任务、轮次、唯一文件和子问题', () => {
  const prompt = run(SEARCH_ARGS);
  assert.match(prompt, /Round 2/);
  assert.match(prompt, /search-r2-pricing\.jsonl/);
  assert.match(prompt, /【负责的子问题】\s*- 1/);
  assert.match(prompt, /directions\.json/);
});

test('search prompt 强制新证据 schema 与多来源', () => {
  const prompt = run(SEARCH_ARGS);
  for (const field of ['claim_key', 'subquestion_ids', 'fields_covered', 'sources', 'observed_at', 'context_links', 'source_claim_keys', 'visuals', 'image_url', 'source_page_url', 'visual_scan']) {
    assert.match(prompt, new RegExp(field));
  }
  assert.match(prompt, /多个独立来源放在同一条 finding/);
  assert.match(prompt, /visual_scan\.pages.*覆盖每个 finding 的每个来源 URL/);
  assert.match(prompt, /red_flag.*sources/);
  assert.match(prompt, /禁止只把 URL 塞进 reason/);
  assert.match(prompt, /lines_written.*不包含 `agent_done` 本身/);
});

test('search prompt 注入 must-verify、known-clue、deliverable 和 stop', () => {
  const prompt = run([...SEARCH_ARGS, '--must-verify', '价格数字', '--known-clue', '参照结论', '--deliverable', '对比表', '--stop-criteria', '两个独立源']);
  for (const text of ['价格数字', '参照结论', '对比表', '两个独立源']) assert.match(prompt, new RegExp(text));
});

test('search prompt 有浏览器端口时使用字面值', () => {
  const prompt = run(SEARCH_ARGS, { SLEUTH_CDP_PORT: '9222' });
  assert.match(prompt, /--cdp 9222/);
  assert.match(prompt, /agent-browser --cdp 9222 --idle-timeout 1h/);
  assert.doesNotMatch(prompt, /--cdp \$SLEUTH_CDP_PORT/);
  assert.match(prompt, /用户现有的登录态 Chrome/);
  assert.match(prompt, /独占浏览器操作权/);
  assert.match(prompt, /tab new --label pricing/);
  assert.match(prompt, /不要依赖 `--session` 隔离/);
  assert.match(prompt, /禁止使用 `--session` 或 `--namespace`/);
  assert.match(prompt, /禁止启动或复用其他常驻 CDP 代理/);
  assert.match(prompt, /禁止裸跑 `agent-browser open`/);
});

test('search prompt 没有浏览器端口时及时交回主 Agent', () => {
  const prompt = run(SEARCH_ARGS, { SLEUTH_CDP_PORT: '' });
  assert.match(prompt, /BROWSER_CONTROL_REQUIRED/);
  assert.match(prompt, /保留已经写入的 raw，不写 `agent_done`/);
  assert.match(prompt, /唯一例外是浏览器控制未就绪/);
  assert.match(prompt, /现有登录态 Chrome/);
  assert.match(prompt, /只允许一次有实质变化的查询改写/);
  assert.match(prompt, /不对同一 URL 做 2s \/ 5s \/ 10s 定时重试/);
  assert.doesNotMatch(prompt, /WebFetch 单 URL 重试上限：3 次/);
});

test('search prompt 不会误关用户原有标签页', () => {
  const prompt = run(SEARCH_ARGS, { SLEUTH_CDP_PORT: '9222' });
  assert.match(prompt, /绝不使用 `close --all`/);
  assert.match(prompt, /绝不关闭用户原有标签页/);
});

test('visual-required 形成独立硬要求', () => {
  const prompt = run([...SEARCH_ARGS, '--visual-required']);
  assert.match(prompt, /视觉证据——本任务必需/);
  assert.match(prompt, /至少保存 1 张/);
  assert.match(prompt, /原图或页面截图/);
  assert.match(prompt, /visuals\[\]/);
});

test('默认搜索也会逐页扫描有用图片', () => {
  const prompt = run(SEARCH_ARGS);
  assert.match(prompt, /每个被采用的一手页面都要检查图片候选/);
  assert.match(prompt, /纯装饰图、头像、logo 和广告不要记录/);
});

test('search 缺关键绑定参数会拒绝生成', () => {
  for (const args of [
    ['--role', 'search', '--goal', 'x'],
    ['--role', 'search', '--goal', 'x', '--task-dir', TASK, '--round', '1', '--subquestion-id', '1'],
    ['--role', 'search', '--goal', 'x', '--task-dir', TASK, '--agent-name', 'a', '--subquestion-id', '1'],
    ['--role', 'search', '--goal', 'x', '--task-dir', TASK, '--agent-name', 'a', '--round', '1'],
  ]) assert.equal(spawnSync('node', [SCRIPT, ...args]).status, 2);
});

test('boundary 直接写 JSON 报告并负责跨 Agent 线索', () => {
  const prompt = run(['--role', 'boundary', '--goal', '评估覆盖度', '--task-dir', TASK]);
  assert.match(prompt, /boundary-report\.json/);
  assert.match(prompt, /JSON schema/);
  assert.match(prompt, /cross_agent_hints/);
  assert.match(prompt, /3-5 条线索/);
  assert.doesNotMatch(prompt, /YAML schema/);
});

test('review 直接写 JSON 审计报告', () => {
  const prompt = run(['--role', 'review', '--goal', '审计', '--task-dir', TASK, '--draft-path', `${TASK}/draft.md`]);
  assert.match(prompt, /audit-report\.json/);
  assert.match(prompt, /critical、non_critical、sampled_stats、passed/);
  assert.match(prompt, /visual_audit/);
  assert.doesNotMatch(prompt, /YAML schema/);
});

test('synthesize 从 stats 取数字，只写 draft', () => {
  const prompt = run(['--role', 'synthesize', '--task-dir', TASK]);
  assert.match(prompt, /stats-summary\.json/);
  assert.match(prompt, /draft\.md/);
  assert.match(prompt, /没有证据的实体只能写数据缺口/);
  assert.match(prompt, /PRD/);
  assert.match(prompt, /finding\.visuals\[\]/);
  assert.match(prompt, /禁止静默略过/);
});

test('synthesize 接收审计修复意见', () => {
  const prompt = run(['--role', 'synthesize', '--task-dir', TASK, '--audit-fix', '补充冲突说明']);
  assert.match(prompt, /补充冲突说明/);
});

test('scout 直接写 landscape.json', () => {
  const prompt = run(['--role', 'scout', '--goal', '摸清领域', '--task-dir', TASK]);
  assert.match(prompt, new RegExp(`${TASK}/landscape\\.json`));
  assert.match(prompt, /至少 3 个实体/);
  assert.match(prompt, /不使用 agent-browser/);
});

test('各角色缺必填参数会失败', () => {
  assert.equal(spawnSync('node', [SCRIPT, '--role', 'scout', '--goal', 'x']).status, 2);
  assert.equal(spawnSync('node', [SCRIPT, '--role', 'boundary', '--goal', 'x']).status, 2);
  assert.equal(spawnSync('node', [SCRIPT, '--role', 'review', '--goal', 'x', '--task-dir', TASK]).status, 2);
  assert.equal(spawnSync('node', [SCRIPT, '--role', 'synthesize']).status, 2);
});

test('所有角色 prompt 不含已废弃系统', () => {
  const prompts = [
    run(SEARCH_ARGS),
    run(['--role', 'scout', '--goal', 'x', '--task-dir', TASK]),
    run(['--role', 'boundary', '--goal', 'x', '--task-dir', TASK]),
    run(['--role', 'review', '--goal', 'x', '--task-dir', TASK, '--draft-path', `${TASK}/draft.md`]),
    run(['--role', 'synthesize', '--task-dir', TASK]),
  ].join('\n');
  assert.doesNotMatch(prompts, /session-logger|--sid|--main-sid|subagent_done|deliver\.mjs/);
});

test('非法角色与 help 行为正确', () => {
  assert.equal(spawnSync('node', [SCRIPT, '--role', 'invalid']).status, 2);
  const help = run(['--help']);
  assert.match(help, /subquestion-id/);
  assert.match(help, /scout\|search\|boundary\|review\|synthesize/);
});
