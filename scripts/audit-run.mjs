#!/usr/bin/env node
/** audit-run.mjs — 对指定研究目录执行可重复的流程验收。 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const taskDir = args.find((arg) => !arg.startsWith('--'));
const stageIndex = args.indexOf('--stage');
const stage = stageIndex >= 0 ? args[stageIndex + 1] : 'all';
const allowed = new Set(['raw', 'research', 'draft', 'final', 'all']);

if (!taskDir || !allowed.has(stage) || args.includes('--help') || args.includes('-h')) {
  console.log('用法：node scripts/audit-run.mjs <task-dir> [--stage raw|research|draft|final|all]');
  process.exit(taskDir && allowed.has(stage) ? 0 : 2);
}

const dir = taskDir.replace(/^~/, process.env.HOME || '');
const steps = {
  raw: [
    ['validate-state.mjs', dir, '--phase', '3-raw'],
    ['normalize.mjs', dir],
    ['check-depth.mjs', dir],
    ['validate-state.mjs', dir, '--phase', '3-findings'],
    ['calc-novelty.mjs', dir],
  ],
  research: [
    ['validate-state.mjs', dir, '--phase', '3-findings'],
    ['calc-novelty.mjs', dir],
    ['validate-state.mjs', dir, '--phase', '4'],
    ['validate-state.mjs', dir, '--phase', '7-ready'],
  ],
  draft: [['validate-state.mjs', dir, '--phase', '7-draft']],
  final: [['validate-state.mjs', dir, '--phase', '8-audit']],
};

let selected;
if (stage === 'all') {
  const requiredArtifacts = ['boundary-report.json', 'draft.md', 'audit-report.json'];
  const missingArtifacts = requiredArtifacts.filter((file) => !fs.existsSync(path.join(dir, file)));
  if (missingArtifacts.length) {
    console.error(`✗ 完整验收缺少必须产物：${missingArtifacts.join(', ')}`);
    process.exit(1);
  }
  selected = [...steps.raw, ...steps.research, ...steps.draft, ...steps.final];
} else selected = steps[stage];

for (const [script, ...scriptArgs] of selected) {
  console.log(`\n▶ ${script} ${scriptArgs.slice(1).join(' ')}`);
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...scriptArgs], { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error(`✗ 验收停止：${script} 返回 ${result.status}`);
    process.exit(result.status || 1);
  }
}
if (stage === 'all') console.log('\n✓ 完整验收通过：raw、research、draft、final 全部通过');
else console.log('\n✓ 所选阶段全部通过');
