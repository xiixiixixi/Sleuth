#!/usr/bin/env node
/**
 * sleuth-browser.mjs — sleuth 专用浏览器管理 CLI
 *
 * 管理独立于用户日常 Chrome 的 managed browser。
 */

import {
  ensureCDP,
  launchManagedBrowser,
  getBrowserStatus,
  stopManagedBrowser,
  CDP_PROFILE_DIR,
} from './lib/check-deps-core.mjs';

const command = process.argv[2] || 'status';
const args = process.argv.slice(3);

function getValue(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function printHelp() {
  console.log(`用法: node scripts/sleuth-browser.mjs <command> [options]

命令:
  status                 查看 managed browser 状态
  ensure                 确保 managed browser 可用
  open-login [--url URL] 打开/复用 managed browser，并可选打开登录 URL
  stop                   停止 managed browser

选项:
  --url <url>            open-login 时打开指定 URL
  --help, -h             显示帮助`);
}

async function openUrlIfNeeded(port, url) {
  if (!url) return;
  try {
    await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    console.error(`Warning: failed to open URL in managed browser: ${url}`);
  }
}

async function run() {
  if (command === '--help' || command === '-h' || hasFlag('help')) {
    printHelp();
    return;
  }

  switch (command) {
    case 'status': {
      const status = await getBrowserStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'ensure': {
      const result = await ensureCDP();
      console.log(JSON.stringify(result, null, 2));
      if (!result.cdp_port) {
        console.error('\n首次使用提示：运行 node scripts/sleuth-browser.mjs open-login，在弹出的 Chrome 窗口中登录目标站点。');
        process.exit(1);
      }
      break;
    }

    case 'open-login': {
      const loginUrl = getValue('url');
      console.log('正在打开或复用 sleuth managed browser...');
      console.log(`profile 目录: ${CDP_PROFILE_DIR}`);
      console.log('');

      const existing = await getBrowserStatus();
      const result = existing.ready
        ? { ready: true, port: existing.port, pid: existing.pid, reused: true }
        : await launchManagedBrowser();

      if (!result.ready) {
        console.error('启动失败。请检查 Chrome 是否已安装。');
        process.exit(1);
      }

      await openUrlIfNeeded(result.port, loginUrl);

      console.log(result.reused ? `浏览器已在运行（port ${result.port}）。` : `浏览器已启动（port ${result.port}）。`);
      console.log('请在弹出的 Chrome 窗口中登录你需要使用的站点。');
      console.log('登录完成后，登录态将持久保存在 managed profile 中。');
      console.log(`SLEUTH_CDP_PORT=${result.port}`);
      break;
    }

    case 'stop': {
      stopManagedBrowser();
      console.log('sleuth managed browser 已停止。');
      break;
    }

    default:
      console.error(`未知命令: ${command}`);
      printHelp();
      process.exit(1);
  }
}

run().catch((err) => {
  console.error('sleuth-browser error:', err.message);
  process.exit(1);
});
