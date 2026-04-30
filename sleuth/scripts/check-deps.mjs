#!/usr/bin/env node
/**
 * check-deps.mjs — sleuth 环境检查与自动修复
 *
 * 在开始调研前运行，确保所有依赖就绪。发现问题时自动尝试修复。
 *
 * 检查项：
 *   1. agent-browser 是否安装且可用
 *   2. Chrome CDP 远程调试是否可用（如不可用，自动重启 Chrome 开启 CDP）
 *   3. 输出目录自动创建到 ~/.sleuth/output/
 *   4. 过期输出自动清理（调用 cleanup-output.mjs，保留 7 天）
 *   5. 站点经验文件列表展示
 *   6. 可选依赖检查（sqlite3、yt-dlp、python3）
 *
 * Chrome CDP 自动重启逻辑：
 *   Chrome 147+ 要求非默认 --user-data-dir 才能开启远程调试。
 *   本脚本会：
 *     1. 检测 CDP 端口（DevToolsActivePort 文件 + 常用端口探测）
 *     2. 如不可用，自动关闭 Chrome → 创建 ~/.sleuth/chrome-debug/ →
 *        以 --remote-debugging-port=9222 重启（Default profile 软链接保留登录态）
 *
 * 用法：
 *   node check-deps.mjs                 # 完整环境检查
 *   node check-deps.mjs --output-dir    # 仅输出目录路径
 *   node check-deps.mjs --sid <id>      # 指定 session ID
 *
 * 也可被其他脚本 import 后编程调用：
 *   import { main, checkAgentBrowser, detectChromePort } from './check-deps.mjs';
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOutputDir, ensureOutputDir } from './lib/output.mjs';

// 项目根目录
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 站点经验文件目录
const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// ── TCP 端口探测 ──────────────────────────────────────────────────

/**
 * 检测指定 TCP 端口是否有服务在监听。
 * 通过尝试建立 TCP 连接来判断，超时则认为端口不可用。
 *
 * @param {number} port - 端口号
 * @param {string} host - 主机地址，默认 127.0.0.1
 * @param {number} timeoutMs - 超时毫秒数，默认 2000
 * @returns {Promise<boolean>} 端口是否在监听
 */
function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// ── Chrome 调试端口检测 ────────────────────────────────────────────

/**
 * 返回各平台上 Chrome DevToolsActivePort 文件的可能路径。
 * Chrome 开启 CDP 后会写入此文件，第一行是端口号。
 *
 * @returns {string[]} 文件路径列表（按优先级排列）
 */
function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return [
        // sleuth 自己创建的 CDP profile（最高优先级）
        path.join(home, '.sleuth', 'chrome-debug', 'DevToolsActivePort'),
        // 标准 Chrome 安装位置
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
      ];
    case 'linux':
      return [
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
        path.join(home, '.config/chromium/DevToolsActivePort'),
      ];
    case 'win32':
      return [
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
      ];
    default:
      return [];
  }
}

/**
 * 自动检测 Chrome CDP 调试端口。
 *
 * 检测策略（按优先级）：
 *   1. 读取 DevToolsActivePort 文件（各平台标准位置）
 *   2. 回退探测常用端口（9222、9229、9333）
 *
 * @returns {Promise<number|null>} 端口号，或 null 表示不可用
 */
async function detectChromePort() {
  // 策略 1：读取 DevToolsActivePort 文件
  const portFileChecks = activePortFiles().map(async (filePath) => {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      // 验证端口号合法且端口确实在监听
      if (port > 0 && port < 65536 && await checkPort(port)) {
        return port;
      }
    } catch (_) {}
    return null;
  });

  for (const result of await Promise.all(portFileChecks)) {
    if (result !== null) return result;
  }

  // 策略 2：探测常用端口
  const fallbackPorts = [9222, 9229, 9333];
  const fallbackChecks = await Promise.all(
    fallbackPorts.map(async (port) => {
      const ok = await checkPort(port);
      return ok ? port : null;
    })
  );

  for (const port of fallbackChecks) {
    if (port !== null) return port;
  }

  return null;
}

// ── agent-browser 检查 ─────────────────────────────────────────────

/**
 * 检测 agent-browser 是否已安装。
 * 通过执行 `agent-browser --version` 验证。
 *
 * @returns {{status: string, version: string|null}} 状态和版本号
 */
function checkAgentBrowser() {
  try {
    const version = execSync('agent-browser --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
    const match = version.match(/(\d+\.\d+\.\d+)/);
    const ver = match ? `v${match[1]}` : version;
    return { status: 'ok', version: ver };
  } catch {
    return { status: 'not-found', version: null };
  }
}

// ── Chrome CDP 自动重启 ────────────────────────────────────────────

/**
 * 查找 Chrome 二进制文件的路径（跨平台）。
 *
 * @returns {string|null} Chrome 可执行文件路径，或 null
 */
function findChromeBinary() {
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
    ],
    win32: [
      `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
  };
  for (const p of candidates[os.platform()] || []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 获取默认 Chrome profile 目录路径（跨平台）。
 * 用于创建 CDP 调试 profile 时的软链接源。
 */
function getDefaultChromeProfile() {
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin': return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    case 'linux': return path.join(home, '.config', 'google-chrome');
    case 'win32': return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
    default: return null;
  }
}

/** 检测 Chrome 进程是否正在运行 */
function isChromeRunning() {
  try {
    const cmd = os.platform() === 'win32'
      ? 'tasklist /FI "IMAGENAME eq chrome.exe" /NH'
      : 'pgrep -x "Google Chrome" || pgrep -x "chrome" || pgrep -x "chromium"';
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** Promise 版的 sleep */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 自动重启 Chrome 并开启 CDP 远程调试。
 *
 * 流程：
 *   1. 查找 Chrome 二进制文件
 *   2. 如果 Chrome 正在运行 → 优雅关闭（macOS 用 osascript，其他平台用 pkill）
 *   3. 创建 ~/.sleuth/chrome-debug/ 目录
 *   4. 将用户真实 Chrome profile 的 Default 目录软链接到 chrome-debug/Default
 *      （保留登录态、书签、Cookie 等用户数据）
 *   5. 以 --remote-debugging-port=9222 --user-data-dir=<chrome-debug> 启动 Chrome
 *   6. 轮询等待 CDP 端口就绪（最多 10 秒）
 *
 * @param {number} port - CDP 端口号，默认 9222
 * @returns {Promise<boolean>} 是否成功启动
 */
async function restartChromeWithCDP(port = 9222) {
  const binary = findChromeBinary();
  if (!binary) {
    console.error('chrome: 未找到 Chrome 二进制文件');
    return false;
  }

  // 如果 Chrome 正在运行，先优雅关闭
  const running = isChromeRunning();
  if (running) {
    console.log('chrome: 正在关闭 Chrome...');
    try {
      if (os.platform() === 'darwin') {
        // macOS: 用 AppleScript 优雅退出（会保存标签页等）
        execSync('osascript -e \'tell application "Google Chrome" to quit\'', { timeout: 10000 });
      } else {
        // Linux/Windows: 发信号关闭
        execSync('pkill -x "Google Chrome" 2>/dev/null || pkill -x "chrome" 2>/dev/null || pkill -x "chromium" 2>/dev/null', { timeout: 10000 });
      }
    } catch { /* 强制关闭的兜底 */ }
    // 等待 Chrome 进程完全退出（最多 7.5 秒）
    for (let i = 0; i < 15; i++) {
      if (!isChromeRunning()) break;
      await sleep(500);
    }
    if (isChromeRunning()) {
      console.error('chrome: Chrome 未能正常关闭，请手动退出后重试');
      return false;
    }
    await sleep(1000); // 额外等待 1 秒确保端口释放
  }

  // Chrome 147+ 要求非默认 --user-data-dir 才能开启 CDP
  // 创建独立的调试 profile 目录
  const debugDir = path.join(os.homedir(), '.sleuth', 'chrome-debug');
  const defaultProfile = getDefaultChromeProfile();
  fs.mkdirSync(debugDir, { recursive: true });

  // 软链接用户真实的 Default profile（保留登录态、Cookie、书签等）
  if (defaultProfile) {
    const linkPath = path.join(debugDir, 'Default');
    const realDefault = path.join(defaultProfile, 'Default');
    try {
      if (!fs.existsSync(linkPath) && fs.existsSync(realDefault)) {
        fs.symlinkSync(realDefault, linkPath);
      }
    } catch { /* 软链接可能已存在或平台不支持 */ }
  }

  // 以 CDP 模式启动 Chrome（后台进程，不阻塞）
  console.log(`chrome: 启动 Chrome（CDP 端口 ${port}）...`);
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    `--user-data-dir=${debugDir}`,
  ];
  const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
  child.unref(); // 不等待子进程退出

  // 轮询等待 CDP 端口就绪（最多 10 秒）
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await checkPort(port)) {
      try {
        // 验证 CDP 协议可用（请求 /json/version）
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (resp.ok) return true;
      } catch {}
    }
  }

  console.error('chrome: CDP 端口启动超时');
  return false;
}

// ── 可选依赖检查 ──────────────────────────────────────────────────

/**
 * 检测单个可选依赖是否安装。
 * 使用 which（Linux/macOS）或 where（Windows）命令。
 *
 * @param {string} name - 命令名（如 sqlite3、yt-dlp）
 * @returns {{status: string}} ok 或 not-found
 */
function checkOptionalDep(name) {
  try {
    const cmd = os.platform() === 'win32' ? `where "${name}"` : `which "${name}"`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 'ok' };
  } catch {
    return { status: 'not-found' };
  }
}

// ── site-patterns 列表 ─────────────────────────────────────────────

/**
 * 列出 ~/.sleuth/site-patterns/ 下所有 .md 文件名。
 * 展示已有的站点经验覆盖了哪些域名。
 *
 * @returns {string[]} 文件名列表（如 ["github.com.md", "stackoverflow.com.md"]）
 */
function listSitePatterns() {
  const patterns = [];
  if (fs.existsSync(SITE_PATTERNS_DIR)) {
    try {
      const entries = fs.readdirSync(SITE_PATTERNS_DIR);
      for (const entry of entries) {
        if (entry.endsWith('.md') && fs.statSync(path.join(SITE_PATTERNS_DIR, entry)).isFile()) {
          patterns.push(entry);
        }
      }
    } catch (_) {}
  }
  return patterns;
}

// ── 主流程 ────────────────────────────────────────────────────────

/**
 * 主函数。执行完整的环境检查流程。
 *
 * @param {object} [options] - 可选配置
 * @param {boolean} [options.outputDirOnly] - 仅输出目录路径，不做检查
 * @param {string} [options.sid] - session ID（用于目录定位）
 * @returns {Promise<object>} 检查结果对象
 */
async function main(options = {}) {
  const results = {};

  // 特殊模式：仅输出目录路径（供其他脚本快速获取路径）
  if (options.outputDirOnly) {
    const outDir = resolveOutputDir(options.sid);
    ensureOutputDir(outDir);
    console.log(outDir);
    return results;
  }

  // ── 检查 1：agent-browser ──
  const ab = checkAgentBrowser();
  results.agentBrowser = ab;
  if (ab.status === 'ok') {
    console.log(`agent-browser: ok (${ab.version})`);
  } else {
    console.log('agent-browser: not found — npm i -g agent-browser && agent-browser install');
  }

  // ── 检查 2：Chrome CDP ──
  let chromePort = await detectChromePort();
  if (chromePort) {
    results.chromePort = chromePort;
    console.log(`chrome: ok (port ${chromePort})`);
  } else {
    // CDP 不可用 → 尝试自动重启 Chrome
    console.log('chrome: CDP 不可用，正在自动重启 Chrome...');
    const ok = await restartChromeWithCDP(9222);
    if (ok) {
      chromePort = 9222;
      results.chromePort = chromePort;
      console.log(`chrome: ok (port ${chromePort})`);
    } else {
      results.chromePort = null;
      console.log('chrome: 自动重启失败 — 请手动执行:');
      console.log('  1. 完全退出 Chrome');
      console.log('  2. 运行: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 &');
      console.log('  3. 重新运行 check-deps');
    }
  }

  // ── 检查 3：输出目录 ──
  const outDir = resolveOutputDir();
  ensureOutputDir(outDir);
  results.outputDir = outDir;
  console.log(`output-dir: ${outDir}`);

  // ── 检查 3.5：清理过期输出（静默，非阻塞）──
  try {
    const { main: cleanupMain } = await import('./cleanup-output.mjs');
    cleanupMain({ days: 7, dryRun: false });
  } catch (err) {
    console.warn(`cleanup: ${err.code === 'ERR_MODULE_NOT_FOUND' ? 'script missing' : err.message}`);
  }

  console.log();

  // ── 检查 4：站点经验文件 ──
  const patterns = listSitePatterns();
  results.sitePatterns = patterns;
  if (patterns.length > 0) {
    console.log(`site-patterns: ${patterns.join(', ')}`);
  } else {
    console.log('site-patterns: (none)');
  }

  // ── 检查 5：可选依赖 ──
  console.log();
  const optDeps = {
    sqlite3:    { install: 'macOS/Linux 预装；Windows: winget install sqlite.sqlite', usedBy: 'find-url （Chrome 书签/历史搜索）' },
    'yt-dlp':   { install: 'pip install yt-dlp', usedBy: 'download_subtitles / extract-subtitles （YouTube 字幕下载）' },
    python3:    { install: 'macOS/Linux 预装；Windows: winget install python3', usedBy: 'srt_to_transcript （字幕清洗）' },
  };
  results.optionalDeps = {};
  for (const [dep, info] of Object.entries(optDeps)) {
    const r = checkOptionalDep(dep);
    results.optionalDeps[dep] = r.status;
    if (r.status === 'ok') {
      console.log(`${dep}: ok`);
    } else {
      console.log(`${dep}: not found — ${info.install}（${info.usedBy}）`);
    }
  }

  return results;
}

// 如果直接运行（非 import），执行主函数
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const outputDirOnly = process.argv.includes('--output-dir');
  const sidIdx = process.argv.indexOf('--sid');
  const sid = sidIdx !== -1 ? process.argv[sidIdx + 1] : undefined;
  main({ outputDirOnly, sid }).catch((err) => {
    console.error('check-deps error:', err.message);
    process.exit(1);
  });
}

// 导出供其他脚本使用
export { main, checkAgentBrowser, detectChromePort, listSitePatterns, checkPort, resolveOutputDir, ensureOutputDir };
