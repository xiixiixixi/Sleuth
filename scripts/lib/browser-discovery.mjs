import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * 用户日常 Google Chrome 的默认数据目录。
 *
 * Sleuth 不把 Edge、Chrome Dev、Chrome for Testing 或 Chromium 当作登录态
 * Chrome 的替代品，避免“端口能连但登录态不在”的误判。
 */
export function knownBrowsers() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return [
        {
          id: 'chrome',
          label: 'Google Chrome',
          defaultDataDir: path.join(home, 'Library/Application Support/Google/Chrome'),
          devToolsPath: path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        },
      ];
    case 'linux':
      return [
        {
          id: 'chrome',
          label: 'Google Chrome',
          defaultDataDir: path.join(home, '.config/google-chrome'),
          devToolsPath: path.join(home, '.config/google-chrome/DevToolsActivePort'),
        },
      ];
    case 'win32':
      return [
        {
          id: 'chrome',
          label: 'Google Chrome',
          defaultDataDir: path.join(localAppData, 'Google/Chrome/User Data'),
          devToolsPath: path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        },
      ];
    default:
      return [];
  }
}

const NON_USER_BROWSER_PATTERN = /chrome for testing|google chrome (?:dev|beta|canary)|chromium|headless_shell|ms-playwright|playwright|puppeteer|\.agent-browser/i;
const STABLE_CHROME_EXECUTABLE_PATTERN = /(?:^|\/)applications\/google chrome\.app\/contents\/macos\/google chrome$|(?:^|\/)(?:google-chrome|google-chrome-stable)$|^\/opt\/google\/chrome\/(?:chrome|google-chrome)$|\/google\/chrome\/application\/chrome\.exe$/i;

function normalizeExecutablePath(value) {
  return String(value || '').trim().replaceAll('\\', '/');
}

function normalizeDataDir(value) {
  const normalized = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  const platformPath = path.normalize(normalized).replaceAll('\\', '/');
  return os.platform() === 'win32' ? platformPath.toLowerCase() : platformPath;
}

/** 从 ps / PowerShell 命令行中提取 user-data-dir，并兼容含空格的默认目录。 */
function extractUserDataDir(command, defaultDataDir) {
  const match = /--user-data-dir(?:=|\s+)/i.exec(command);
  if (!match) return null;
  const rest = command.slice(match.index + match[0].length).trimStart();
  if (!rest) return '';
  if (rest[0] === '"' || rest[0] === "'") {
    const end = rest.indexOf(rest[0], 1);
    return end === -1 ? rest.slice(1) : rest.slice(1, end);
  }

  if (defaultDataDir) {
    const candidate = os.platform() === 'win32' ? rest.toLowerCase() : rest;
    const expected = os.platform() === 'win32' ? defaultDataDir.toLowerCase() : defaultDataDir;
    if (candidate.startsWith(expected)) {
      const boundary = rest[expected.length];
      if (boundary === undefined || /\s/.test(boundary)) return rest.slice(0, expected.length);
    }
  }
  return rest.split(/\s/, 1)[0];
}

/**
 * 判断监听调试端口的进程是不是用户日常 Google Chrome。
 * 只看 DevToolsActivePort 文件不够：旧启动器和测试浏览器都可能伪装这个文件。
 */
export function classifyBrowserProcess(browser, processInfo = {}) {
  const executablePath = normalizeExecutablePath(processInfo?.executablePath);
  const command = String(processInfo?.command || '').trim();
  if (!executablePath || !command) return { accepted: false, reason: 'port-owner-unverified' };
  if (NON_USER_BROWSER_PATTERN.test(executablePath)) {
    return { accepted: false, reason: 'test-or-development-browser' };
  }
  if (browser?.id !== 'chrome' || !STABLE_CHROME_EXECUTABLE_PATTERN.test(executablePath)) {
    return { accepted: false, reason: 'not-stable-google-chrome' };
  }
  const userDataDir = extractUserDataDir(command, browser.defaultDataDir);
  if (userDataDir !== null && normalizeDataDir(userDataDir) !== normalizeDataDir(browser.defaultDataDir)) {
    return { accepted: false, reason: 'non-default-user-data-dir' };
  }
  if (/--remote-debugging-(?:port|pipe)(?:=|\s)/i.test(command)) {
    return { accepted: false, reason: 'manually-launched-debug-browser' };
  }
  return { accepted: true, reason: 'verified-user-chrome' };
}

function findLinuxPortOwnerFromProc(port) {
  const wantedPort = Number(port).toString(16).toUpperCase().padStart(4, '0');
  const socketInodes = new Set();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content;
    try { content = fs.readFileSync(table, 'utf8'); }
    catch { continue; }
    for (const line of content.split(/\r?\n/).slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10) continue;
      const localAddress = fields[1] || '';
      const state = fields[3];
      if (state === '0A' && localAddress.endsWith(`:${wantedPort}`)) socketInodes.add(fields[9]);
    }
  }
  if (socketInodes.size === 0) return null;

  for (const pidName of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    const fdDir = `/proc/${pidName}/fd`;
    let fds;
    try { fds = fs.readdirSync(fdDir); }
    catch { continue; }
    for (const fd of fds) {
      let target;
      try { target = fs.readlinkSync(path.join(fdDir, fd)); }
      catch { continue; }
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      if (inode && socketInodes.has(inode)) return Number(pidName);
    }
  }
  return null;
}

function findPortOwnerPid(port) {
  try {
    const lsofOutput = execFileSync('lsof', [
      '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp',
    ], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    });
    const pidLine = lsofOutput.split(/\r?\n/).find(line => /^p\d+$/.test(line));
    if (pidLine) return Number(pidLine.slice(1));
  } catch {}
  if (os.platform() === 'linux') return findLinuxPortOwnerFromProc(port);
  return null;
}

/** 找出监听本地端口的进程，供身份校验使用。 */
export function inspectPortOwner(port) {
  try {
    if (os.platform() === 'win32') {
      const script = [
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1`,
        '$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"',
        'Write-Output "$($p.ProcessId)`n$($p.ExecutablePath)`n$($p.CommandLine)"',
      ].join('; ');
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
      }).trim().split(/\r?\n/);
      return {
        pid: Number(output[0]),
        executablePath: output[1]?.trim() || '',
        command: output.slice(2).join(' ').trim(),
      };
    }

    const pid = findPortOwnerPid(port);
    if (!pid) return null;
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
    const executablePath = os.platform() === 'linux'
      ? fs.readlinkSync(`/proc/${pid}/exe`)
      : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
        }).trim();
    return { pid, executablePath, command };
  } catch {
    return null;
  }
}

/** TCP 端口探活 */
export function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/** 返回通过身份校验的浏览器和被拒绝的候选。 */
export async function detectCandidates(options = {}) {
  const accepted = [];
  const rejected = [];
  const browsers = options.browsers || knownBrowsers();
  const readFile = options.readFile || fs.readFileSync;
  const checkPortFn = options.checkPort || checkPort;
  const inspectOwner = options.inspectPortOwner || inspectPortOwner;

  for (const browser of browsers) {
    let content;
    try { content = readFile(browser.devToolsPath, 'utf8'); }
    catch { continue; }
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const port = parseInt(lines[0], 10);
    if (!(port > 0 && port < 65536)) continue;
    if (!(await checkPortFn(port))) continue;
    const owner = await inspectOwner(port);
    const identity = classifyBrowserProcess(browser, owner);
    const candidate = {
      ...browser,
      port,
      wsPath: lines[1] || null,
      processId: owner?.pid || null,
      identity: identity.reason,
    };
    if (identity.accepted) accepted.push(candidate);
    else rejected.push(candidate);
  }
  return { accepted, rejected };
}

/** 兼容旧调用：只返回真正允许连接的用户 Chrome。 */
export async function detectAll(options = {}) {
  return (await detectCandidates(options)).accepted;
}

/** 选择经过身份核验的用户 Chrome。 */
export async function selectBrowser(options = {}) {
  const { accepted, rejected } = await detectCandidates(options);
  if (accepted.length > 0) {
    const chosen = accepted[0];
    return { kind: 'ok', browser: chosen, port: chosen.port, detected: accepted, rejected };
  }
  if (rejected.length > 0) return { kind: 'rejected', detected: [], rejected };
  return { kind: 'empty', detected: [], rejected: [] };
}

/** 返回完整连接判定，供环境检查解释拒绝原因。 */
export async function getBrowserConnection(options = {}) {
  const selection = await selectBrowser(options);
  if (selection.kind !== 'ok') return selection;
  if (!selection.browser?.wsPath) {
    return {
      kind: 'rejected',
      detected: [],
      rejected: [{ ...selection.browser, identity: 'missing-websocket-path' }],
    };
  }
  const wsUrl = `ws://127.0.0.1:${selection.port}${selection.browser.wsPath}`;
  return {
    ...selection,
    wsUrl,
    label: selection.browser.label,
    identity: selection.browser.identity,
  };
}

/**
 * 从 DevToolsActivePort 构造完整的 ws:// URL。
 * agent-browser 用这个 URL 直连，绕过 /json/version HTTP 探测（404 问题）。
 * @returns {Promise<{wsUrl: string, port: number, label: string} | null>}
 */
export async function getWebSocketUrl() {
  const connection = await getBrowserConnection();
  if (connection.kind !== 'ok') return null;
  return {
    wsUrl: connection.wsUrl,
    port: connection.port,
    label: connection.label,
    identity: connection.identity,
  };
}
