/**
 * check-deps-core.mjs — sleuth 环境检查核心逻辑
 *
 * 纯导出模块，不自动执行。由 check-deps.mjs（CLI）和其他脚本 import 使用。
 *
 * 设计文档：docs/browser-auth-and-channel-intelligence-plan.md
 *
 * 核心原则：
 *   - 永不关闭或重启用户日常 Chrome
 *   - 永不复制用户 Chrome profile / cookies
 *   - 使用独立 managed profile（~/.sleuth/cdp-profile）
 *   - CDP 检测必须验证协议（/json/version），不能仅靠 TCP 端口
 *   - 端口动态选择，优先 9222，不可假设固定
 *
 * 导出：
 *   - main(options)              完整环境检查流程
 *   - ensureCDP(options)         确保 CDP 可用（查找或启动 managed browser）
 *   - validateCDPEndpoint(port)  协议级验证 CDP 端点
 *   - checkAgentBrowser()        检测 agent-browser 是否安装
 *   - detectCDPPort()            检测已有有效 CDP 端口
 *   - launchManagedBrowser(port) 启动 managed profile 浏览器
 *   - listSitePatterns()         列出站点经验文件
 *   - checkPort(port)            TCP 端口是否监听
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOutputDir, ensureOutputDir } from './output.mjs';

// ── 路径常量 ──────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../..');
const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// managed profile 目录（文档规定路径）
const CDP_PROFILE_DIR = path.join(os.homedir(), '.sleuth', 'cdp-profile');
// 状态文件（记录 pid、port、启动时间）
const STATE_FILE = path.join(os.homedir(), '.sleuth', 'cdp-state.json');
// real-browser 独立状态文件（与 managed browser 状态隔离）
const REAL_BROWSER_STATE_FILE = path.join(os.homedir(), '.sleuth', 'real-browser-state.json');

// 优先探测端口列表（文档规定）
const PREFERRED_PORTS = [9222, 9223, 9333];

// ── TCP 端口探测 ──────────────────────────────────────────────────

/**
 * 检测指定 TCP 端口是否有服务在监听。
 *
 * @param {number} port - 端口号
 * @param {string} host - 主机地址，默认 127.0.0.1
 * @param {number} timeoutMs - 超时毫秒数，默认 2000
 * @returns {Promise<boolean>}
 */
function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// ── CDP 协议验证 ──────────────────────────────────────────────────

/**
 * 验证 CDP 端点是否有效（协议级，非仅 TCP）。
 *
 * 有效条件（文档规定）：
 *   - http://127.0.0.1:<port>/json/version 返回 HTTP 200
 *   - 响应是 JSON
 *   - 响应包含 webSocketDebuggerUrl
 *
 * @param {number} port
 * @returns {Promise<{valid: boolean, info: object|null}>}
 */
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

// ── Chrome CDP 端口检测 ────────────────────────────────────────────

/**
 * 检测已有的有效 CDP 端口。
 *
 * 策略：
 *   1. 读取 managed profile 的 DevToolsActivePort 文件
 *   2. 探测优先端口列表（9222, 9223, 9333）
 *   3. 每个候选端口必须通过协议验证
 *
 * @returns {Promise<{port: number|null, info: object|null}>}
 */
async function detectCDPPort() {
  // 策略 1：读取 managed profile 的 DevToolsActivePort
  const activePortFile = path.join(CDP_PROFILE_DIR, 'DevToolsActivePort');
  try {
    if (fs.existsSync(activePortFile)) {
      const lines = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536) {
        const result = await validateCDPEndpoint(port);
        if (result.valid) return { port, info: result.info };
      }
    }
  } catch {}

  // 策略 2：探测优先端口列表
  for (const port of PREFERRED_PORTS) {
    const result = await validateCDPEndpoint(port);
    if (result.valid) return { port, info: result.info };
  }

  return { port: null, info: null };
}

/**
 * 仅检测 managed browser 的 CDP 端口。
 * 不会探测 PREFERRED_PORTS，因此不会意外连接到用户的日常浏览器。
 * route-task.mjs 等非 opt-in 路径应使用此函数。
 */
async function detectManagedCDPPort() {
  // 策略 1：cdp-state.json 中记录的端口
  const state = readState();
  if (state?.port && state?.pid && isProcessAlive(state.pid)) {
    const result = await validateCDPEndpoint(state.port);
    if (result.valid) return { port: state.port, info: result.info };
  }

  // 策略 2：DevToolsActivePort 文件（仅 managed profile 目录）
  const activePortFile = path.join(CDP_PROFILE_DIR, 'DevToolsActivePort');
  try {
    if (fs.existsSync(activePortFile)) {
      const lines = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536) {
        const result = await validateCDPEndpoint(port);
        if (result.valid) return { port, info: result.info };
      }
    }
  } catch {}

  return { port: null, info: null };
}

// ── Chrome 二进制查找 ──────────────────────────────────────────────

/**
 * 查找 Chrome 二进制路径（跨平台）。
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
      '/usr/bin/chromium-browser',
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

/** Promise 版 sleep */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 选择一个空闲端口。优先使用 PREFERRED_PORTS 中未被占用的；都被占用时选随机端口。
 */
async function selectFreePort() {
  for (const port of PREFERRED_PORTS) {
    if (!(await checkPort(port))) return port;
  }
  // 随机选择高位端口
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// ── Managed Browser 生命周期 ──────────────────────────────────────

/**
 * 读取 managed browser 状态。
 */
function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 写入 managed browser 状态。
 */
function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 读取 real-browser 状态（独立于 managed browser 状态）。
 */
function readRealBrowserState() {
  try {
    if (!fs.existsSync(REAL_BROWSER_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(REAL_BROWSER_STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 写入 real-browser 状态。
 * 文档规定：real-browser 不写 cdp-state.json，使用独立文件。
 */
function writeRealBrowserState(state) {
  fs.mkdirSync(path.dirname(REAL_BROWSER_STATE_FILE), { recursive: true });
  fs.writeFileSync(REAL_BROWSER_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 检查 PID 是否存活。
 */
function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * 扫描本机 Chrome 进程，查找使用 cdp-profile 的 managed browser。
 * 同时提取 CDP 端口号（--remote-debugging-port）。
 *
 * @returns {{ pid: number, port: number | null } | null}
 */
function findManagedBrowserProcess() {
  try {
    if (os.platform() === 'win32') {
      const ps = execSync(
        'wmic process where "commandline like \'%cdp-profile%\'" get processid,commandline /format:list',
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const pidMatch = ps.match(/ProcessId=(\d+)/);
      if (!pidMatch) return null;
      const pid = parseInt(pidMatch[1]);
      const portMatch = ps.match(/--remote-debugging-port=(\d+)/);
      return { pid, port: portMatch ? parseInt(portMatch[1]) : null };
    }

    const ps = execSync('ps aux', { encoding: 'utf-8', timeout: 3000 });
    for (const line of ps.split('\n')) {
      if (line.includes('grep')) continue;
      if (line.includes('cdp-profile') && /chrome/i.test(line)) {
        const pidMatch = line.match(/^\S+\s+(\d+)/);
        const portMatch = line.match(/--remote-debugging-port=(\d+)/);
        if (pidMatch) {
          return {
            pid: parseInt(pidMatch[1]),
            port: portMatch ? parseInt(portMatch[1]) : null,
          };
        }
      }
    }
  } catch {}
  return null;
}

/**
 * 启动 managed Sleuth 浏览器。
 *
 * 按照文档规定：
 *   - user-data-dir: ~/.sleuth/cdp-profile
 *   - remote-debugging-address: 127.0.0.1
 *   - 端口动态选择
 *   - macOS 使用 open -na 方式
 *   - 永不复制用户 profile，永不关闭用户 Chrome
 *
 * @param {object} [options]
 * @param {number} [options.port] - 指定端口（不指定则自动选择）
 * @param {string} [options.loginUrl] - 启动后打开的 URL（用于登录引导）
 * @returns {Promise<{ready: boolean, port: number|null, pid: number|null}>}
 */
async function launchManagedBrowser(options = {}) {
  const port = options.port || await selectFreePort();
  const result = { ready: false, port: null, pid: null };

  const binary = findChromeBinary();
  if (!binary) {
    console.error('sleuth-browser: 未找到 Chrome 二进制文件');
    return result;
  }

  // 确保 profile 目录存在
  fs.mkdirSync(CDP_PROFILE_DIR, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${CDP_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  // macOS 使用 open -na 启动（文档规定）；使用实际找到的 binary 路径的应用名
  let child;
  if (os.platform() === 'darwin') {
    // 从 binary 路径提取 .app 名称（例如 "Google Chrome" 或 "Chromium"）
    const appMatch = binary.match(/\/([^/]+)\.app\//);
    const appName = appMatch ? appMatch[1] : 'Google Chrome';
    child = spawn('open', ['-na', appName, '--args', ...chromeArgs], {
      detached: true,
      stdio: 'ignore',
    });
  } else {
    child = spawn(binary, chromeArgs, {
      detached: true,
      stdio: 'ignore',
    });
  }
  child.unref();

  // macOS 的 open 命令返回的 PID 不是 Chrome 本身的 PID
  // 需要等待 CDP 就绪后通过端口确认
  const launchPid = child.pid;

  console.log(`sleuth-browser: 启动 managed browser（端口 ${port}）...`);

  // 等待 CDP 就绪（最多 20 秒）
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const check = await validateCDPEndpoint(port);
    if (check.valid) {
      // 找到 Chrome 真实 PID（通过 findManagedBrowserProcess）
      const proc = findManagedBrowserProcess();
      const realPid = proc ? proc.pid : launchPid;

      writeState({ pid: realPid, port, startedAt: new Date().toISOString() });
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

/**
 * 确保 managed CDP 可用。
 *
 * 策略（文档规定：managed default, real-browser opt-in）：
 * - 检测已有端点，如果属于 managed browser（state.json 匹配） → 复用
 * - 如果端点属于外部浏览器 → 忽略，启动 managed browser（不自动复用外部）
 * - 如果无端点 → 启动 managed browser
 *
 * 返回机器可读的状态对象：
 * {
 *   "browser_mode": "managed" | "unavailable",
 *   "cdp_port": number | null,
 *   "profile_dir": string,
 *   "auth_state": "unknown"
 * }
 *
 * @param {object} [options]
 * @param {string} [options.loginUrl] - 启动后打开的 URL（不传给 Chrome 启动参数，由调用者负责后续打开）
 * @returns {Promise<object>}
 */
async function ensureCDP(options = {}) {
  const status = {
    browser_mode: 'unavailable',
    cdp_port: null,
    profile_dir: CDP_PROFILE_DIR,
    auth_state: 'unknown',
  };

  // 策略 1：detectManagedCDPPort（仅扫描 managed browser 信号，不碰用户 Chrome）
  const managed = await detectManagedCDPPort();
  if (managed.port) {
    status.browser_mode = 'managed';
    status.cdp_port = managed.port;
    return status;
  }

  // 策略 2：进程 arg 扫描（state 文件过期但 managed browser 仍在运行）
  const proc = findManagedBrowserProcess();
  if (proc && proc.port) {
    const check = await validateCDPEndpoint(proc.port);
    if (check.valid) {
      status.browser_mode = 'managed';
      status.cdp_port = proc.port;
      return status;
    }
  }

  // 策略 3：启动 managed browser
  const launched = await launchManagedBrowser({});
  if (launched.ready) {
    status.browser_mode = 'managed';
    status.cdp_port = launched.port;
  }

  return status;
}

/**
 * 获取 managed browser 状态。
 */
async function getBrowserStatus() {
  const state = readState();
  const result = { ready: false, port: null, pid: null, profile_dir: CDP_PROFILE_DIR };

  // 策略 1：state 文件优先（最快路径）
  if (state && state.pid && isProcessAlive(state.pid)) {
    const check = await validateCDPEndpoint(state.port);
    if (check.valid) {
      result.ready = true;
      result.port = state.port;
      result.pid = state.pid;
      return result;
    }
  }

  // 策略 2：DevToolsActivePort（state 文件过时时回退）
  const activePortFile = path.join(CDP_PROFILE_DIR, 'DevToolsActivePort');
  try {
    if (fs.existsSync(activePortFile)) {
      const lines = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const activePort = parseInt(lines[0], 10);
      if (activePort > 0 && activePort < 65536) {
        const check = await validateCDPEndpoint(activePort);
        if (check.valid) {
          result.ready = true;
          result.port = activePort;
          return result;
        }
      }
    }
  } catch {}

  // 策略 3：进程 arg 扫描（state 文件和 DevToolsActivePort 都不可用时）
  const proc = findManagedBrowserProcess();
  if (proc && proc.port) {
    const check = await validateCDPEndpoint(proc.port);
    if (check.valid) {
      result.ready = true;
      result.port = proc.port;
      result.pid = proc.pid;
      return result;
    }
  }

  return result;
}

/**
 * 停止 managed browser。
 * 通常不需要调用——managed browser 设计为持久运行。
 */
function stopManagedBrowser() {
  const state = readState();
  if (state && state.pid) {
    try { process.kill(state.pid); } catch {}
  }
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

// ── agent-browser 检查 ─────────────────────────────────────────────

/**
 * 检测 agent-browser 是否已安装。
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

// ── 可选依赖检查 ──────────────────────────────────────────────────

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
    } catch {}
  }
  return patterns;
}

// ── Real Browser Bridge (Phase 4) ─────────────────────────────────

/**
 * 连接用户现有 Chrome 实例（real-browser 模式）。
 *
 * 安全约束：
 *   - 显式 opt-in（仅当 --real-browser 时触发）
 *   - 默认只读（不执行写操作）
 *   - 域名/标签范围限制（通过 --domain 参数限定）
 *   - 清晰的安全警告
 *
 * 连接策略：
 *   1. 检查环境变量 SLEUTH_CDP_PORT
 *   2. 尝试常用端口 9222, 9229
 *   3. 如均失败，提示用户启动方式
 */
async function handleRealBrowser(options) {
  const result = {
    browser_mode: 'real-browser',
    cdp_port: null,
    profile_dir: null, // 用户自己的 profile，sleuth 不管理
    auth_state: 'unknown',
    warnings: [],
    domains_allowed: options.domain ? [options.domain] : [],
    read_only: true,
  };

  // 安全警告
  const warnings = [
    '⚠ real-browser 模式连接您的日常浏览器，操作对您的账户可见',
    '⚠ 默认只读模式：不会执行点击、填写、提交等写操作',
    '⚠ 建议仅用于读取登录态页面数据，不建议在敏感页面使用',
  ];
  result.warnings = warnings;

  if (!options.json) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  REAL-BROWSER 模式（连接用户现有 Chrome）');
    console.log('═══════════════════════════════════════════════════════');
    for (const w of warnings) console.log(`  ${w}`);
    console.log('');
  }

  // 1. 查找 CDP 端口
  const explicitPort = options.cdpPort || process.env.SLEUTH_CDP_PORT;
  if (!explicitPort) {
    const msg = 'real-browser 模式需要显式提供 CDP 端口（请设置 SLEUTH_CDP_PORT 或传入 --cdp-port）';
    if (!options.json) {
      console.error(`  ✗ ${msg}`);
      console.error('');
      console.error('  示例:');
      console.error('    node scripts/check-deps.mjs --real-browser --cdp-port 9222 --domain example.com');
      console.error('    export SLEUTH_CDP_PORT=9222');
    }
    result.error = msg;
    return result;
  }
  const portsToTry = [parseInt(explicitPort, 10)].filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);

  if (portsToTry.length === 0) {
    result.error = 'real-browser 模式提供的 CDP 端口无效（应为 1-65535 之间的整数）';
    return result;
  }

  let connectedPort = null;
  let versionInfo = null;

  for (const port of portsToTry) {
    const validation = await validateCDPEndpoint(port);
    if (validation.valid) {
      connectedPort = port;
      versionInfo = validation.info;
      break;
    }
  }

  if (!connectedPort) {
    const msg = '未找到可用的 CDP 端口。请确保 Chrome 以 --remote-debugging-port 启动。';
    if (!options.json) {
      console.error(`  ✗ ${msg}`);
      console.error('');
      console.error('  启动方式（macOS）:');
      console.error('    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\');
      console.error('      --remote-debugging-port=9222 &');
      console.error('');
      console.error('  或设置环境变量:');
      console.error('    export SLEUTH_CDP_PORT=9222');
    }
    result.error = msg;
    return result;
  }

  result.cdp_port = connectedPort;

  if (!options.json) {
    console.log(`  ✓ 已连接 CDP 端口 ${connectedPort}`);
    if (versionInfo?.Browser) {
      console.log(`    浏览器: ${versionInfo.Browser}`);
    }
  }

  // 2. 域名范围检查（如提供了 --domain）
  if (options.domain) {
    if (!options.json) {
      console.log(`  ✓ 域名限制: ${options.domain}`);
      console.log('    仅对该域名的标签页进行只读操作');
    }
  } else {
    const domainWarn = '未指定 --domain，默认拒绝所有域名访问（请通过 --domain 显式指定目标站点）';
    result.warnings.push(domainWarn);
    result.domains_allowed = [];  // 最小权限：未指定域名时默认拒绝
    if (!options.json) {
      console.log(`  ⚠ ${domainWarn}`);
    }
  }

  // 3. 列出当前标签页（仅诊断，不暴露敏感 URL）+ Tab scoping
  try {
    const resp = await fetch(`http://127.0.0.1:${connectedPort}/json/list`);
    if (resp.ok) {
      const tabs = await resp.json();
      const pageTabs = tabs.filter(t => t.type === 'page');
      result.tabs_count = pageTabs.length;

      if (options.domain) {
        const domainTabs = pageTabs.filter(t => {
          try { return new URL(t.url).hostname.includes(options.domain); } catch { return false; }
        });
        result.domain_tabs_count = domainTabs.length;

        // Tab scoping：只暴露目标域名的 tab websocket，防止误操作其他标签页
        if (domainTabs.length > 0) {
          result.scoped_tab_id = domainTabs[0].id;
          result.scoped_tab_ws = domainTabs[0].webSocketDebuggerUrl || null;
        }

        if (!options.json) {
          console.log(`  ✓ 找到 ${domainTabs.length}/${pageTabs.length} 个 ${options.domain} 标签页`);
          if (domainTabs.length === 0) {
            console.log(`  ⚠ 未找到 ${options.domain} 的标签页，后续操作将受限`);
          }
        }
      } else if (!options.json) {
        console.log(`  ✓ 当前 ${pageTabs.length} 个标签页`);
      }

      // 安全提示：real-browser 模式下仅操作 --domain 指定的标签页
      if (!options.domain && !options.json) {
        result.warnings.push('未指定 --domain，real-browser 模式下不会自动操作任何标签页');
        console.log('  ⚠ 未指定 --domain，不会自动操作任何标签页');
      }
    }
  } catch { /* 列表失败不致命 */ }

  // 4. 输出连接信息
  if (!options.json) {
    console.log('');
    console.log(`  SLEUTH_CDP_PORT=${connectedPort}`);
    console.log(`  SLEUTH_BROWSER_MODE=real-browser`);
    console.log(`  SLEUTH_READ_ONLY=true`);
    console.log('');
    console.log('  使用完毕后无需清理（sleuth 不管理此浏览器生命周期）');
    console.log('═══════════════════════════════════════════════════════');
  }

  // 设置环境变量，供同进程内下游模块读取
  process.env.SLEUTH_READ_ONLY = 'true';
  process.env.SLEUTH_BROWSER_MODE = 'real-browser';

  // 持久化 domains_allowed 到 real-browser-state.json（文档规定：real-browser 不写 cdp-state.json）
  // 注意：即使 domains_allowed 为空也必须写入，以覆盖旧 state 防止残留放行
  try {
    const rbState = {
      browser_mode: 'real-browser',
      read_only: true,
      port: connectedPort,
      domains_allowed: result.domains_allowed || [],
      updated_at: new Date().toISOString(),
    };
    writeRealBrowserState(rbState);
  } catch (writeErr) {
    // 写入失败是硬失败：旧 state 可能有更宽松的 domains_allowed，继续运行不安全
    throw new Error(`real-browser 模式：real-browser-state.json 持久化失败，拒绝继续（旧 state 可能不安全）: ${writeErr.message}`);
  }

  return result;
}

// ── 主流程 ────────────────────────────────────────────────────────

/**
 * 主函数。根据 options 执行不同模式。
 *
 * 模式（文档规定的 CLI 标志）：
 *   - outputDirOnly    仅输出目录路径
 *   - checkOnly        非破坏性诊断（不启动浏览器）
 *   - ensureCdp        查找或启动 managed browser
 *   - loginUrl         启动后打开指定 URL（供登录）
 *   - authRequired     如登录未验证则提示（Phase 2）
 *   - realBrowser      使用用户日常 Chrome（Phase 4）
 *   - json             输出机器可读 JSON（文档格式：{browser_mode, cdp_port, profile_dir, auth_state}）
 *
 * @param {object} [options]
 * @returns {Promise<object>} 检查结果
 */
async function main(options = {}) {
  const results = {};

  // 特殊模式：仅输出目录路径
  if (options.outputDirOnly) {
    const outDir = resolveOutputDir(options.sid);
    ensureOutputDir(outDir);
    console.log(outDir);
    return results;
  }

  // --real-browser：Phase 4，连接用户现有 Chrome 实例（显式 opt-in）
  if (options.realBrowser) {
    const rbResult = await handleRealBrowser(options);
    if (options.json) {
      console.log(JSON.stringify(rbResult, null, 2));
    }
    return rbResult;
  }

  // ── 检查 1：agent-browser ──
  const ab = checkAgentBrowser();
  results.agentBrowser = ab;
  if (!options.json) {
    if (ab.status === 'ok') {
      console.log(`agent-browser: ok (${ab.version})`);
    } else {
      console.log('agent-browser: not found — npm i -g agent-browser && agent-browser install');
    }
  }

  // ── 检查 2：Chrome CDP ──
  let cdpStatus;
  if (options.checkOnly) {
    // 仅诊断，不启动 — 使用增强检测（多信号：state + DevToolsActivePort + 进程扫描）
    let mode = 'unavailable';
    let detectedPort = null;

    // 先用 managed-only 检测
    const managed = await detectManagedCDPPort();
    if (managed.port) {
      mode = 'managed';
      detectedPort = managed.port;
    } else {
      // 回退：进程 arg 扫描
      const proc = findManagedBrowserProcess();
      if (proc && proc.port) {
        const check = await validateCDPEndpoint(proc.port);
        if (check.valid) {
          mode = 'managed';
          detectedPort = proc.port;
        }
      }
    }

    // 如果 managed 检测都失败，再扫描通用端口判断是否 external
    if (!detectedPort) {
      const external = await detectCDPPort();
      if (external.port) {
        mode = 'external';
        detectedPort = external.port;
      }
    }

    cdpStatus = {
      browser_mode: mode,
      cdp_port: detectedPort,
      profile_dir: CDP_PROFILE_DIR,
      auth_state: 'unknown',
    };
    results.cdp = cdpStatus;
    if (!options.json) {
      if (detectedPort) {
        console.log(`chrome-cdp: ok (port ${detectedPort}，模式: ${mode}，协议验证通过)`);
      } else {
        console.log('chrome-cdp: 未检测到有效 CDP 端点');
        console.log(`  提示：运行 node scripts/check-deps.mjs --ensure-cdp 启动 managed browser`);
      }
    }
  } else {
    // 默认或 --ensure-cdp：确保 CDP 可用
    // JSON 模式下抑制 launchManagedBrowser 的 console 输出
    const origLog = console.log;
    const origErr = console.error;
    if (options.json) {
      console.log = () => {};
      console.error = () => {};
    }
    cdpStatus = await ensureCDP({ loginUrl: options.loginUrl });
    if (options.json) {
      console.log = origLog;
      console.error = origErr;
    }
    results.cdp = cdpStatus;

    // --login-url 且复用已有 CDP：通过 agent-browser 打开目标页
    if (options.loginUrl && cdpStatus.cdp_port && cdpStatus.browser_mode !== 'unavailable') {
      // 安全：使用参数数组避免 shell 注入（loginUrl 来自用户输入）
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync(
          'agent-browser',
          ['--cdp', String(cdpStatus.cdp_port), 'open', options.loginUrl],
          { stdio: 'ignore', timeout: 10000 }
        );
      } catch {
        // 如果 agent-browser 不可用，尝试直接用 CDP 打开
        try {
          await fetch(`http://127.0.0.1:${cdpStatus.cdp_port}/json/new?${encodeURIComponent(options.loginUrl)}`, {
            signal: AbortSignal.timeout(5000),
          });
        } catch {}
      }
    }

    if (!options.json) {
      if (cdpStatus.cdp_port) {
        console.log(`chrome-cdp: ok (port ${cdpStatus.cdp_port}，模式: ${cdpStatus.browser_mode})`);
        // 输出环境变量供下游使用（文档规定）
        console.log(`SLEUTH_CDP_PORT=${cdpStatus.cdp_port}`);
      } else {
        console.log('chrome-cdp: 启动失败');
        console.log('  提示：运行 node scripts/sleuth-browser.mjs open-login 配置登录');
      }
    }

    // --auth-required：登录态验证（Phase 2）
    if (options.authRequired && cdpStatus.cdp_port) {
      const targetUrl = options.loginUrl || options.authRequired;
      if (typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
        const { verifyAuth, parseSiteAuth, buildVerifyResult } = await import('./auth-verify.mjs');
        const domain = new URL(targetUrl).hostname;
        const siteAuth = parseSiteAuth(domain);

        // 如果需要人工完成登录，给出文档规定的标准英文引导
        if (!options.json) {
          console.log('');
          console.log('Sleuth opened a dedicated browser window for this task.');
          console.log('');
          console.log(`Target: ${domain}`);
          console.log('Reason: this page requires a logged-in website session.');
          console.log('');
          console.log(`Please sign in to ${domain} in the opened Chrome window.`);
          console.log('Do not paste passwords, 2FA codes, cookies, or tokens into the terminal.');
          console.log('After the page shows you are logged in, return here and press Enter.');
          console.log('请在浏览器中完成登录，完成后按回车继续（输入 skip 跳过）');
          console.log('');
          console.log('Press Enter to continue, or type "skip" to continue without login.');
          // 等待用户输入
          const input = await new Promise((resolve) => {
            process.stdin.once('data', (data) => resolve(data.toString().trim()));
            process.stdin.resume();
          });
          process.stdin.pause();
          if (input.toLowerCase() === 'skip') {
            cdpStatus.auth_state = 'skipped';
            results.authVerify = { domain, auth_state: 'skipped', signals: ['user_skipped'], sensitive_values_printed: false };
            return results;
          }
        }

        // 执行验证
        const verifyResult = await verifyAuth(cdpStatus.cdp_port, targetUrl, siteAuth);
        cdpStatus.auth_state = verifyResult.auth_state;
        const output = buildVerifyResult(domain, verifyResult.auth_state, verifyResult.signals);
        results.authVerify = output;

        // 验证失败时输出文档规定的失败提示
        if (!options.json && verifyResult.auth_state === 'not_verified') {
          console.log('');
          console.log(`Login was not verified for ${domain}.`);
          console.log('I can continue with public/anonymous evidence, but I will mark login-gated evidence as unavailable.');
        }

        // 持久化 auth 验证状态到 cdp-state.json（供 route-task 读取）
        if (verifyResult.auth_state === 'verified') {
          try {
            const currentState = readState() || {};
            const domains = new Set(currentState.auth_verified_domains || []);
            domains.add(domain);
            currentState.auth_verified_domains = [...domains];
            writeState(currentState);
          } catch { /* 写入失败不阻塞主流程 */ }
        }

        // 记录 auth_state 到 session 日志（如提供 sid）
        if (options.sid) {
          try {
            const op = JSON.stringify({
              type: 'auth_verify',
              domain,
              auth_state: verifyResult.auth_state,
              signals: verifyResult.signals,
              ts: new Date().toISOString(),
            });
            execFileSync(process.execPath, [
              path.join(path.dirname(__filename), '..', 'session-logger.mjs'),
              '--action', 'log',
              '--sid', options.sid,
              '--operation', op,
            ], { stdio: 'ignore', timeout: 5000 });
          } catch {
            // session 日志写入失败不影响主流程
          }
        }

        if (!options.json) {
          console.log('');
          if (verifyResult.auth_state === 'verified') {
            console.log(`✓ 登录验证通过: ${domain}`);
            console.log(`  验证信号: ${verifyResult.signals.join(', ')}`);
          } else if (verifyResult.auth_state === 'not_verified') {
            console.log(`✗ 登录未验证: ${domain}`);
            console.log(`  信号: ${verifyResult.signals.join(', ')}`);
            console.log(`  提示：请在 managed browser 中登录该站点后重试`);
            console.log(`  运行：node scripts/sleuth-browser.mjs open-login`);
          } else {
            console.log(`? 登录状态未知: ${domain}`);
            console.log(`  信号: ${verifyResult.signals.join(', ')}`);
            console.log(`  提示：无法自动判断登录状态，请手动确认浏览器中的登录态`);
          }
        }
      } else {
        // --auth-required 没有提供有效 URL
        cdpStatus.auth_state = 'skipped';
        if (!options.json) {
          console.log('');
          console.log('⚠ --auth-required 需要配合 --login-url 使用（提供目标 URL）');
        }
      }
    }
  }

  // ── 检查 3：输出目录 ──
  // --check-only 模式下不创建目录（non-destructive diagnostics）
  if (!options.checkOnly) {
    const outDir = resolveOutputDir(options.sid);
    fs.mkdirSync(outDir, { recursive: true });
    results.outputDir = outDir;
    if (!options.json) {
      console.log(`output-dir: ${outDir}`);
    }

    // ── 检查 3.5：清理过期输出 ──
    try {
      const cleanupPath = path.join(path.dirname(__filename), '..', 'cleanup-output.mjs');
      const origLog = console.log;
      if (options.json) console.log = () => {};
      const { main: cleanupMain } = await import(cleanupPath);
      cleanupMain({ days: 7, dryRun: false });
      if (options.json) console.log = origLog;
    } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') {
        if (!options.json) console.warn(`cleanup: ${err.message}`);
      }
    }

    if (!options.json) console.log();
  } else {
    // check-only：仅报告路径，不创建
    const outDir = resolveOutputDir(options.sid);
    results.outputDir = outDir;
    if (!options.json) {
      console.log(`output-dir: ${outDir} (未创建，--check-only 模式)`);
      console.log();
    }
  }

  // ── 检查 4：站点经验文件 ──
  const patterns = listSitePatterns();
  results.sitePatterns = patterns;
  if (!options.json) {
    if (patterns.length > 0) {
      console.log(`site-patterns: ${patterns.join(', ')}`);
    } else {
      console.log('site-patterns: (none)');
    }
  }

  // ── 检查 5：可选依赖 ──
  if (!options.json) console.log();
  const optDeps = {
    sqlite3:    { install: 'macOS/Linux 预装；Windows: winget install sqlite.sqlite', usedBy: 'find-url（Chrome 书签/历史搜索）' },
    'yt-dlp':   { install: 'pip install yt-dlp', usedBy: 'extract-subtitles（视频/播客字幕提取）' },
    python3:    { install: 'macOS/Linux 预装；Windows: winget install python3', usedBy: 'srt_to_transcript（字幕清洗）' },
  };
  results.optionalDeps = {};
  for (const [dep, info] of Object.entries(optDeps)) {
    const r = checkOptionalDep(dep);
    results.optionalDeps[dep] = r.status;
    if (!options.json) {
      if (r.status === 'ok') {
        console.log(`${dep}: ok`);
      } else {
        console.log(`${dep}: not found — ${info.install}（${info.usedBy}）`);
      }
    }
  }

  // JSON 输出模式：输出文档规定的顶层格式
  if (options.json) {
    const jsonOut = { ...cdpStatus };
    if (results.authVerify) jsonOut.auth_verify = results.authVerify;
    console.log(JSON.stringify(jsonOut, null, 2));
  }

  return results;
}

// ── 导出 ──────────────────────────────────────────────────────────

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
  // managed browser 生命周期
  getBrowserStatus,
  stopManagedBrowser,
  // 内部工具（供测试和 sleuth-browser.mjs）
  findChromeBinary,
  findManagedBrowserProcess,
  readState,
  writeState,
  readRealBrowserState,
  writeRealBrowserState,
  selectFreePort,
  CDP_PROFILE_DIR,
  STATE_FILE,
  REAL_BROWSER_STATE_FILE,
  PREFERRED_PORTS,
};
