#!/usr/bin/env node
// 环境检查：验证 agent-browser + Chrome 远程调试连接就绪（跨平台）
// sleuth 版：环境检查与依赖检测

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOutputDir, ensureOutputDir } from './lib/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// --- TCP 端口探测 ---
function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// --- Chrome 调试端口检测 ---
function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return [
        path.join(home, '.sleuth', 'chrome-debug', 'DevToolsActivePort'),
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

async function detectChromePort() {
  // Check port files in parallel
  const portFileChecks = activePortFiles().map(async (filePath) => {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536 && await checkPort(port)) {
        return port;
      }
    } catch (_) {}
    return null;
  });

  for (const result of await Promise.all(portFileChecks)) {
    if (result !== null) return result;
  }

  // Fallback: check common ports in parallel
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

// --- agent-browser 检查 ---

// --- Chrome CDP 自动重启 ---
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

function getDefaultChromeProfile() {
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin': return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    case 'linux': return path.join(home, '.config', 'google-chrome');
    case 'win32': return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
    default: return null;
  }
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restartChromeWithCDP(port = 9222) {
  const binary = findChromeBinary();
  if (!binary) {
    console.error('chrome: 未找到 Chrome 二进制文件');
    return false;
  }

  const running = isChromeRunning();
  if (running) {
    console.log('chrome: 正在关闭 Chrome...');
    try {
      if (os.platform() === 'darwin') {
        execSync('osascript -e \'tell application "Google Chrome" to quit\'', { timeout: 10000 });
      } else {
        execSync('pkill -x "Google Chrome" 2>/dev/null || pkill -x "chrome" 2>/dev/null || pkill -x "chromium" 2>/dev/null', { timeout: 10000 });
      }
    } catch { /* force kill fallback */ }
    for (let i = 0; i < 15; i++) {
      if (!isChromeRunning()) break;
      await sleep(500);
    }
    if (isChromeRunning()) {
      console.error('chrome: Chrome 未能正常关闭，请手动退出后重试');
      return false;
    }
    await sleep(1000);
  }

  // Chrome 147+ requires non-default --user-data-dir for CDP.
  // Create ~/.sleuth/chrome-debug/ with Default symlinked from the real profile.
  const debugDir = path.join(os.homedir(), '.sleuth', 'chrome-debug');
  const defaultProfile = getDefaultChromeProfile();
  fs.mkdirSync(debugDir, { recursive: true });
  if (defaultProfile) {
    const linkPath = path.join(debugDir, 'Default');
    const realDefault = path.join(defaultProfile, 'Default');
    try {
      if (!fs.existsSync(linkPath) && fs.existsSync(realDefault)) {
        fs.symlinkSync(realDefault, linkPath);
      }
    } catch { /* symlink may already exist or fail on some platforms */ }
  }

  console.log(`chrome: 启动 Chrome（CDP 端口 ${port}）...`);
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    `--user-data-dir=${debugDir}`,
  ];
  const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await checkPort(port)) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (resp.ok) return true;
      } catch {}
    }
  }

  console.error('chrome: CDP 端口启动超时');
  return false;
}
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
    // agent-browser not found in PATH
    return { status: 'not-found', version: null };
  }
}

// --- 可选依赖检查（跨平台）---
function checkOptionalDep(name) {
  try {
    const cmd = os.platform() === 'win32' ? `where "${name}"` : `which "${name}"`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 'ok' };
  } catch {
    return { status: 'not-found' };
  }
}

// --- site-patterns 列表 ---
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

// --- 主流程 ---
async function main(options = {}) {
  const results = {};

  // Handle --output-dir flag: print resolved path and exit early
  if (options.outputDirOnly) {
    const outDir = resolveOutputDir(options.sid);
    ensureOutputDir(outDir);
    console.log(outDir);
    return results;
  }

  // 1. agent-browser
  const ab = checkAgentBrowser();
  results.agentBrowser = ab;
  if (ab.status === 'ok') {
    console.log(`agent-browser: ok (${ab.version})`);
  } else {
    console.log('agent-browser: not found — npm i -g agent-browser && agent-browser install');
  }

  // 2. Chrome CDP
  let chromePort = await detectChromePort();
  if (chromePort) {
    results.chromePort = chromePort;
    console.log(`chrome: ok (port ${chromePort})`);
  } else {
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

  // 输出目录
  const outDir = resolveOutputDir();
  ensureOutputDir(outDir);
  results.outputDir = outDir;
  console.log(`output-dir: ${outDir}`);

  // 清理过期输出（静默，非阻塞）
  try {
    const { main: cleanupMain } = await import('./cleanup-output.mjs');
    cleanupMain({ days: 7, dryRun: false });
  } catch (err) {
    console.warn(`cleanup: ${err.code === 'ERR_MODULE_NOT_FOUND' ? 'script missing' : err.message}`);
  }

  // 空行分隔
  console.log();

  // 3. site-patterns
  const patterns = listSitePatterns();
  results.sitePatterns = patterns;
  if (patterns.length > 0) {
    console.log(`site-patterns: ${patterns.join(', ')}`);
  } else {
    console.log('site-patterns: (none)');
  }

  // 4. 可选依赖
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

  // 返回 results 供编程调用使用
  return results;
}

// 如果直接运行
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

export { main, checkAgentBrowser, detectChromePort, listSitePatterns, checkPort, resolveOutputDir, ensureOutputDir };
