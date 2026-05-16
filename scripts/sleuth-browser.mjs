#!/usr/bin/env node
/**
 * sleuth-browser.mjs — sleuth 专用浏览器管理 CLI
 *
 * 管理一个独立于用户日常 Chrome 的持久浏览器实例。
 * 用户在此浏览器中登录一次目标站点，登录态永久保存在专用 profile 中。
 *
 * 核心原则：
 *   - 永不触碰用户日常 Chrome（不关闭、不复制、不修改）
 *   - 登录态持久化 — 用户只需首次手动登录
 *   - 幂等操作 — 多次调用不会重复启动
 *   - 与用户 Chrome 完全隔离（独立 port、独立 user-data-dir）
 *   - CDP 检测使用协议验证（/json/version），不仅靠 TCP
 *
 * 数据目录：
 *   ~/.sleuth/cdp-profile/    Chrome user-data-dir（登录态、Cookies 等）
 *   ~/.sleuth/cdp-state.json  运行状态（pid、port、启动时间）
 */

import {
  ensureCDP,
  launchManagedBrowser,
  getBrowserStatus,
  stopManagedBrowser,
  CDP_PROFILE_DIR,
} from './lib/check-deps-core.mjs';

// ── 子命令处理 ────────────────────────────────────────────────────

const command = process.argv[2] || 'status';

async function run() {
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
        console.error('\n首次使用提示：');
        console.error('  1. 运行 node scripts/sleuth-browser.mjs open-login');
        console.error('  2. 在弹出的 Chrome 窗口中登录目标站点');
        console.error('  3. 登录完成后，登录态将持久保存');
        process.exit(1);
      }
      break;
    }

    case 'open-login': {
      console.log('正在打开 sleuth managed browser...');
      console.log(`profile 目录: ${CDP_PROFILE_DIR}`);
      console.log('');
      console.log('请在弹出的 Chrome 窗口中登录以下站点：');
      console.log('  - 小红书 (xiaohongshu.com)');
      console.log('  - 微博 (weibo.com)');
      console.log('  - 知乎 (zhihu.com)');
      console.log('  - 即刻 (okjike.com)');
      console.log('  - 以及其他需要登录态的站点');
      console.log('');
      console.log('登录完成后，登录态将持久保存在 managed profile 中。');
      console.log('之后每次使用 sleuth 都会自动复用这些登录态。');
      console.log('');

      const result = await launchManagedBrowser();
      if (result.ready) {
        console.log(`浏览器已启动（port ${result.port}）。登录完成后可关闭窗口。`);
        console.log(`SLEUTH_CDP_PORT=${result.port}`);
      } else {
        console.error('启动失败。请检查 Chrome 是否已安装。');
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      stopManagedBrowser();
      console.log('sleuth managed browser 已停止。');
      break;
    }

    default:
      console.error(`未知命令: ${command}`);
      console.error('可用命令: status, ensure, open-login, stop');
      process.exit(1);
  }
}

run().catch((err) => {
  console.error('sleuth-browser error:', err.message);
  process.exit(1);
});
