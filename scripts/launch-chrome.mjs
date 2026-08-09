#!/usr/bin/env node
/**
 * launch-chrome.mjs — 启动带 CDP 调试的 Chrome，用 symlink profile 绕过
 * Chrome 136+ 对 --remote-debugging-port + 默认 profile 的限制。
 *
 * 支持 macOS / Linux / Windows。
 *
 * 用法：node launch-chrome.mjs --confirm-close-browser
 * 输出：SLEUTH_CDP_PORT 和 SLEUTH_CDP_WS（和 check-deps 一致）
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── 平台常量 ────────────────────────────────────────────────
const PLATFORM = process.platform;        // 'darwin' | 'linux' | 'win32'
const IS_WSL   = !!process.env.WSL_DISTRO_NAME;
const HOME     = os.homedir();

const DEBUG_PORT = Number(process.env.SLEUTH_DEBUG_PORT || 9222);
const LINK_DIR   = path.join(HOME, '.sleuth/chrome-live');
const PID_FILE   = path.join(HOME, '.sleuth/chrome-debug.pid');
const KILL_GRACE_MS = 5000;
const KILL_TERM_MS  = 3000;
const CONFIRM_CLOSE = process.argv.includes('--confirm-close-browser');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('用法：node scripts/launch-chrome.mjs --confirm-close-browser');
  console.log('警告：该脚本需要关闭当前 Chrome。请先保存标签页和未提交内容。');
  process.exit(0);
}

// ── 工具函数 ────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

/** 纯 Node.js 忙等，不依赖 OS 的 sleep 命令。 */
const sleepSync = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
};

/** CDP /json/version 探活。 */
function isCDPRunning() {
  try {
    const out = execSync(`curl -s --max-time 2 http://127.0.0.1:${DEBUG_PORT}/json/version`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch { return null; }
}

/** 端口是否仍被占用。 */
function isPortBusy() {
  try {
    execSync(`curl -s --max-time 0.5 http://127.0.0.1:${DEBUG_PORT}/json/version`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/** 等端口释放，最多 attempts 次 ×1s。 */
function waitForPortFree(attempts) {
  for (let i = 0; i < attempts; i++) {
    if (!isPortBusy()) return true;
    sleepSync(1000);
  }
  return false;
}

/** 给 PID 发信号（跨平台）。 */
function signal(pid, sig) {
  try { process.kill(pid, sig); } catch {}
}

/** 读上次存的 PID。 */
function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    return Number(raw) || null;
  } catch { return null; }
}

/** 存 PID。 */
function writePid(pid) {
  fs.writeFileSync(PID_FILE, String(pid));
}

/** 删 PID 文件。 */
function clearPid() { try { fs.unlinkSync(PID_FILE); } catch {} }

/** 检查 PID 是否还活着。 */
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

/** 等进程退出，最多 attempts 次 ×1s。 */
function waitForExit(pid, attempts) {
  for (let i = 0; i < attempts; i++) {
    if (!isAlive(pid)) return true;
    sleepSync(1000);
  }
  return false;
}

// ── 按 PID 停旧 Chrome ─────────────────────────────────────

/**
 * 关闭正在运行的 Chrome。
 *
 * 有 PID 文件 → 只杀那个 PID（上次 sleuth 启动的实例）。
 * 无 PID 文件 → macOS 上 osascript 优雅退出用户日常 Chrome。
 *   必须先关——symlink profile 会和日常 Chrome 抢同一份数据文件。
 */
function stopPreviousChrome() {
  const pid = readPid();

  // 有 PID 文件：只杀上次 sleuth 的实例
  if (pid && isAlive(pid)) {
    log('  → 请求上次 sleuth Chrome 退出 (PID ' + pid + ') …');
    signal(pid, PLATFORM === 'win32' ? void 0 : 'SIGTERM');
    sleepSync(KILL_GRACE_MS);
    if (!isAlive(pid)) return;
    log('  ⚠ 上次 sleuth Chrome 未响应，强制终止 (PID ' + pid + ')。');
    signal(pid, 'SIGKILL');
    waitForExit(pid, 5);
    if (isAlive(pid) && PLATFORM === 'win32') {
      try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' }); } catch {}
    }
    waitForPortFree(5);
    return;
  }

  // 无 PID 文件（首次运行或 PID 文件丢失）：
  // symlink profile 必须独占数据文件——需要先关掉日常 Chrome
  if (PLATFORM === 'darwin') {
    log('  → 首次运行：请求 Chrome 退出以释放 profile …');
    try {
      execSync('osascript -e \'tell application "Google Chrome" to quit\'', {
        stdio: 'pipe', timeout: KILL_GRACE_MS,
      });
    } catch {}
    sleepSync(KILL_GRACE_MS);
    if (waitForPortFree(5)) return;
    err('✗ Chrome 未正常退出。为保护未保存内容，脚本不会强制终止日常 Chrome。');
    err('  请手动 Cmd+Q 关闭 Chrome 后再重试。');
    process.exit(1);
  }
}

// ── Chrome 查找 ─────────────────────────────────────────────

/**
 * 查找 Chrome 可执行文件。
 *
 * SLEUTH_CHROME_BIN 环境变量 > 平台内置搜索
 */
function findChrome() {
  if (process.env.SLEUTH_CHROME_BIN) {
    if (fs.existsSync(process.env.SLEUTH_CHROME_BIN)) return process.env.SLEUTH_CHROME_BIN;
    err('SLEUTH_CHROME_BIN is set but file not found: ' + process.env.SLEUTH_CHROME_BIN);
    process.exit(1);
  }
  if (PLATFORM === 'darwin') {
    // mdfind (Spotlight) 找到 Chrome.app 的位置
    try {
      const p = execSync('mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\' && kMDItemContentType == \'com.apple.application-bundle\'" 2>/dev/null | head -1', { encoding: 'utf8', stdio: 'pipe', timeout: 3000 }).trim();
      if (p) return path.join(p, 'Contents/MacOS/Google Chrome');
    } catch {}
    const fixed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(fixed)) return fixed;
  }
  if (PLATFORM === 'linux') {
    for (const bin of ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']) {
      try {
        const p = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', stdio: 'pipe' }).trim();
        if (p && fs.existsSync(p)) return p;
      } catch {}
    }
    // Snap / Flatpak
    for (const p of [
      '/snap/bin/chromium',
      '/var/lib/flatpak/exports/bin/com.google.Chrome',
      path.join(HOME, '.local/share/flatpak/exports/bin/com.google.Chrome'),
    ]) {
      if (fs.existsSync(p)) return p;
    }
    // WSL：Chrome 在 Windows 宿主上，Linux 侧找不到
    if (IS_WSL) {
      err('WSL detected. Chrome runs on the Windows host, not inside WSL.');
      err('  Set SLEUTH_CHROME_BIN to the Windows path of chrome.exe, e.g.:');
      err('  export SLEUTH_CHROME_BIN="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"');
    }
  }
  if (PLATFORM === 'win32') {
    // 注册表
    try {
      const reg = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve 2>nul', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      const m = reg.match(/REG_SZ\s+(.+)/);
      if (m?.[1] && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch {}
    // 常见路径兜底
    const d = process.env.LOCALAPPDATA || path.join(HOME, 'AppData/Local');
    for (const sub of ['Google/Chrome/Application/chrome.exe', 'Google/Chrome Beta/Application/chrome.exe', 'Google/Chrome Dev/Application/chrome.exe']) {
      if (fs.existsSync(path.join(d, sub))) return path.join(d, sub);
    }
  }
  return null;
}

const CHROME_BIN = findChrome();

// ── profile 路径 ────────────────────────────────────────────

const DEFAULT_DATA = (() => {
  switch (PLATFORM) {
    case 'darwin': return path.join(HOME, 'Library/Application Support/Google/Chrome');
    case 'linux':  return path.join(HOME, '.config/google-chrome');
    case 'win32':  return path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData/Local'), 'Google/Chrome/User Data');
    default: throw new Error('Unsupported platform: ' + PLATFORM);
  }
})();

// ── symlink / copy profile ─────────────────────────────────

/**
 * 创建链接：Windows 非管理员降级为拷贝。
 */
function createLink(src, dst) {
  try {
    fs.symlinkSync(src, dst);
  } catch {
    // Windows 普通用户无权 symlink → copy 兜底
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

function setupSymlinks() {
  if (fs.existsSync(LINK_DIR)) {
    try {
      const s = fs.lstatSync(LINK_DIR);
      if (s.isSymbolicLink()) {
        fs.unlinkSync(LINK_DIR);
      } else {
        fs.rmSync(LINK_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      }
    } catch {
      fs.rmSync(LINK_DIR, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(LINK_DIR, { recursive: true });
  for (const item of ['Default', 'Local State', 'First Run']) {
    const src = path.join(DEFAULT_DATA, item);
    if (fs.existsSync(src)) createLink(src, path.join(LINK_DIR, item));
  }
}

// ── 锁清理 ─────────────────────────────────────────────────

function cleanLocks() {
  for (const name of ['SingletonLock', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(DEFAULT_DATA, name)); } catch {}
  }
}

// ── 启动 ────────────────────────────────────────────────────

function launchChrome() {
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${LINK_DIR}`,
    '--restore-last-session',
  ];
  // 容器 / CI 环境
  if (process.env.CI || process.env.SLEUTH_NO_SANDBOX) {
    args.push('--no-sandbox');
  }

  const child = spawn(CHROME_BIN, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();

  // 存 PID，下次杀掉时只杀这个实例
  if (child.pid) writePid(child.pid);

  for (let i = 0; i < 60; i++) {
    sleepSync(500);
    const info = isCDPRunning();
    if (info) return info;
  }
  return null;
}

// ── DevToolsActivePort ──────────────────────────────────────

function writeDevToolsPort(wsUrl) {
  const wsPath = wsUrl.split(`:${DEBUG_PORT}`)[1];
  const data = `${DEBUG_PORT}\n${wsPath}\n`;
  // 独立诊断实例只能写自己的目录，绝不伪装成用户日常 Chrome。
  fs.writeFileSync(path.join(LINK_DIR, 'DevToolsActivePort'), data);
}

// ═══ 主流程 ════════════════════════════════════════════════

// 1. CDP 已在跑？
let info = isCDPRunning();
if (info) {
  log(`chrome-cdp: already running (port ${DEBUG_PORT}, ${info.Browser})`);
  log(`SLEUTH_CDP_PORT=${DEBUG_PORT}`);
  log(`SLEUTH_CDP_WS=${info.webSocketDebuggerUrl}`);
  process.exit(0);
}

// 2. 检查 Chrome 二进制
if (!CHROME_BIN) {
  err('Chrome not found. Set SLEUTH_CHROME_BIN to the full path of your Chrome executable.');
  process.exit(1);
}

// 3. 停上次 sleuth Chrome → 链接 profile → 清锁 → 启动
if (!CONFIRM_CLOSE) {
  err('✗ 此脚本会请求关闭当前 Chrome。');
  err('  保存未提交内容后，由你手动重跑：node scripts/launch-chrome.mjs --confirm-close-browser');
  process.exit(2);
}
log('chrome-cdp: not running. Setting up profile + relaunch...');
log('  (Chrome 重启后标签页 URL 自动恢复；登录态视站点而定)');
stopPreviousChrome();
setupSymlinks();
cleanLocks();

info = launchChrome();
if (!info) {
  err('chrome-cdp: failed to start. If a non-Chrome process is using port 9222, free it first.');
  clearPid();
  process.exit(1);
}

writeDevToolsPort(info.webSocketDebuggerUrl);
log(`chrome-cdp: ok (${info.Browser}, port ${DEBUG_PORT})`);
log(`SLEUTH_CDP_PORT=${DEBUG_PORT}`);
log(`SLEUTH_CDP_WS=${info.webSocketDebuggerUrl}`);
