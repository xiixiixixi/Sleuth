#!/usr/bin/env node
/**
 * check-deps.mjs — sleuth 环境检查 CLI 入口
 *
 * 薄 CLI shim：只负责参数解析，核心逻辑在 lib/check-deps-core.mjs。
 */

import { main } from './lib/check-deps-core.mjs';

const HELP = `用法: node check-deps.mjs [选项]

选项:
  --check-only              非破坏性诊断（不写运行目录）
  --output-dir              仅输出目录路径
  --json                    输出机器可读 JSON
  --help, -h                显示此帮助`;

const KNOWN_FLAGS = new Set([
  '--output-dir', '--check-only', '--json', '--help', '-h',
]);

function parseArgv(argv) {
  const values = {};
  const booleans = new Set();
  const unknown = [];

  for (const raw of argv) {
    if (!raw.startsWith('-')) continue;
    if (!KNOWN_FLAGS.has(raw)) {
      unknown.push(raw);
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      booleans.add('help');
      continue;
    }
    booleans.add(raw.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
  }

  return { values, booleans, unknown };
}

const { booleans, unknown } = parseArgv(process.argv.slice(2));

if (booleans.has('help')) {
  console.log(HELP);
  process.exit(0);
}

if (unknown.length > 0) {
  console.error(`未知选项: ${unknown.join(', ')}\n运行 --help 查看可用选项`);
  process.exit(1);
}

const options = {
  outputDirOnly: booleans.has('outputDir'),
  checkOnly: booleans.has('checkOnly'),
  json: booleans.has('json'),
};

main(options).catch((err) => {
  console.error('check-deps error:', err.message);
  process.exit(1);
});
