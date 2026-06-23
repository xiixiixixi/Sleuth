#!/usr/bin/env node
/**
 * launch-chrome.mjs — 用 symlink profile 启动带 CDP 调试的 Chrome
 *
 * Chrome 136+ 不允许 --remote-debugging-port 配合默认 profile。
 * 本脚本把默认 profile 符号链接到独立目录，骗过检查，
 * 让 Chrome 既有用户登录态又开启 CDP 调试。
 *
 * 用法：node launch-chrome.mjs
 * 输出：SLEUTH_CDP_PORT 和 SLEUTH_CDP_WS（和 check-deps 一致）
 */

import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_DATA = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const LINK_DIR = path.join(os.homedir(), '.sleuth/chrome-live');
const DEBUG_PORT = 9222;

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

/**
 * 检查端口是否已有 Chrome 在听 CDP
 */
function isCDPRunning() {
  try {
    const out = execSync(`curl -s --max-time 2 http://127.0.0.1:${DEBUG_PORT}/json/version`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const info = JSON.parse(out);
    return info;
  } catch {
    return null;
  }
}

/**
 * 创建符号链接 profile
 */
function setupSymlinks() {
  // 清理旧目录（保留目录本身）
  if (fs.existsSync(LINK_DIR)) {
    fs.rmSync(LINK_DIR, { recursive: true });
  }
  fs.mkdirSync(LINK_DIR, { recursive: true });

  // 链接核心文件
  const items = ['Default', 'Local State', 'First Run'];
  for (const item of items) {
    const src = path.join(DEFAULT_DATA, item);
    const dst = path.join(LINK_DIR, item);
    if (fs.existsSync(src)) {
      fs.symlinkSync(src, dst);
    }
  }
}

/**
 * 写 DevToolsActivePort 到默认路径（让 browser-discovery.mjs 能发现）
 */
function writeDevToolsPort(wsUrl) {
  const wsPath = wsUrl.split(`:${DEBUG_PORT}`)[1];
  const filePath = path.join(DEFAULT_DATA, 'DevToolsActivePort');
  fs.writeFileSync(filePath, `${DEBUG_PORT}\n${wsPath}\n`);
}

/**
 * 杀 Chrome 并等待退出
 */
function killChrome() {
  try { execSync('pkill -9 -f "Google Chrome"', { stdio: 'pipe' }); } catch {}
  // 等端口释放
  for (let i = 0; i < 10; i++) {
    try {
      execSync(`curl -s --max-time 1 http://127.0.0.1:${DEBUG_PORT}/json/version`, { stdio: 'pipe' });
      // 还在响应，等一下
      execSync('sleep 1');
    } catch {
      break; // 端口已释放
    }
  }
}

/**
 * 启动 Chrome 并等 CDP 就绪
 */
function launchChrome() {
  execFileSync(CHROME_BIN, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${LINK_DIR}`,
  ], { detached: true, stdio: 'ignore' }).unref();

  // 等 CDP 就绪（最多 15 秒）
  for (let i = 0; i < 30; i++) {
    execSync('sleep 0.5');
    const info = isCDPRunning();
    if (info) return info;
  }
  return null;
}

// === 主流程 ===

// 1. 已在跑？
let info = isCDPRunning();
if (info) {
  log(`chrome-cdp: already running (port ${DEBUG_PORT}, ${info.Browser})`);
  log(`SLEUTH_CDP_PORT=${DEBUG_PORT}`);
  log(`SLEUTH_CDP_WS=${info.webSocketDebuggerUrl}`);
  process.exit(0);
}

// 2. 检查 Chrome 二进制
if (!fs.existsSync(CHROME_BIN)) {
  err(`Chrome not found at ${CHROME_BIN}`);
  process.exit(1);
}

// 3. 杀 Chrome → 建 symlink → 重启
log('chrome-cdp: not running. Setting up symlink profile + relaunch...');
log('  (Chrome will restart with your login state intact)');
killChrome();
setupSymlinks();

info = launchChrome();
if (!info) {
  err('chrome-cdp: failed to start. Check if Chrome is installed correctly.');
  process.exit(1);
}

// 4. 写 DevToolsActivePort 让 browser-discovery 发现
writeDevToolsPort(info.webSocketDebuggerUrl);

log(`chrome-cdp: ok (${info.Browser}, port ${DEBUG_PORT})`);
log(`SLEUTH_CDP_PORT=${DEBUG_PORT}`);
log(`SLEUTH_CDP_WS=${info.webSocketDebuggerUrl}`);
