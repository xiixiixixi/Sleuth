#!/usr/bin/env node
/**
 * check-deps.mjs — sleuth 环境检查 CLI 入口
 *
 * 薄 CLI shim：只负责参数解析，核心逻辑在 lib/check-deps-core.mjs。
 */

import { main } from './lib/check-deps-core.mjs';

const HELP = `用法: node check-deps.mjs [选项]

选项:
  --check-only              非破坏性诊断（不写运行目录、不自动安装 CLI）
  --mode <light|full>       light 只检查基础研究；full 自动补齐 CLI 并要求用户 Chrome 可连接
  --task-name <name>        按任务名创建/解析输出目录（多 Agent 协作需独立目录）
  --json                    输出机器可读 JSON
  --help, -h                显示此帮助

task-name 允许字符：字母/数字/-/_/.（拒路径分隔符）
示例：
  node check-deps.mjs --task-name openai-2026-06-19 --check-only`;

const KNOWN_FLAGS = new Set([
  '--check-only', '--json', '--help', '-h',
]);

const VALUE_FLAGS = new Set([
  '--task-name', '--mode',
]);

function parseArgv(argv) {
  const values = {};
  const booleans = new Set();
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('-')) continue;
    if (!KNOWN_FLAGS.has(raw) && !VALUE_FLAGS.has(raw)) {
      unknown.push(raw);
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      booleans.add('help');
      continue;
    }
    if (VALUE_FLAGS.has(raw)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        console.error(`Error: ${raw} 需要一个值`);
        process.exit(2);
      }
      const key = raw.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      values[key] = value;
      i++; // skip value
      continue;
    }
    booleans.add(raw.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
  }

  return { values, booleans, unknown };
}

const { values, booleans, unknown } = parseArgv(process.argv.slice(2));

if (booleans.has('help')) {
  console.log(HELP);
  process.exit(0);
}

if (unknown.length > 0) {
  console.error(`未知选项: ${unknown.join(', ')}\n运行 --help 查看可用选项`);
  process.exit(1);
}

const options = {
  checkOnly: booleans.has('checkOnly'),
  json: booleans.has('json'),
  taskName: values.taskName,
  mode: values.mode || 'light',
};

if (!['light', 'full'].includes(options.mode)) {
  console.error('--mode 只允许 light 或 full');
  process.exit(2);
}

main(options).catch((err) => {
  console.error('check-deps error:', err.message);
  process.exit(1);
});
