#!/usr/bin/env node
/**
 * check-deps.mjs — sleuth 环境检查 CLI 入口
 *
 * 薄 CLI shim：解析命令行参数，无条件调用 main()。
 * 所有逻辑在 lib/check-deps-core.mjs 中。
 *
 * 用法（文档规定标志）：
 *   node check-deps.mjs                     # 完整检查 + 确保 CDP
 *   node check-deps.mjs --output-dir        # 仅输出目录路径
 *   node check-deps.mjs --check-only        # 非破坏性诊断（不启动浏览器）
 *   node check-deps.mjs --ensure-cdp        # 查找或启动 managed browser
 *   node check-deps.mjs --login-url <url>   # 启动后打开指定 URL（登录引导）
 *   node check-deps.mjs --auth-required     # 如登录未验证则提示
 *   node check-deps.mjs --json              # 输出机器可读 JSON
 *   node check-deps.mjs --sid <id>          # 指定 session ID
 *
 * 编程调用：
 *   import { main, ensureCDP, detectCDPPort } from './lib/check-deps-core.mjs';
 */

import { main } from './lib/check-deps-core.mjs';

// ── 解析命令行参数 ──────────────────────────────────────────────────

const KNOWN_FLAGS = ['--output-dir', '--check-only', '--ensure-cdp', '--login-url', '--auth-required', '--real-browser', '--domain', '--cdp-port', '--json', '--sid', '--help'];

// --help 或未知 flag → 打印用法并退出
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`用法: node check-deps.mjs [选项]

选项:
  --check-only        非破坏性诊断（不启动浏览器、不写文件）
  --ensure-cdp        查找或启动 managed browser
  --login-url <url>   启动后打开指定 URL（登录引导）
  --auth-required [url] 验证登录态（可传 URL 或配合 --login-url 使用）
  --real-browser      使用用户现有 Chrome（需以 --remote-debugging-port 启动）
  --domain <domain>   限制 real-browser 操作范围到指定域名
  --cdp-port <port>   显式指定 real-browser 使用的 CDP 端口
  --output-dir        仅输出目录路径
  --json              输出机器可读 JSON
  --sid <id>          指定 session ID
  --help, -h          显示此帮助`);
  process.exit(0);
}

const VALUE_FLAGS = ['--login-url', '--sid', '--auth-required', '--domain', '--cdp-port'];  // 这些 flag 后面跟值
const unknownFlags = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const name = a.split('=')[0];
    if (!KNOWN_FLAGS.includes(name)) { unknownFlags.push(a); }
    else if (VALUE_FLAGS.includes(name) && !a.includes('=')) { i++; }  // 跳过值
  } else if (a.startsWith('-') && a !== '-h') {
    unknownFlags.push(a);
  }
  // 非 flag 参数（已被 VALUE_FLAGS 跳过）不检查
}
if (unknownFlags.length > 0) {
  console.error(`未知选项: ${unknownFlags.join(', ')}\n运行 --help 查看可用选项`);
  process.exit(1);
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  // 如果下一个参数是另一个 flag 或不存在，返回 true（布尔标志）
  if (!next || next.startsWith('--')) return true;
  return next;
}

const options = {
  outputDirOnly: process.argv.includes('--output-dir'),
  checkOnly: process.argv.includes('--check-only'),
  ensureCdp: process.argv.includes('--ensure-cdp'),
  loginUrl: typeof getArg('--login-url') === 'string' ? getArg('--login-url') : undefined,
  authRequired: getArg('--auth-required') || false,
  realBrowser: process.argv.includes('--real-browser'),
  domain: typeof getArg('--domain') === 'string' ? getArg('--domain') : undefined,
  cdpPort: typeof getArg('--cdp-port') === 'string' ? getArg('--cdp-port') : undefined,
  json: process.argv.includes('--json'),
  sid: typeof getArg('--sid') === 'string' ? getArg('--sid') : undefined,
};

// ── 执行 ──────────────────────────────────────────────────────────

main(options).catch((err) => {
  console.error('check-deps error:', err.message);
  process.exit(1);
});
