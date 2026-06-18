/**
 * check-deps-core.mjs — sleuth 环境检查核心逻辑
 *
 * 职责：
 * - 检查 agent-browser / Chrome / 可选依赖
 * - 管理 Sleuth managed browser（独立 profile）
 * - 显式 opt-in 连接 real-browser
 * - 提供稳定的机器可读状态
 */

import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOutputDir, ensureOutputDir } from './output.mjs';

import { selectBrowser as selectDailyBrowser, detectAll as detectDailyBrowsers, getWebSocketUrl } from './browser-discovery.mjs';

// 浏览器连接模式
const BROWSER_MODE_APPROVAL    = 'approval';
const BROWSER_MODE_MANAGED     = 'managed';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../..');
const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');
const CDP_PROFILE_DIR = path.join(os.homedir(), '.sleuth', 'cdp-profile');
const STATE_FILE = path.join(os.homedir(), '.sleuth', 'cdp-state.json');
const REAL_BROWSER_STATE_FILE = path.join(os.homedir(), '.sleuth', 'real-browser-state.json');
const PREFERRED_PORTS = [9222, 9223, 9333];

function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function validateCDPEndpoint(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { valid: false, info: null };
    const info = await resp.json();
    if (!info.webSocketDebuggerUrl) return { valid: false, info: null };
    return { valid: true, info };
  } catch {
    return { valid: false, info: null };
  }
}

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function readRealBrowserState() {
  try {
    if (!fs.existsSync(REAL_BROWSER_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(REAL_BROWSER_STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeRealBrowserState(state) {
  fs.mkdirSync(path.dirname(REAL_BROWSER_STATE_FILE), { recursive: true });
  fs.writeFileSync(REAL_BROWSER_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function persistManagedState({ port, pid = null, patch = {} }) {
  if (!port) return;
  const current = readState() || {};
  const state = {
    ...current,
    ...patch,
    port,
    pid: pid || current.pid || null,
    startedAt: current.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
}

async function detectCDPPort() {
  const activePortFile = path.join(CDP_PROFILE_DIR, 'DevToolsActivePort');
  try {
    if (fs.existsSync(activePortFile)) {
      const port = parseInt(fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/)[0], 10);
      if (port > 0 && port < 65536) {
        const result = await validateCDPEndpoint(port);
        if (result.valid) return { port, info: result.info };
      }
    }
  } catch {}

  for (const port of PREFERRED_PORTS) {
    const result = await validateCDPEndpoint(port);
    if (result.valid) return { port, info: result.info };
  }
  return { port: null, info: null };
}

async function detectManagedCDPPort() {
  const state = readState();
  if (state?.port && state?.pid && isProcessAlive(state.pid)) {
    const result = await validateCDPEndpoint(state.port);
    if (result.valid) return { port: state.port, info: result.info, pid: state.pid };
  }

  const proc = findManagedBrowserProcess();
  if (proc?.port) {
    const result = await validateCDPEndpoint(proc.port);
    if (result.valid) {
      persistManagedState({ port: proc.port, pid: proc.pid });
      return { port: proc.port, info: result.info, pid: proc.pid };
    }
  }

  const activePortFile = path.join(CDP_PROFILE_DIR, 'DevToolsActivePort');
  try {
    if (fs.existsSync(activePortFile)) {
      const port = parseInt(fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/)[0], 10);
      if (port > 0 && port < 65536) {
        const result = await validateCDPEndpoint(port);
        if (result.valid) {
          const managedProc = findManagedBrowserProcess();
          persistManagedState({ port, pid: managedProc?.pid || null });
          return { port, info: result.info, pid: managedProc?.pid || null };
        }
      }
    }
  } catch {}

  return { port: null, info: null, pid: null };
}

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
      '/usr/bin/chromium-browser',
    ],
    win32: [
      `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
  };
  for (const candidate of candidates[os.platform()] || []) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectFreePort() {
  for (const port of PREFERRED_PORTS) {
    if (!(await checkPort(port))) return port;
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function findManagedBrowserProcess() {
  try {
    if (os.platform() === 'win32') {
      const out = execSync('wmic process where "commandline like \'%cdp-profile%\'" get processid,commandline /format:list', {
        encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pidMatch = out.match(/ProcessId=(\d+)/);
      if (!pidMatch) return null;
      const portMatch = out.match(/--remote-debugging-port=(\d+)/);
      return { pid: parseInt(pidMatch[1], 10), port: portMatch ? parseInt(portMatch[1], 10) : null };
    }

    const ps = execSync('ps aux', { encoding: 'utf-8', timeout: 3000 });
    for (const line of ps.split('\n')) {
      if (line.includes('grep')) continue;
      if (line.includes('cdp-profile') && /chrome|chromium/i.test(line)) {
        const pidMatch = line.match(/^\S+\s+(\d+)/);
        const portMatch = line.match(/--remote-debugging-port=(\d+)/);
        if (pidMatch) return { pid: parseInt(pidMatch[1], 10), port: portMatch ? parseInt(portMatch[1], 10) : null };
      }
    }
  } catch {}
  return null;
}

async function launchManagedBrowser(options = {}) {
  const port = options.port || await selectFreePort();
  const result = { ready: false, port: null, pid: null };
  const binary = findChromeBinary();
  if (!binary) {
    console.error('sleuth-browser: 未找到 Chrome 二进制文件');
    return result;
  }

  fs.mkdirSync(CDP_PROFILE_DIR, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${CDP_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  let child;
  if (os.platform() === 'darwin') {
    const appName = binary.match(/\/([^/]+)\.app\//)?.[1] || 'Google Chrome';
    child = spawn('open', ['-na', appName, '--args', ...chromeArgs], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn(binary, chromeArgs, { detached: true, stdio: 'ignore' });
  }
  child.unref();

  const launchPid = child.pid;
  console.log(`sleuth-browser: 启动 managed browser（端口 ${port}）...`);

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const check = await validateCDPEndpoint(port);
    if (check.valid) {
      const proc = findManagedBrowserProcess();
      const realPid = proc?.pid || launchPid;
      persistManagedState({ port, pid: realPid });
      result.ready = true;
      result.port = port;
      result.pid = realPid;
      console.log(`sleuth-browser: ok (pid ${realPid}, port ${port})`);
      return result;
    }
  }

  console.error('sleuth-browser: CDP 启动超时');
  return result;
}

async function ensureCDP() {
  const status = {
    browser_mode: 'unavailable',
    cdp_port: null,
    cdp_ws: null,
    browser_label: null,
    auth_state: 'unknown',
    guidance: null,
  };

  // 路径 1: Chrome 144+ approval mode（全平台主力）
  const wsInfo = await getWebSocketUrl();
  if (wsInfo) {
    status.browser_mode = 'approval';
    status.cdp_ws = wsInfo.wsUrl;
    status.cdp_port = wsInfo.port;
    status.browser_label = wsInfo.label;
    return status;
  }

  // 路径 2: fallback managed browser
  const managed = await detectManagedCDPPort();
  if (managed.port) {
    status.browser_mode = 'managed';
    status.cdp_port = managed.port;
    status.browser_label = 'Managed Chrome';
    return status;
  }

  const launched = await launchManagedBrowser({});
  if (launched.ready) {
    status.browser_mode = 'managed';
    status.cdp_port = launched.port;
    status.browser_label = 'Managed Chrome (新启动)';
    status.guidance = 'Managed 模式：需 --ensure-login 登录。';
  }

  return status;
}

async function getBrowserStatus() {
  const managed = await detectManagedCDPPort();
  return {
    ready: Boolean(managed.port),
    port: managed.port,
    pid: managed.pid || readState()?.pid || null,
    profile_dir: CDP_PROFILE_DIR,
  };
}

function stopManagedBrowser() {
  const state = readState();
  if (state?.pid) {
    try { process.kill(state.pid); } catch {}
  }
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

function checkAgentBrowser() {
  try {
    const version = execSync('agent-browser --version', {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    }).trim();
    const match = version.match(/(\d+\.\d+\.\d+)/);
    return { status: 'ok', version: match ? `v${match[1]}` : version };
  } catch {
    return { status: 'not-found', version: null };
  }
}

function checkOptionalDep(name) {
  try {
    const cmd = os.platform() === 'win32' ? `where "${name}"` : `which "${name}"`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 'ok' };
  } catch {
    return { status: 'not-found' };
  }
}

function listSitePatterns() {
  if (!fs.existsSync(SITE_PATTERNS_DIR)) return [];
  try {
    return fs.readdirSync(SITE_PATTERNS_DIR)
      .filter(entry => entry.endsWith('.md') && fs.statSync(path.join(SITE_PATTERNS_DIR, entry)).isFile());
  } catch {
    return [];
  }
}

function normalizeDomain(domain) {
  return String(domain || '').toLowerCase().replace(/^www\./, '');
}

async function handleRealBrowser(options) {
  const normalizedDomain = options.domain ? normalizeDomain(options.domain) : null;
  const result = {
    browser_mode: 'real-browser',
    cdp_port: null,
    profile_dir: null,
    auth_state: 'unknown',
    warnings: [],
    domains_allowed: normalizedDomain ? [normalizedDomain] : [],
    read_only: true,
  };

  const explicitPort = options.cdpPort || process.env.SLEUTH_CDP_PORT;
  const port = parseInt(explicitPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    result.error = 'real-browser 模式需要显式提供有效 CDP 端口（1-65535）';
    return result;
  }

  const validation = await validateCDPEndpoint(port);
  if (!validation.valid) {
    result.error = '未找到可用的 CDP 端口。请确保 Chrome 以 --remote-debugging-port 启动。';
    return result;
  }

  result.cdp_port = port;
  if (!normalizedDomain) {
    result.warnings.push('未指定 --domain，默认拒绝所有域名访问');
  }

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const tabs = await resp.json();
      const pageTabs = tabs.filter(t => t.type === 'page');
      result.tabs_count = pageTabs.length;
      if (normalizedDomain) {
        const domainTabs = pageTabs.filter(t => {
          try { return normalizeDomain(new URL(t.url).hostname) === normalizedDomain; } catch { return false; }
        });
        result.domain_tabs_count = domainTabs.length;
        if (domainTabs[0]) {
          result.scoped_tab_id = domainTabs[0].id;
          result.scoped_tab_ws = domainTabs[0].webSocketDebuggerUrl || null;
        }
      }
    }
  } catch {}

  process.env.SLEUTH_READ_ONLY = 'true';
  process.env.SLEUTH_BROWSER_MODE = 'real-browser';

  writeRealBrowserState({
    browser_mode: 'real-browser',
    read_only: true,
    port,
    domains_allowed: result.domains_allowed,
    updated_at: new Date().toISOString(),
  });

  return result;
}

async function openLoginUrl(port, loginUrl) {
  if (!loginUrl) return;
  try {
    execFileSync('agent-browser', ['--cdp', String(port), '--session', 'sleuth-login', 'open', loginUrl], {
      stdio: 'ignore', timeout: 10000,
    });
  } catch {
    try {
      await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(loginUrl)}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }
}

async function handleEnsureLogin(url) {
  const cdp = await ensureCDP(); // 用 CDP_PROFILE_DIR 启动/复用持久 managed Chrome
  if (!cdp.cdp_port) {
    console.error('ensure-login: 无法启动 managed 浏览器（未找到 Chrome 或 CDP 启动超时）');
    process.exitCode = 1;
    return;
  }
  await openLoginUrl(cdp.cdp_port, url);
  console.log('');
  console.log(`Sleuth 已在持久 profile 中打开登录页：${url}`);
  console.log(`Profile: ${CDP_PROFILE_DIR}（登录一次，长期复用，不影响你日常的 Chrome）`);
  console.log('请在弹出的 Chrome 窗口完成登录，然后按 Enter 继续…');
  await new Promise((resolve) => {
    process.stdin.once('data', () => resolve());
    process.stdin.resume();
  });
  process.stdin.pause();
  console.log(`已确认。登录态保存在持久 profile，后续 --cdp ${cdp.cdp_port} 的会话可直接复用。`);
}

async function main(options = {}) {
  const results = {};

  if (options.profileDirOnly) {
    console.log(CDP_PROFILE_DIR);
    return results;
  }

  if (options.ensureLogin) {
    await handleEnsureLogin(options.ensureLogin);
    return results;
  }

  if (options.outputDirOnly) {
    const outDir = resolveOutputDir();
    ensureOutputDir(outDir);
    console.log(outDir);
    return results;
  }

  if (options.realBrowser) {
    const rbResult = await handleRealBrowser(options);
    if (options.json) console.log(JSON.stringify(rbResult, null, 2));
    return rbResult;
  }

  const ab = checkAgentBrowser();
  results.agentBrowser = ab;
  if (!options.json) {
    console.log(ab.status === 'ok'
      ? `agent-browser: ok (${ab.version})`
      : 'agent-browser: not found — npm i -g agent-browser && agent-browser install');
  }

  let cdpStatus;
  if (options.checkOnly) {
    let mode = 'unavailable';
    let detectedPort = null;
    let detectedWs = null;
    let detectedLabel = null;
    // 路径 1: Chrome 144+ approval mode（DevToolsActivePort + TCP 探活，不走 HTTP）
    const wsInfo = await getWebSocketUrl();
    if (wsInfo) {
      mode = 'approval';
      detectedPort = wsInfo.port;
      detectedWs = wsInfo.wsUrl;
      detectedLabel = wsInfo.label;
    } else {
      // 路径 2: sleuth managed browser
      const managed = await detectManagedCDPPort();
      if (managed.port) {
        mode = 'managed';
        detectedPort = managed.port;
      }
    }
    cdpStatus = { browser_mode: mode, cdp_port: detectedPort, cdp_ws: detectedWs, browser_label: detectedLabel, profile_dir: CDP_PROFILE_DIR, auth_state: 'unknown' };
  } else {
    const origLog = console.log;
    const origErr = console.error;
    try {
      if (options.json) {
        console.log = () => {};
        console.error = () => {};
      }
      cdpStatus = await ensureCDP();
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    await openLoginUrl(cdpStatus.cdp_port, options.loginUrl);
  }

  results.cdp = cdpStatus;

  if (!options.json) {
    if (cdpStatus.cdp_ws) {
      console.log(`chrome-cdp: ok (${cdpStatus.browser_label}, port ${cdpStatus.cdp_port})`);
      console.log(`SLEUTH_CDP_WS=${cdpStatus.cdp_ws}`);
      console.log(`SLEUTH_CDP_PORT=${cdpStatus.cdp_port}`);
    } else if (cdpStatus.cdp_port) {
      console.log(`chrome-cdp: ok (port ${cdpStatus.cdp_port}，模式: ${cdpStatus.browser_mode})`);
      console.log(`SLEUTH_CDP_PORT=${cdpStatus.cdp_port}`);
    } else {
      console.log('chrome: 未发现可连的浏览器');
      console.log('  推荐：chrome://inspect/#remote-debugging 勾 toggle（Chrome 144+）');
    }
  }

  if (options.authRequired && cdpStatus.cdp_port) {
    const targetUrl = options.loginUrl || options.authRequired;
    if (typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
      const { verifyAuth, parseSiteAuth, buildVerifyResult, normalizeDomain: normalizeAuthDomain } = await import('./auth-verify.mjs');
      const domain = normalizeAuthDomain(new URL(targetUrl).hostname);
      const siteAuth = parseSiteAuth(domain);

      if (!options.json) {
        console.log('');
        console.log('Sleuth opened a dedicated browser window for this task.');
        console.log(`Target: ${domain}`);
        console.log('Please sign in in the opened Chrome window, then press Enter. Type "skip" to continue without login.');
        const input = await new Promise((resolve) => {
          process.stdin.once('data', data => resolve(data.toString().trim()));
          process.stdin.resume();
        });
        process.stdin.pause();
        if (input.toLowerCase() === 'skip') {
          cdpStatus.auth_state = 'skipped';
          results.authVerify = buildVerifyResult(domain, 'skipped', ['user_skipped'], 'skipped');
        }
      }

      if (!results.authVerify) {
        const verifyResult = await verifyAuth(cdpStatus.cdp_port, targetUrl, siteAuth);
        cdpStatus.auth_state = verifyResult.auth_state;
        results.authVerify = buildVerifyResult(domain, verifyResult.auth_state, verifyResult.signals);

        if (verifyResult.auth_state === 'verified') {
          try {
            const current = readState() || {};
            const domains = new Set(current.auth_verified_domains || []);
            domains.add(domain);
            persistManagedState({
              port: cdpStatus.cdp_port,
              pid: current.pid || findManagedBrowserProcess()?.pid || null,
              patch: { auth_verified_domains: [...domains] },
            });
          } catch {}
        }
      }
    } else {
      cdpStatus.auth_state = 'skipped';
    }
  }

  if (!options.checkOnly) {
    const outDir = resolveOutputDir();
    fs.mkdirSync(outDir, { recursive: true });
    results.outputDir = outDir;
    if (!options.json) console.log(`output-dir: ${outDir}`);

  } else {
    results.outputDir = resolveOutputDir();
  }

  const patterns = listSitePatterns();
  results.sitePatterns = patterns;
  if (!options.json) console.log(patterns.length ? `site-patterns: ${patterns.join(', ')}` : 'site-patterns: (none)');

  const optDeps = {
    sqlite3: { install: 'macOS/Linux 预装；Windows: winget install sqlite.sqlite' },
    'yt-dlp': { install: 'pip install yt-dlp' },
    python3: { install: 'macOS/Linux 预装；Windows: winget install python3' },
  };
  results.optionalDeps = {};
  for (const dep of Object.keys(optDeps)) {
    results.optionalDeps[dep] = checkOptionalDep(dep).status;
  }

  if (options.json) {
    const jsonOut = { ...cdpStatus };
    if (results.authVerify) jsonOut.auth_verify = results.authVerify;
    console.log(JSON.stringify(jsonOut, null, 2));
  }

  return results;
}

export {
  main,
  ensureCDP,
  validateCDPEndpoint,
  detectCDPPort,
  detectManagedCDPPort,
  launchManagedBrowser,
  checkAgentBrowser,
  listSitePatterns,
  checkPort,
  resolveOutputDir,
  ensureOutputDir,
  handleRealBrowser,
  getBrowserStatus,
  stopManagedBrowser,
  findChromeBinary,
  findManagedBrowserProcess,
  readState,
  writeState,
  readRealBrowserState,
  writeRealBrowserState,
  persistManagedState,
  selectFreePort,
  CDP_PROFILE_DIR,
  STATE_FILE,
  REAL_BROWSER_STATE_FILE,
  PREFERRED_PORTS,
};
