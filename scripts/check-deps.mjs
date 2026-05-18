#!/usr/bin/env node
/**
 * check-deps.mjs — sleuth 环境检查 CLI 入口
 *
 * 薄 CLI shim：只负责参数解析，核心逻辑在 lib/check-deps-core.mjs。
 */

import { main } from './lib/check-deps-core.mjs';

const HELP = `用法: node check-deps.mjs [选项]

选项:
  --check-only              非破坏性诊断（不启动浏览器、不写运行目录）
  --ensure-cdp              查找或启动 managed browser
  --login-url <url>         启动后打开指定 URL（登录引导）
  --auth-required [url]     验证登录态（可传 URL 或配合 --login-url 使用）
  --real-browser            使用用户现有 Chrome（显式 opt-in）
  --domain <domain>         限制 real-browser 操作范围到指定域名
  --cdp-port <port>         显式指定 real-browser 使用的 CDP 端口
  --output-dir              仅输出目录路径
  --json                    输出机器可读 JSON
  --sid <id>                指定 session ID
  --help, -h                显示此帮助`;

const KNOWN_FLAGS = new Set([
  '--output-dir', '--check-only', '--ensure-cdp', '--login-url', '--auth-required',
  '--real-browser', '--domain', '--cdp-port', '--json', '--sid', '--help', '-h',
]);

const VALUE_FLAGS = new Set(['--login-url', '--sid', '--auth-required', '--domain', '--cdp-port']);

function parseArgv(argv) {
  const values = {};
  const booleans = new Set();
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('-')) continue;

    const [flag, inlineValue] = raw.split(/=(.*)/s).filter(v => v !== undefined);
    if (!KNOWN_FLAGS.has(flag)) {
      unknown.push(raw);
      continue;
    }

    if (flag === '--help' || flag === '-h') {
      booleans.add('help');
      continue;
    }

    const key = flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    if (VALUE_FLAGS.has(flag)) {
      if (inlineValue !== undefined && inlineValue !== '') {
        values[key] = inlineValue;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          values[key] = next;
          i++;
        } else {
          values[key] = true;
        }
      }
    } else {
      booleans.add(key);
    }
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
  outputDirOnly: booleans.has('outputDir'),
  checkOnly: booleans.has('checkOnly'),
  ensureCdp: booleans.has('ensureCdp'),
  loginUrl: typeof values.loginUrl === 'string' ? values.loginUrl : undefined,
  authRequired: values.authRequired || false,
  realBrowser: booleans.has('realBrowser'),
  domain: typeof values.domain === 'string' ? values.domain : undefined,
  cdpPort: typeof values.cdpPort === 'string' ? values.cdpPort : undefined,
  json: booleans.has('json'),
  sid: typeof values.sid === 'string' ? values.sid : undefined,
};

main(options).catch((err) => {
  console.error('check-deps error:', err.message);
  process.exit(1);
});
